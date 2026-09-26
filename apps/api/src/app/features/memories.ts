import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { dayIndex, slotIn } from '../core/clock';
import { grounded } from '../core/grounded';
import { cut, dateOf, lines } from '../core/lines';
import { byPriority, isAnniversary } from '../core/priority';
import type { Context, Family, Feature, Incoming, Media, Moment } from '../core/types';
import { ask, transcribe, valid } from '../model/model';
import { react } from './capture/capture';
import { ADDRESS, isCommand, pictureOf, wordCount } from './capture/filter';

const logger = new Logger('Memories');
const AGES = ['7', '30', '365'] as const;

export function dueKeys(moment: Moment, now: number): string[] {
  if (moment.sensitive) return [];
  const keys: string[] = [];
  for (const age of AGES) {
    if (dayIndex(now) - dayIndex(moment.savedAt) >= Number(age) && !moment.lookbacks.includes(age)) keys.push(age);
  }
  const anniversaryKey = `anniversary-${new Date(now).getFullYear()}`;
  if (isAnniversary(moment.eventDate, now) && !moment.lookbacks.includes(anniversaryKey)) keys.push(anniversaryKey);
  return keys;
}

export function labelFor(moment: Moment, keys: string[]): string {
  const anniversaryKey = keys.find((key) => key.startsWith('anniversary-'));
  if (anniversaryKey) return lines.labels.anniversary(Number(moment.eventDate?.slice(0, 4)));
  const age = [...AGES].reverse().find((candidate) => keys.includes(candidate)) ?? '7';
  return lines.labels[age];
}

function firstDue(moments: Moment[], now: number) {
  const priority = byPriority(now);
  return moments
    .map((moment) => ({ moment, keys: dueKeys(moment, now) }))
    .filter((item) => item.keys.length > 0)
    .sort((a, b) => priority(a.moment, b.moment))[0];
}

const eventTime = (moment: Moment) => (moment.eventDate ? new Date(`${moment.eventDate}T12:00`).getTime() : moment.savedAt);

const hasTag = (moment: Moment, tag: string) => (moment.tags ?? []).some((item) => item.toLowerCase() === tag.toLowerCase());

/**
 * Section 4.16: the picked moment and up to 5 other moments with a picture, oldest first. The others share the picked
 * moment's most shared tag, or, for a named request, come from the moments that the intent call picked.
 */
function collectionOf(family: Family, picked: Moment, asked?: Moment[]): { moments: Moment[]; tag: string } {
  const pool = (asked ?? family.moments).filter((moment) => moment !== picked && !moment.sensitive && pictureOf(moment));
  const shared = (tag: string) => pool.filter((moment) => hasTag(moment, tag)).length;
  const tag = [...(picked.tags ?? [])].sort((a, b) => shared(b) - shared(a))[0];
  const others = pool
    .filter((moment) => asked || (tag !== undefined && hasTag(moment, tag)))
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 5);
  if (!pictureOf(picked) || others.length === 0) return { moments: [picked], tag: picked.title };
  return { moments: [picked, ...others].sort((a, b) => eventTime(a) - eventTime(b)), tag: tag ?? picked.title };
}

const CAPTION_SCHEMA = { type: 'object', properties: { caption: { type: 'string' } }, required: ['caption'] };

// section 4.16: the model writes a warm caption from the words of each sharer and each story; undefined means a failed call or a caption with a
// number, a name, or a quote that the moments do not hold, so the caller falls back to a fixed caption
export async function captionFor(label: string, moments: Moment[], tag?: string): Promise<string | undefined> {
  const facts = moments.map((moment) => {
    const stories = moment.stories.map((story) => `${story.by.name}: «${cut(story.text, 200)}»`).join(' ');
    return `- ${lines.sharedBy(moment)} (${dateOf(moment)})${stories ? ` Stories: ${stories}` : ''}`;
  });
  const prompt = [
    "You are Anchor, the keeper of this family's photos and stories. You are not a person.",
    `Write the caption of a photo album that Anchor sends to the family with the label "${label}": ${moments.length} family moments${tag ? ` about ${tag}` : ''}.`,
    ...facts,
    'Write one or two short sentences in plain, warm English, at most 160 characters, the way a family member captions an album. Name who shared the moments.',
    'You may quote a few words of a sharer or of a story, word for word, in «».',
    'Mention a date only when it tells when the moments happened. Use only what the moments say. Never judge the photos with words such as "charming" or "special".',
    'Never invent a fact, a feeling, or a memory, and never write "I remember" or "I love".',
  ].join('\n');
  try {
    const answer = await ask<{ caption?: unknown }>(prompt, CAPTION_SCHEMA, { fast: true });
    const caption = cut(valid.text(answer?.caption), 600);
    if (caption && grounded(caption, [label, tag ?? '', String(moments.length), ...facts])) return caption;
  } catch (error) {
    logger.warn(`the collection caption call failed: ${error}`);
  }
  return undefined;
}

const groupCaption = async (label: string, tag: string, moments: Moment[]) => {
  const caption = await captionFor(label, moments, tag);
  return caption ? `${caption}\n${lines.collectionReply}` : lines.collectionCaption(label, tag, moments);
};

async function post(family: Family, moment: Moment, label: string, keys: string[], ctx: Context, asked?: Moment[]) {
  moment.lookbacks.push(...keys);
  const { moments: collection, tag } = collectionOf(family, moment, asked);
  family.lastShown = collection.map((item) => item.id);
  const message =
    collection.length > 1
      ? { album: collection.flatMap((item) => pictureOf(item) ?? []), text: await groupCaption(label, tag, collection) }
      : { ...pictureOf(moment), text: lines.memoryCaption(label, moment) };
  try {
    const sent = await ctx.transport(family.id).send(family.chatId, message);
    // a reply to one album item adds its story to that item's moment
    const ids = sent.messageIds ?? [sent.messageId];
    collection.forEach((item, index) => item.memoryPostIds.push(ids[index] ?? sent.messageId));
  } catch (error) {
    logger.warn(`failed to post a memory for family ${family.id}: ${error}`);
  }
  ctx.store.save();
}

// section 4.3: posts a group memory now, as /memory and the `memory` intent both do; a named request brings back the moments it names (4.16)
export async function postMemoryNow(family: Family, ctx: Context, asked: Moment[] = []): Promise<void> {
  const lead = asked.find((moment) => pictureOf(moment)) ?? asked[0];
  if (lead) return post(family, lead, lines.labels.fromRecord, [], ctx, asked);
  const shareable = family.moments.filter((moment) => !moment.sensitive);
  if (shareable.length === 0) {
    await ctx.transport(family.id).send(family.chatId, { text: lines.nothingToShare });
    return;
  }
  const now = ctx.now();
  const due = firstDue(shareable, now);
  if (due) {
    await post(family, due.moment, labelFor(due.moment, due.keys), due.keys, ctx);
    return;
  }
  const fewest = [...shareable].sort((a, b) => a.memoryPostIds.length - b.memoryPostIds.length || byPriority(now)(a, b))[0];
  await post(family, fewest, lines.labels.fromRecord, [], ctx);
}

async function transcribeVoice(voice: Media, family: Family, ctx: Context): Promise<string> {
  try {
    const clip = await ctx.transport(family.id).download(voice);
    const transcript = await transcribe(clip);
    return transcript || lines.voiceNote;
  } catch {
    return lines.voiceNote;
  }
}

async function handleStory(event: Incoming, family: Family, ctx: Context): Promise<boolean> {
  const replyTo = event.replyTo;
  if (!replyTo) return false;
  if (ADDRESS.test(event.text ?? '')) return false;
  if (event.text?.startsWith('/')) return false;
  const moment = family.moments.find((item) => item.memoryPostIds.includes(replyTo));
  if (!moment || event.unsupported || event.forwarded) return false;
  if (!event.voice && wordCount(event.text) < 3) return false;

  const text = event.voice && !event.text ? await transcribeVoice(event.voice, family, ctx) : (event.text ?? '');

  if (!family.moments.includes(moment)) return true;

  moment.stories.push({ id: randomUUID(), by: event.sender, at: ctx.now(), text, voice: event.voice, messageIds: [event.messageId] });
  ctx.store.save();
  await react(ctx, family, event.chatId, event.messageId, '\u2764');
  return true;
}

export const memories: Feature = {
  name: 'memories',

  async tick(family, window, ctx) {
    const slot = slotIn(window, 18);
    if (slot === undefined || family.lastMemoryDay === dayIndex(slot)) return;
    family.lastMemoryDay = dayIndex(slot);
    const due = firstDue(family.moments, slot);
    if (!due) {
      ctx.store.save();
      return;
    }
    await post(family, due.moment, labelFor(due.moment, due.keys), due.keys, ctx);
  },

  async handle(event, family, ctx) {
    if (event.chat !== 'group' || !family) return false;
    if (isCommand(event.text, '/memory')) return postMemoryNow(family, ctx).then(() => true);
    return handleStory(event, family, ctx);
  },
};
