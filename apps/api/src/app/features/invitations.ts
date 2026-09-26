import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dayIndex, slotIn } from '../core/clock';
import { dateOf, lines } from '../core/lines';
import { shortId } from '../core/offers';
import { byPriority } from '../core/priority';
import { tell } from '../core/tell';
import type { Button, Context, Family, Feature, Incoming, Invitation, Media, Member, Moment, Outgoing, Person, Transport } from '../core/types';
import { ask, valid } from '../model/model';
import { react } from './capture/capture';
import { asksAnchor, pictureOf, privateIntent, wordCount } from './capture/filter';
import { captionFor } from './memories';
import { nextSteps } from './members';

const WEEK_MS = 7 * 86_400_000;
const MAX_MOMENTS = 5;
const KINDS = ['story', 'unsure', 'question', 'request', 'other'] as const;
const REPLY_SCHEMA = {
  type: 'object',
  properties: { transcript: { type: 'string' }, kind: { type: 'string', enum: KINDS } },
  required: ['transcript', 'kind'],
};
// the old single-moment buttons carry a moment id, so they match too, and a tap on them only removes them
const BUTTON = /^inv:(\w+):(.+)$/;
const QUESTION_WORD = /^(who|what|where|when|which|why)\b/i;
const logger = new Logger('Invitations');

type Reading = { kind: (typeof KINDS)[number]; transcript: string };

// the spike of 2026-09-26, decisions 6 and 10: up to 5 moments of the past week, the member's own included, oldest first; a week with no moment
// takes the 5 newest, so a run of more than 7 jumps still gets a memory
export function weekOf(family: Family, member: Member, slot: number): Moment[] {
  const hidden = new Set(member.hidden);
  const shown = family.moments
    .filter((moment) => !moment.sensitive && !hidden.has(moment.id) && moment.savedAt <= slot)
    .sort((a, b) => b.savedAt - a.savedAt);
  const week = shown.filter((moment) => slot - moment.savedAt <= WEEK_MS);
  return (week.length ? week : shown).slice(0, MAX_MOMENTS).reverse();
}

// the member who shared the most moments other than this member, and the earlier sharer on a tie; the moments come oldest first
function topSharer(moments: Moment[], member: Member): Person | undefined {
  const others = moments.filter((moment) => moment.by.id !== member.id);
  const count = (id: string) => others.filter((moment) => moment.by.id === id).length;
  return others.reduce<Person | undefined>((top, moment) => (!top || count(moment.by.id) > count(top.id) ? moment.by : top), undefined);
}

async function announce(family: Family, message: Outgoing, ctx: Context) {
  try {
    return await ctx.transport(family.id).send(family.chatId, message);
  } catch (error) {
    logger.warn(`A post in family ${family.id} failed: ${error}`);
    return undefined;
  }
}

async function setButtons(family: Family, member: Member, messageId: string, buttons: Button[], ctx: Context) {
  try {
    await ctx.transport(family.id).edit(member.id, messageId, { buttons });
  } catch (error) {
    logger.warn(`The buttons of message ${messageId} to member ${member.id} failed to edit: ${error}`);
  }
}

const memoryButtons = (id: string): Button[] => [
  { label: lines.buttons.tellMeMore, data: `inv:more:${id}` },
  { label: lines.buttons.replyToFamily, data: `inv:reply:${id}` },
  { label: lines.buttons.notNow, data: `inv:later:${id}` },
];

const replyButtons = (id: string): Button[] =>
  lines.familyReplies.map(([emoji, words], index) => ({ label: `${emoji} ${words}`, data: `inv:say${index}:${id}` }));

const isOpen = (family: Family, member: Member, invitation: Invitation, moment: Moment) =>
  member.invitation === invitation && family.moments.includes(moment) && !moment.sensitive;

// the album or the picture carries the caption, and one message with the buttons follows, because an album carries no buttons
async function deliver(family: Family, member: Member, moments: Moment[], ctx: Context, caption?: string) {
  const sharer = topSharer(moments, member);
  const lead = [...moments].reverse().find((moment) => moment.by.id === sharer?.id) ?? moments[moments.length - 1];
  const invitation: Invitation = { id: shortId(), momentId: lead.id, momentIds: moments.map((moment) => moment.id), shareAsked: false, helped: false };
  member.invitation = invitation;
  member.seenAt = Math.max(member.seenAt ?? 0, ...moments.map((moment) => moment.savedAt));
  for (const moment of moments) moment.returns[member.id] = { count: (moment.returns[member.id]?.count ?? 0) + 1 };
  ctx.store.save();

  const [one] = moments;
  const head = moments.length > 1 ? lines.weekMemory(caption ?? lines.weekShared(moments)) : lines.sharedBy(one);
  const spokenHead = moments.length > 1 ? head : lines.spokenMoment(one);
  const pictures = moments.flatMap((moment) => pictureOf(moment) ?? []);
  if (pictures.length) await tell(family, member, { ...(pictures.length > 1 ? { album: pictures } : pictures[0]), text: head }, ctx);
  const text = pictures.length ? lines.remindYou : `${head}\n${lines.remindYou}`;
  if (member.started && member.invitation === invitation) {
    await tell(family, member, { text, buttons: memoryButtons(invitation.id) }, ctx, `${spokenHead}\n${lines.remindYou}`);
  }
  // tell turned started off for a member who blocked Anchor, so the memory closes
  if (!member.started && member.invitation === invitation) {
    member.invitation = undefined;
    ctx.store.save();
  }
}

// v2, section 4.5: a share offer and "Send me a moment" send a memory of one moment, and replace the open memory
export async function sendNow(family: Family, member: Member, moment: Moment, ctx: Context) {
  await deliver(family, member, [moment], ctx);
}

// the sendMe intent: the moment with the fewest returns to this member, and byPriority breaks a tie
export async function sendMe(family: Family, member: Member, ctx: Context) {
  const priority = byPriority(ctx.now());
  const hidden = new Set(member.hidden);
  const returns = (moment: Moment) => moment.returns[member.id]?.count ?? 0;
  const [moment] = family.moments
    .filter((item) => !item.sensitive && item.by.id !== member.id && !hidden.has(item.id))
    .sort((a, b) => returns(a) - returns(b) || priority(a, b));
  if (moment) return sendNow(family, member, moment, ctx);
  await tell(family, member, { text: lines.nothingNew, buttons: nextSteps(member, 'sendMe') }, ctx);
}

async function tellMore(invitation: Invitation, moments: Moment[], family: Family, member: Member, ctx: Context) {
  const buttons = [
    { label: lines.buttons.replyToFamily, data: `inv:reply:${invitation.id}` },
    { label: lines.buttons.dontShowThese, data: `inv:hide:${invitation.id}` },
  ];
  const voices = moments.flatMap((moment) => (moment.voice ? [moment.voice] : []));
  await tell(family, member, { text: lines.aboutMoments(moments), ...(voices.length ? {} : { buttons }) }, ctx, lines.aboutMoments(moments, true));
  for (const [index, voice] of voices.entries()) await tell(family, member, { voice, ...(index === voices.length - 1 ? { buttons } : {}) }, ctx);
}

// a tap changes the tapped buttons in place, so it never waits for a new voice note; only "Tell me more" and the call question send one
async function tap(action: string, event: Incoming, invitation: Invitation, family: Family, member: Member, ctx: Context) {
  const moments = invitation.momentIds.flatMap((id) => family.moments.find((moment) => moment.id === id && !moment.sensitive) ?? []);
  const change = (buttons: Button[]) => setButtons(family, member, event.messageId, buttons, ctx);
  const done = (label: string) => change([{ label, data: `inv:done:${invitation.id}` }]);
  const words = lines.familyReplies[Number(action.match(/^say(\d)$/)?.[1])];
  const sharer = topSharer(moments, member);
  if (!moments.length) {
    member.invitation = undefined;
    ctx.store.save();
    await change([]);
  } else if (action === 'more') {
    await tellMore(invitation, moments, family, member, ctx);
  } else if (action === 'reply') {
    if (!invitation.said) await change(replyButtons(invitation.id));
  } else if (action === 'later') {
    await done(lines.done.later);
  } else if (action === 'nocall') {
    await change([]);
  } else if (action === 'hide') {
    member.hidden = [...new Set([...(member.hidden ?? []), ...invitation.momentIds])];
    member.invitation = undefined;
    ctx.store.save();
    await done(lines.done.hidden);
  } else if (words && !invitation.said) {
    invitation.said = true;
    ctx.store.save();
    await done(lines.done.sent);
    const lead = moments.find((moment) => moment.id === invitation.momentId);
    await announce(family, { text: lines.familyReply(member.name, words), replyTo: lead?.messageIds[0] }, ctx);
    if (!sharer) return;
    const buttons = [
      { label: lines.buttons.askCall(sharer.name), data: `inv:call:${invitation.id}` },
      { label: lines.buttons.noThanks, data: `inv:nocall:${invitation.id}` },
    ];
    await tell(family, member, { text: lines.askCall(sharer.name), buttons }, ctx);
  } else if (action === 'call' && !sharer) {
    await change([]);
  } else if (action === 'call' && !invitation.askedCall) {
    invitation.askedCall = true;
    ctx.store.save();
    await done(lines.done.askedCall(sharer.name));
    await announce(family, { text: lines.wouldLoveCall(member.name, sharer.name), mention: sharer }, ctx);
  }
}

async function inPrivate(event: Incoming, family: Family, member: Member, ctx: Context): Promise<boolean> {
  const [, action, id] = event.button?.match(BUTTON) ?? [];
  if ((event.button && !action) || event.text?.startsWith('/')) return false;
  // a fixed phrase such as "settings" or "what did I miss?" goes to intents, and the open memory stays open; a longer story that names
  // birthdays or choices in passing goes to the reply call, which still reads a request
  if (!action && ((wordCount(event.text) <= 6 && privateIntent(event.text)) || asksAnchor(event.text))) return false;
  if (action === 'done') return true;
  const invitation = member.invitation;
  if (action && invitation?.id !== id) {
    await setButtons(family, member, event.messageId, [], ctx);
    return true;
  }
  if (!invitation) return false;
  if (action && action !== 'share' && action !== 'keep') {
    await tap(action, event, invitation, family, member, ctx);
    return true;
  }
  const moment = family.moments.find((item) => item.id === invitation.momentId);
  if (!moment || moment.sensitive) {
    member.invitation = undefined;
    ctx.store.save();
    return false;
  }
  if (!action) return reply(event, invitation, moment, family, member, ctx);
  await settle(action, invitation, moment, family, member, ctx);
  return true;
}

const gentleHelp = (moment: Moment) => lines.gentleHelp(dateOf(moment), moment.title);
const tellDirectly = (moment: Moment) => lines.tellDirectly(moment.title, dateOf(moment), moment.by.name);

async function explain(text: string, invitation: Invitation, moment: Moment, family: Family, member: Member, ctx: Context) {
  await tell(family, member, { text }, ctx);
  if (moment.voice && isOpen(family, member, invitation, moment)) await tell(family, member, { voice: moment.voice }, ctx);
}

export async function shareStory(family: Family, person: Person, moment: Moment, story: { text: string; voice?: Media }, ctx: Context) {
  const added = await announce(
    family,
    { text: lines.storyAdded(person.name, moment.by.name, story.text), replyTo: moment.messageIds[0], mention: moment.by },
    ctx,
  );
  if (added) await react(ctx, family, family.chatId, added.messageId, '\u2764', true);
  const spoken = story.voice ? await announce(family, { voice: story.voice }, ctx) : undefined;
  if (family.moments.includes(moment)) {
    moment.stories.push({
      id: randomUUID(),
      by: { id: person.id, name: person.name },
      at: ctx.now(),
      text: story.text,
      voice: story.voice,
      messageIds: [added?.messageId, spoken?.messageId].filter(Boolean),
    });
  }
  ctx.store.save();
}

async function settle(action: string, invitation: Invitation, moment: Moment, family: Family, member: Member, ctx: Context) {
  const story = invitation.story;
  if (action === 'share' && !story) return;
  member.invitation = undefined;
  if (action === 'keep') {
    ctx.store.save();
    await tell(family, member, { text: lines.notShared }, ctx);
  } else {
    await shareStory(family, member, moment, story, ctx);
    await tell(family, member, { text: lines.shared }, ctx);
  }
}

// false hands a request to Anchor on to intents, and the memory stays open
async function reply(event: Incoming, invitation: Invitation, moment: Moment, family: Family, member: Member, ctx: Context): Promise<boolean> {
  const reading: Reading =
    event.unsupported || event.forwarded
      ? { kind: 'other', transcript: '' }
      : (readShortQuestion(event) ?? (await readReply(event, moment, ctx.transport(family.id))));
  if (reading.kind === 'request') return false;
  if (!isOpen(family, member, invitation, moment)) return true;
  if (reading.kind === 'story') {
    const text = event.text ?? (event.voice ? reading.transcript || lines.voiceNote : '');
    invitation.story = invitation.story
      ? { text: `${invitation.story.text}\n${text}`, voice: invitation.story.voice ?? event.voice }
      : { text, voice: event.voice };
    const first = !invitation.shareAsked;
    invitation.shareAsked = true;
    ctx.store.save();
    if (!first) return true;
    const buttons = [
      { label: lines.buttons.share, data: `inv:share:${invitation.id}` },
      { label: lines.buttons.noThanks, data: `inv:keep:${invitation.id}` },
    ];
    await tell(family, member, { text: lines.thanks, buttons }, ctx);
    return true;
  }
  if (reading.kind === 'question') {
    await explain(tellDirectly(moment), invitation, moment, family, member, ctx);
    return true;
  }
  if (invitation.story) return true;
  if (reading.kind === 'unsure' && !invitation.helped) {
    invitation.helped = true;
    ctx.store.save();
    await explain(gentleHelp(moment), invitation, moment, family, member, ctx);
    return true;
  }
  member.invitation = undefined;
  ctx.store.save();
  await tell(family, member, { text: lines.warmClose }, ctx);
  return true;
}

// a short text that ends with "?" is a hesitation or a question, so code decides it and the model cannot turn it into a story
function readShortQuestion(event: Incoming): Reading | undefined {
  const text = event.text?.trim() ?? '';
  if (!text.endsWith('?') || wordCount(text) > 4) return undefined;
  return { kind: QUESTION_WORD.test(text) ? 'question' : 'unsure', transcript: '' };
}

async function readReply(event: Incoming, moment: Moment, transport: Transport): Promise<Reading> {
  try {
    const media = event.voice && !event.text ? [await transport.download(event.voice)] : [];
    const answer = await ask<{ kind?: unknown; transcript?: unknown } | null>(replyPrompt(event, moment), REPLY_SCHEMA, { media, fast: true });
    const kind = valid.oneOf(answer?.kind, KINDS);
    if (kind) return { kind, transcript: valid.text(answer.transcript) };
    logger.warn('The reply call returned no valid kind');
  } catch (error) {
    logger.warn(`The reply call failed: ${error}`);
  }
  return { kind: event.voice || wordCount(event.text) >= 3 ? 'story' : 'other', transcript: '' };
}

function replyPrompt(event: Incoming, moment: Moment) {
  return [
    "You read replies for Anchor, the keeper of a family's photos and stories.",
    'Anchor sent a moment that the family shared to a grandparent, one of the family members, and the grandparent replied in a private chat.',
    `The moment: ${moment.title}`,
    lines.sharedBy(moment),
    `The typed reply: «${event.text ?? ''}»`,
    'When the reply holds a voice note, set transcript to its words, verbatim. Otherwise set transcript to an empty string.',
    'Set kind to one of these values:',
    '- story: a detail, a feeling, or a memory that the moment brings back.',
    '- unsure: a hesitation, for example "a school?".',
    '- question: a direct question about what the moment is, for example "who is that?" or "what is this?".',
    '- request: a request or a question to Anchor about something else, for example "a memory of Lucy", "remind me about my pills", or "when is lunch on Sunday?".',
    '- other: an acknowledgement, for example "ok" or an emoji.',
  ].join('\n');
}

export const invitations: Feature = {
  name: 'invitations',

  async handle(event, family, ctx) {
    if (!family) return false;
    if (event.chat === 'group') return false;
    const member = family.members.find((person) => person.id === event.sender.id);
    return member ? inPrivate(event, family, member, ctx) : false;
  },

  // decisions 6 and 10: every started member with family moments gets the memory of the week at each 11:00, also after each /fastforward 1
  async tick(family, window, ctx) {
    const slot = slotIn(window, 11);
    if (slot === undefined) return;
    const day = dayIndex(slot);
    const captions = new Map<string, Promise<string | undefined>>();
    const caption = (moments: Moment[]) => {
      const key = moments.map((moment) => moment.id).join();
      if (!captions.has(key)) captions.set(key, captionFor(lines.weekLabel, moments));
      return captions.get(key);
    };
    const due = family.members.filter((member) => member.started && member.choices.moments && member.lastInvitationDay !== day);
    await Promise.all(
      due.map(async (member) => {
        member.invitation = undefined;
        member.lastInvitationDay = day;
        const moments = weekOf(family, member, slot);
        if (!moments.length) return ctx.store.save();
        await deliver(family, member, moments, ctx, moments.length > 1 ? await caption(moments) : undefined);
      }),
    );
  },
};
