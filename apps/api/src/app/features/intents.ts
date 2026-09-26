import { Logger } from '@nestjs/common';
import { WEEK_MS } from '../core/clock';
import { dateOf, lines } from '../core/lines';
import { tell } from '../core/tell';
import type { Context, Family, Feature, Incoming, Member, Moment } from '../core/types';
import * as model from '../model/model';
import { answerInGroup, choiceLine } from './ask';
import { actOnReply } from './capture/capture';
import { ADDRESS, fixedIntent, pictureOf, privateIntent } from './capture/filter';
import { callMember } from './calls';
import { sendMe } from './invitations';
import { postMemoryNow } from './memories';
import { groupNextSteps, nextSteps, nudge, showChoices, stopMember } from './members';
import { birthdaysThisMonth } from './reminders/birthdays';
import { TIME_RULE } from './reminders/offer';
import { makeOffer, offerInPrivate } from './reminders/reminders';
import { TIME } from './reminders/rules';
import { answer, answerTalk, remember } from './talk';

const logger = new Logger('Intents');
const ABOUT = /\b(?:of|about|with)\b/i;
const MEMORY_WORDS = /\b(?:memor(?:y|ies)|photos?|pictures?|pics|moments?|albums?|show (?:me|us))\b/i;
// "Give me a memory", "can we have a moment?", or "any memories?" asks for any memory and only makes sense to Anchor, so it posts one without
// "Anchor," or a subject; a bare "Memories!" or "a moment please" stays family talk
const ANY_MEMORY =
  /^(?:(?:can|could|would|will) you |please )?(?:(?:(?:show|give|share|post|tell)(?: me| us)?|send us|(?:i|we)(?: want| would like|['’]d like)|(?:can|could|may) (?:i|we) (?:have|see|get)) (?:(?:a|another|some|any|one more) )?(?:family )?(?:memor(?:y|ies)|moments?)|(?:a|another|some|any|one more) (?:family )?memor(?:y|ies))(?: please)?[?.!]*$/i;
// "Call me" only makes sense to Anchor, so it rings the writer without "Anchor,"; "call me when you land" and a reply to a person stay family talk
const CALL_ME = /^(?:(?:can|could|would|will) you |please )?call me(?: please| now)?[?.!]*$/i;
// "more memories of Lucy" leaves out the moments of the latest group memory
const MORE = /\b(?:more|other|others|another|else|different)\b/i;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the words of a title or a description that name no subject, so "photos of the trip" never matches "The photo shows the sea"
const FILLER = new Set(['the', 'and', 'with', 'from', 'for', 'her', 'his', 'its', 'our', 'their', 'this', 'that', 'near', 'next', 'into', 'onto', 'over', 'under', 'one', 'two', 'some', 'other', 'shows', 'photo', 'video']);
const subjectWords = (moment: Moment) =>
  `${moment.title} ${moment.description ?? ''}`.split(/[^\p{L}\p{N}'’-]+/u).filter((word) => !FILLER.has(word.toLowerCase()));

// ponytail: one regex per tag, person, and title word on each gated message; build one alternation when a record reaches thousands of moments
// title and picture words count only in a request about a subject, so "the photos when I get home" never reaches the intent call
function namesKnownSubject(family: Family, text: string): boolean {
  const about = ABOUT.test(text);
  return family.moments.some(
    (moment) =>
      !moment.sensitive &&
      [...(moment.tags ?? []), ...moment.people, ...(about ? subjectWords(moment) : [])].some(
        (name) => name.length > 2 && new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text),
      ),
  );
}

const INTENTS = ['memory', 'find', 'sendMe', 'missed', 'settings', 'stop', 'callMe', 'forget', 'quiet', 'remind', 'birthdays', 'talk', 'unclear'] as const;
type Intent = (typeof INTENTS)[number];

// section 6.7: one line per intent, with one example each; the demo phrases carry the wording
const INTENT_EXAMPLES: Partial<Record<Intent, string>> = {
  memory: '"Anchor, show us a memory", "I want a memory of Lucy", or "photos of Lucy" asks Anchor to post a family memory now.',
  find: '"Anchor, when did Maria start school?" asks Anchor to find a moment and answer with it.',
  sendMe: '"Anchor, can you send me the family photos?" or "Send me a moment" asks Anchor to send a moment in private, and names no person, pet, or place. Never memory.',
  missed: '"What did I miss?" asks for the moments the family shared since the person last talked to Anchor.',
  settings: '"Anchor, settings" asks to see or change what Anchor sends.',
  stop: '"stop" asks Anchor to stop sending anything.',
  callMe: '"Call me" asks Anchor to ring the person on the phone.',
  forget: '"Anchor, delete that" or "Anchor, forget that one" asks Anchor to delete a moment.',
  quiet: "\"Anchor, don't show me that one again\" asks Anchor to keep a moment without bringing it back.",
  remind: '"Remind me about my pills" or "remind me to call Eleni tonight" asks Anchor to remind the person of something.',
  birthdays: '"Remind me about this month\'s birthdays" or "whose birthday is coming up?" asks about the family birthdays. Never remind.',
  talk: '"Tell me about Lucy", "When is lunch on Sunday?", or "How are you?" is a question or a chat that Anchor answers in words. Only in a private chat.',
};

// a text message needs no transcript, so only a voice note asks the model to write one
function schemaFor(momentIds: string[], hasVoice: boolean) {
  return {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: [...INTENTS] },
      momentId: { type: 'string', enum: [...momentIds, 'none'] },
      momentIds: { type: 'array', items: { type: 'string', enum: [...momentIds, 'none'] } },
      time: { type: 'string' },
      ...(hasVoice ? { transcript: { type: 'string' } } : {}),
    },
    required: ['intent', 'momentId', 'momentIds', 'time', ...(hasVoice ? ['transcript'] : [])],
  };
}

// ponytail: every shareable moment goes into the prompt; shortlist by people or date when a record reaches thousands of moments
function buildPrompt(chat: 'group' | 'private', text: string, hasVoice: boolean, moments: Moment[], addressed: boolean): string {
  const where = chat === 'group' ? 'the family group' : 'a private chat with one family member';
  return [
    `You are Anchor, the keeper of this family's record. This message came from ${where}${hasVoice ? ', as a voice note' : ''}: "${text}"`,
    ...(addressed
      ? []
      : [
          'The message does not name Anchor, and the family may be talking to each other. Pick memory when the message asks for family memories, photos, or moments, ' +
            'also in a short phrase such as "memories of the dog", "photos of Lucy?", or "show me Lucy". Otherwise, pick unclear.',
        ]),
    'Pick the intent that best matches the message:',
    ...Object.entries(INTENT_EXAMPLES)
      .filter(([intent]) => chat === 'private' || intent !== 'talk')
      .map(([intent, example]) => `- ${intent}: ${example}`),
    'Pick the id of the moment the message names or asks about, or "none" when it names none.',
    'For memory, when the message names a person, a pet, a place, or an activity, list in momentIds every moment about it, from the titles and the tags. ' +
      'Include a moment that names the same person or pet only by a general word, such as a "dog" moment when another moment shows that the family dog is Lucy, ' +
      'and for a general word such as "the dog", include every moment about the family dog by its name. Otherwise, momentIds is empty.',
    ...(MORE.test(text) ? ['The message asks for more or other moments, so list every moment about it, also each moment that shows it only by a general word.'] : []),
    `For remind: ${TIME_RULE} For any other intent, time is empty.`,
    ...(hasVoice ? ['Set transcript to the words of the voice note.'] : []),
    ...moments.map(choiceLine),
  ].join('\n');
}

async function readIntent(
  family: Family,
  event: Incoming,
  chat: 'group' | 'private',
  text: string,
  moments: Moment[],
  ctx: Context,
  addressed = true,
): Promise<{ intent: Intent; momentId?: string; momentIds: string[]; time?: string; transcript?: string }> {
  const momentIds = moments.map((moment) => moment.id);
  // the text holds the transcript of a voice note, so the model hears the clip only when the transcription failed
  const heard = event.text ? undefined : event.voice;
  const schema = schemaFor(momentIds, !!heard);
  try {
    const clip = heard ? await ctx.transport(family.id).download(heard) : undefined;
    const prompt = buildPrompt(chat, text, !!heard, moments, addressed);
    const answer = await model.ask<{ intent?: unknown; momentId?: unknown; momentIds?: unknown; time?: unknown; transcript?: unknown }>(
      prompt,
      schema,
      clip ? { media: [clip] } : {},
    );
    const intent = model.valid.oneOf(answer.intent, INTENTS) ?? 'unclear';
    const momentId = model.valid.oneOf(answer.momentId, [...momentIds, 'none']);
    const picked = Array.isArray(answer.momentIds) ? answer.momentIds.filter((id) => momentIds.includes(id)) : [];
    const time = typeof answer.time === 'string' && TIME.test(answer.time) ? answer.time : '';
    return { intent, momentId, momentIds: picked, time, transcript: model.valid.text(answer.transcript, 2000) || undefined };
  } catch (error) {
    logger.warn(`intent call failed: ${error}`);
    return { intent: 'unclear', momentIds: [] };
  }
}

// 'none' matches no moment id
const findAsked = (family: Family, momentId?: string) => family.moments.find((item) => item.id === momentId && !item.sensitive);

async function unclearGroup(event: Incoming, family: Family, ctx: Context): Promise<boolean> {
  await ctx.transport(family.id).send(event.chatId, { text: lines.unclear, replyTo: event.messageId, buttons: groupNextSteps(family, ctx) });
  return true;
}

// the call choice can be on without a number, when the member skipped the share button after the toggle
async function doCallMe(family: Family, member: Member, ctx: Context): Promise<void> {
  if (!member.phone) {
    await tell(family, member, { text: lines.askPhone, buttons: [{ label: lines.buttons.sharePhone, contact: true }] }, ctx);
    return;
  }
  const ok = await callMember(family, member, ctx);
  if (!ok) await tell(family, member, { text: lines.callFailed, buttons: nextSteps(member, 'callMe') }, ctx);
}

async function groupAction(
  intent: Intent,
  momentId: string | undefined,
  event: Incoming,
  family: Family,
  member: Member,
  ctx: Context,
  momentIds: string[],
  addressed: boolean,
): Promise<boolean> {
  switch (intent) {
    case 'memory': {
      const picked = [...new Set([momentId, ...momentIds])].flatMap((id) => findAsked(family, id) ?? []);
      const seen = new Set(MORE.test(event.text ?? '') ? family.lastShown : []);
      const asked = picked.filter((moment) => !seen.has(moment.id));
      if (picked.length && !asked.length) {
        await ctx.transport(family.id).send(event.chatId, { text: lines.noMoreMoments, replyTo: event.messageId });
        return true;
      }
      // an unaddressed request names a subject, so it gets an answer only when the record holds a moment about it
      if (!addressed && !asked.length) return false;
      await postMemoryNow(family, ctx, asked);
      return true;
    }
    case 'find': {
      const moment = findAsked(family, momentId);
      if (!moment) {
        await ctx.transport(family.id).send(event.chatId, { text: lines.notFound, replyTo: event.messageId });
        return true;
      }
      await answerInGroup(family, moment, event.messageId, ctx, member, (event.text ?? '').replace(ADDRESS, ''));
      return true;
    }
    case 'sendMe':
    case 'missed':
      if (member.started) await sendMe(family, member, ctx);
      else await nudge(family, member, ctx);
      return true;
    case 'settings':
    case 'stop':
      await nudge(family, member, ctx);
      return true;
    case 'callMe':
      if (member.started) await doCallMe(family, member, ctx);
      else await nudge(family, member, ctx);
      return true;
    case 'remind':
      if (await makeOffer(family, { ...event, text: (event.text ?? '').replace(ADDRESS, '') }, ctx)) return true;
      return unclearGroup(event, family, ctx);
    case 'birthdays':
      if (member.started) await birthdaysThisMonth(family, member, event.messageId, ctx);
      else await nudge(family, member, ctx);
      return true;
    case 'forget':
    case 'quiet':
      if (!event.replyTo) return unclearGroup(event, family, ctx);
      await actOnReply(event, family, ctx, intent === 'forget');
      return true;
    default:
      return unclearGroup(event, family, ctx);
  }
}

async function inGroup(event: Incoming, family: Family, ctx: Context): Promise<boolean> {
  const text = event.text ?? '';
  const anyMemory = !event.forwarded && event.replyTo === undefined && ANY_MEMORY.test(text.replace(ADDRESS, '').trim());
  if (event.button === 'nxt:memory' || anyMemory) {
    await postMemoryNow(family, ctx);
    return true;
  }

  const addressed = ADDRESS.test(text) || (event.replyTo === undefined && CALL_ME.test(text.trim()));
  // section 4.16: a message without "Anchor," reaches the intent call only when it asks about memories or photos of a subject that the record
  // knows, and never as a reply to a person
  if (event.forwarded || (!addressed && (event.replyTo !== undefined || !MEMORY_WORDS.test(text) || !namesKnownSubject(family, text)))) return false;
  const question = text.replace(ADDRESS, '');

  const isNew = !family.members.some((candidate) => candidate.id === event.sender.id);
  const member = ctx.store.joinMember(family, event.sender);
  if (isNew) ctx.store.save();

  const moments = family.moments.filter((moment) => !moment.sensitive);
  const phrase = addressed ? fixedIntent(question) : undefined;
  // "send me photos of Lucy" names a subject, so the model decides between sendMe and a memory of Lucy (4.16)
  const fixed = phrase === 'sendMe' && /\bof\b/i.test(question) ? undefined : phrase;
  const { intent, momentId, momentIds } = fixed
    ? { intent: fixed, momentId: undefined, momentIds: [] }
    : await readIntent(family, event, 'group', question, moments, ctx, addressed);
  // an unaddressed message gets an answer only when the intent call reads a memory request, so family talk stays untouched
  if (!addressed && intent !== 'memory') return false;
  return groupAction(intent, momentId, event, family, member, ctx, momentIds, addressed);
}

async function unclearPrivate(family: Family, member: Member, ctx: Context): Promise<boolean> {
  await tell(family, member, { text: lines.unclear, buttons: nextSteps(member) }, ctx);
  return true;
}

// a question gets the answer in words first, then the moment as its source; a failed or unchecked answer leaves the moment with askAnswer
async function privateFind(momentId: string | undefined, family: Family, member: Member, ctx: Context, question?: string): Promise<void> {
  const moment = findAsked(family, momentId);
  if (!moment) {
    await tell(family, member, { text: lines.notFound, buttons: nextSteps(member, 'find') }, ctx);
    return;
  }
  const reply = question ? await answer(family, member, question, ctx, 'private', moment) : undefined;
  if (question && reply?.grounded) {
    remember(member, question, reply.text);
    await tell(family, member, { text: reply.text }, ctx);
    await tell(family, member, { ...pictureOf(moment), text: lines.source(moment), buttons: nextSteps(member, 'find') }, ctx);
  } else {
    const names = [...new Set(moment.stories.map((story) => story.by.name))];
    await tell(
      family,
      member,
      { ...pictureOf(moment), text: lines.askAnswer(moment.title, dateOf(moment), names), buttons: nextSteps(member, 'find') },
      ctx,
    );
  }
  const voiceStory = moment.stories.find((story) => story.voice);
  if (voiceStory) await tell(family, member, { voice: voiceStory.voice }, ctx);
  if (moment.savedAt > (member.seenAt ?? 0)) member.seenAt = moment.savedAt;
  ctx.store.save();
}

async function privateMissed(family: Family, member: Member, ctx: Context): Promise<void> {
  const since = member.seenAt ?? ctx.now() - WEEK_MS;
  const candidates = family.moments
    .filter((moment) => !moment.sensitive && moment.by.id !== member.id && moment.savedAt > since)
    .sort((a, b) => a.savedAt - b.savedAt);
  if (!candidates.length) {
    await tell(family, member, { text: lines.nothingNew, buttons: nextSteps(member, 'missed') }, ctx);
    return;
  }
  await tell(family, member, { text: lines.missed(candidates.length) }, ctx);
  const toSend = candidates.slice(0, 3);
  for (const [index, moment] of toSend.entries()) {
    const last = index === toSend.length - 1;
    await tell(family, member, { ...pictureOf(moment), text: lines.sharedBy(moment), ...(last ? { buttons: nextSteps(member, 'missed') } : {}) }, ctx);
  }
  member.seenAt = toSend[toSend.length - 1].savedAt;
  ctx.store.save();
}

async function privateAction(
  intent: Intent,
  momentId: string | undefined,
  family: Family,
  member: Member,
  ctx: Context,
  sourceId = '',
): Promise<boolean> {
  switch (intent) {
    case 'memory':
    case 'sendMe':
      await sendMe(family, member, ctx);
      return true;
    case 'find':
      await privateFind(momentId, family, member, ctx);
      return true;
    case 'missed':
      await privateMissed(family, member, ctx);
      return true;
    case 'settings':
      await showChoices(family, member, lines.choicesScreen, ctx);
      return true;
    case 'stop':
      await stopMember(family, member, ctx);
      return true;
    case 'callMe':
      await doCallMe(family, member, ctx);
      return true;
    case 'birthdays':
      await birthdaysThisMonth(family, member, sourceId, ctx);
      return true;
    default:
      return unclearPrivate(family, member, ctx);
  }
}

async function inPrivate(event: Incoming, family: Family, ctx: Context): Promise<boolean> {
  const member = family.members.find((candidate) => candidate.id === event.sender.id);
  if (!member) return false;

  const nxt = event.button?.match(/^nxt:(.+)$/);
  if (nxt) {
    const intent = model.valid.oneOf(nxt[1], INTENTS);
    if (!intent) return unclearPrivate(family, member, ctx);
    return privateAction(intent, undefined, family, member, ctx);
  }
  if (event.button) return unclearPrivate(family, member, ctx);
  if (!event.text && !event.voice) return unclearPrivate(family, member, ctx);

  const moments = family.moments.filter((moment) => !moment.sensitive);
  const text = event.text ?? '';
  const fixed = privateIntent(text);
  const reading: Awaited<ReturnType<typeof readIntent>> = fixed
    ? { intent: fixed, momentIds: [] }
    : await readIntent(family, event, 'private', text, moments, ctx);
  const said = event.text ?? reading.transcript;
  if (reading.intent === 'remind' && said) {
    await offerInPrivate(family, member, said, reading.time ?? '', event.messageId, ctx);
    return true;
  }
  // a private memory request that names a subject sends a moment about it, with a picture when one has one
  const named = reading.intent === 'memory' ? [reading.momentId, ...reading.momentIds].flatMap((id) => findAsked(family, id) ?? []) : [];
  const lead = named.find((moment) => pictureOf(moment)) ?? named[0];
  if (lead) {
    await privateFind(lead.id, family, member, ctx);
    return true;
  }
  // a question with no moment to show, or a message that asks for nothing Anchor can do, gets an answer in words, with the group chat as the context
  const talks = reading.intent === 'talk' || reading.intent === 'unclear' || (reading.intent === 'find' && !findAsked(family, reading.momentId));
  if (talks && said && (await answerTalk(family, member, said, ctx))) return true;
  if (reading.intent === 'find') {
    await privateFind(reading.momentId, family, member, ctx, said);
    return true;
  }
  return privateAction(reading.intent, reading.momentId, family, member, ctx, event.messageId);
}

export const intents: Feature = {
  name: 'intents',
  async handle(event, family, ctx) {
    if (!family) return false;
    return event.chat === 'group' ? inGroup(event, family, ctx) : inPrivate(event, family, ctx);
  },
};
