import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { lines } from '../../core/lines';
import type { Context, Family, Feature, Incoming, Moment } from '../../core/types';
import { unlog } from '../talk';
import { classify } from './classify';
import type { Classification } from './classify';
import { BUNDLE_GAP_MS, hasPicture, isClosed, passesRules, typedText, worthClassifying } from './filter';
import type { Bundle } from './filter';

const logger = new Logger('Capture');

export const bundles: Bundle[] = [];

const FORGET = /^anchor\b[,:]?\s+forget this\b/i;
const KEEP_QUIET = /^anchor\b[,:]?\s+don['’]t bring this back\b/i;
const WHICH = /^(fgt|qt):(.+)$/; // a tap on a button of forgetWhich or quietWhich

function count(family: Family, key: string) {
  family.counters[key] = (family.counters[key] ?? 0) + 1;
}

function removeBundle(bundle: Bundle) {
  const index = bundles.indexOf(bundle);
  if (index >= 0) bundles.splice(index, 1);
}

export async function react(ctx: Context, family: Family, chatId: string, messageId: string, emoji: string, big?: boolean) {
  try {
    await ctx.transport(family.id).react(chatId, messageId, emoji, big);
  } catch (error) {
    logger.warn(`react on ${chatId}/${messageId} failed: ${error}`);
  }
}

function findMoment(family: Family, messageId: string): Moment | undefined {
  return family.moments.find((moment) => moment.messageIds.includes(messageId) || moment.memoryPostIds.includes(messageId));
}

function findMomentOfStory(family: Family, messageId: string): Moment | undefined {
  return family.moments.find((moment) => moment.stories.some((story) => story.messageIds.includes(messageId)));
}

// v2, section 4.6: intents runs the looser forget/quiet wordings through this export; the forget feature still owns the exact patterns
export async function actOnReply(event: Incoming, family: Family, ctx: Context, isForget: boolean): Promise<void> {
  const replyTo = event.replyTo;
  if (!replyTo) return;

  const echoed = family.moments.find((moment) => moment.echoPostIds?.includes(replyTo));
  if (echoed) {
    // one reply never guesses between the two moments of a then-and-now post, so each gets a button
    const pair = [family.moments.find((moment) => moment.id === echoed.echo), echoed].filter(Boolean);
    const prefix = isForget ? 'fgt' : 'qt';
    const buttons = pair.map((moment) => ({ label: lines.whichMoment(moment), data: `${prefix}:${moment.id}` }));
    try {
      await ctx.transport(family.id).send(event.chatId, { text: isForget ? lines.forgetWhich : lines.quietWhich, replyTo: event.messageId, buttons });
    } catch (error) {
      logger.warn(`echo-post reply on ${event.chatId}/${event.messageId} failed: ${error}`);
    }
    return;
  }

  const openBundle = bundles.find((bundle) => bundle.family === family && bundle.events.some((e) => e.messageId === replyTo));
  let changed = false; // a bundle removal is in-memory only and never needs a save

  if (isForget) {
    if (openBundle) removeBundle(openBundle);
    const moment = findMoment(family, replyTo);
    if (moment) {
      family.moments.splice(family.moments.indexOf(moment), 1);
      unlog(family, moment.messageIds);
      changed = true;
    } else {
      const momentOfStory = findMomentOfStory(family, replyTo);
      if (momentOfStory) {
        const storyIndex = momentOfStory.stories.findIndex((story) => story.messageIds.includes(replyTo));
        momentOfStory.stories.splice(storyIndex, 1);
        changed = true;
      }
    }
  } else {
    if (openBundle) openBundle.sensitive = true;
    const moment = findMoment(family, replyTo) ?? findMomentOfStory(family, replyTo);
    if (moment && !moment.sensitive) {
      moment.sensitive = true;
      changed = true;
    }
  }

  if (changed) ctx.store.save();
  await react(ctx, family, event.chatId, event.messageId, '👌');
}

export const forget: Feature = {
  name: 'forget',
  async handle(event, family, ctx) {
    if (event.chat !== 'group' || !family) return false;
    const tapped = event.button?.match(WHICH);
    if (tapped) {
      const moment = family.moments.find((item) => item.id === tapped[2]);
      if (!moment) return true;
      if (tapped[1] === 'fgt') {
        family.moments.splice(family.moments.indexOf(moment), 1);
        unlog(family, moment.messageIds);
        ctx.store.save();
      } else if (!moment.sensitive) {
        moment.sensitive = true;
        ctx.store.save();
      }
      await react(ctx, family, event.chatId, event.messageId, '👌');
      return true;
    }

    const text = event.text ?? '';
    const isForget = FORGET.test(text);
    const isKeepQuiet = !isForget && KEEP_QUIET.test(text);
    if (!isForget && !isKeepQuiet) return false;
    if (!event.replyTo) return true;

    await actOnReply(event, family, ctx, isForget);
    return true;
  },
};

// a bundle closes once, and a second caller waits for the same classification
const close = (bundle: Bundle, family: Family, ctx: Context) => (bundle.closing ??= classifyAndSave(bundle, family, ctx));

// /fastforward closes every open bundle before the clock moves, so a text-only moment still joins the memory of the next day
export async function flush(family: Family, ctx: Context) {
  await Promise.all(bundles.filter((bundle) => bundle.family === family).map((bundle) => close(bundle, family, ctx)));
}

async function classifyAndSave(bundle: Bundle, family: Family, ctx: Context) {
  if (!worthClassifying(bundle)) {
    removeBundle(bundle);
    count(family, 'rules');
    ctx.store.save();
    return;
  }

  let classification: Classification | undefined;
  try {
    classification = await classify(bundle, ctx.transport(family.id));
  } catch (error) {
    logger.warn(`classification failed for family ${family.id}: ${error}`);
  }

  if (!bundles.includes(bundle)) return; // a forget deleted it while the classification was in flight
  removeBundle(bundle);

  if (!classification) {
    count(family, 'failed');
    ctx.store.save();
    return;
  }

  count(family, classification.verdict);
  if (classification.verdict !== 'family_moment' && classification.verdict !== 'sensitive') {
    ctx.store.save();
    return;
  }

  const words = typedText(bundle) || classification.transcript;
  const moment: Moment = {
    id: randomUUID(),
    by: bundle.sender,
    messageIds: bundle.events.map((event) => event.messageId),
    savedAt: ctx.now(),
    text: words || classification.title,
    photo: bundle.events.find((event) => event.photo)?.photo,
    video: bundle.events.find((event) => event.video)?.video,
    voice: bundle.events.find((event) => event.voice)?.voice,
    salience: classification.salience,
    people: classification.people,
    eventDate: classification.eventDate,
    title: classification.title,
    sensitive: classification.verdict === 'sensitive' || bundle.sensitive === true,
    stories: [],
    lookbacks: [],
    memoryPostIds: [],
    returns: {},
  };
  if (!words) moment.wordless = true;
  if (classification.tags.length) moment.tags = classification.tags;
  if (classification.description) moment.description = classification.description;
  family.moments.push(moment);
  ctx.store.save();
  await react(ctx, family, family.chatId, bundle.events[0].messageId, '\u2764');
}

export const capture: Feature = {
  name: 'capture',
  async handle(event, family, ctx) {
    // a button tap is never a message, and shares sits after capture, so its taps must pass through
    if (event.chat !== 'group' || !family || event.button !== undefined) return false;

    if (!passesRules(event)) {
      count(family, 'rules');
      ctx.store.save();
      return true;
    }

    const candidates = bundles.filter(
      (bundle) => bundle.family === family && bundle.sender.id === event.sender.id && !bundle.closing && !bundle.sealed,
    );
    const open = candidates[candidates.length - 1];
    const last = open?.events[open.events.length - 1];
    if (open && last && event.at - last.at <= BUNDLE_GAP_MS) {
      const sameAlbum = (other: Incoming) => event.albumId !== undefined && other.albumId === event.albumId;
      const newPicture = hasPicture(event) && open.events.some((other) => hasPicture(other) && !sameAlbum(other));
      if (!newPicture) {
        open.events.push(event);
        return true;
      }
      open.sealed = true;
    }
    bundles.push({ family, sender: event.sender, events: [event] });
    return true;
  },

  async tick(family, _window, ctx) {
    const due = bundles.filter((bundle) => bundle.family === family && !bundle.closing && isClosed(bundle, Date.now()));
    await Promise.all(due.map((bundle) => close(bundle, family, ctx)));
  },
};
