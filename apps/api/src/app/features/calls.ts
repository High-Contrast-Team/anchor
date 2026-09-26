import { Logger } from '@nestjs/common';
import { type CallRecord, storyOf } from '../call/bridge';
import { answered, connected, ring } from '../call/dial';
import { mulawWav } from '../call/ogg';
import { expectCall, STREAM_PATH } from '../call/stream';
import { dayIndex, slotIn } from '../core/clock';
import { lines } from '../core/lines';
import { tell } from '../core/tell';
import type { Context, Family, Feature, Member, Moment, Reminder, Window } from '../core/types';
import { shareStory } from './invitations';
import { clock, familyContext } from './talk';

const log = new Logger('Calls');

const DAILY_HOUR = 11;
// a call lasts at most 10 minutes, so a stream that never arrives frees its token after 12
const CALL_LIMIT_MS = 12 * 60_000;

/** The voice speaks a line without its emoji, and without the line breaks of a chat message. */
export const spoken = (line: string) =>
  line
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([»,.!?])/g, '$1')
    .trim();

// ponytail: a phrase list, so a story sentence such as "I don't know how she did it" drops too; a model check replaces it when that loses real stories
const LAPSE = /\b(?:don['’]?t|do not|can['’]?t|cannot|can not) (?:remember|recall|know)\b|\bi['’]?m not sure\b|\bi am not sure\b|\bi (?:forget|forgot)\b/i;

/** The member's words without the sentences that say they don't remember, so the family never reads a lapse (spec section 1). */
export const withoutLapses = (text: string) =>
  (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !LAPSE.test(sentence))
    .join(' ');

export const newestMoment = (family: Family, member: Member) =>
  family.moments
    .filter((moment) => moment.by.id !== member.id && !moment.sensitive && !moment.stories.some((story) => story.by.id === member.id))
    .sort((a, b) => b.savedAt - a.savedAt)[0];

const reminderLine = (reminder: Reminder) =>
  reminder.birthday ? lines.birthdayToday(reminder.birthday) : lines.reminder(reminder.from.name, reminder.text);
const readReminder = (reminder: Reminder) =>
  reminder.birthday ? `read the reminder «${spoken(reminderLine(reminder))}»` : `read a reminder that ${reminder.from.name} wrote: «${spoken(reminder.text)}»`;

// every call answers a question about the family from the record and the group chat, as the private talk does
function callWith(family: Family, member: Member, now: number, steps: string[]) {
  return [
    `You are Anchor, the family's record keeper, on a phone call with ${member.name}, a member of the family.`,
    'You are not a person. Never claim feelings or a shared past of your own.',
    ...steps,
    'Speak slowly and clearly, in simple English. There is no right answer.',
    'Never mention memory loss, recall, tests, hints, or scores.',
    `When ${member.name} asks about the family, answer in one or two short sentences.`,
    `On the family clock it is now ${clock(now)}.`,
    ...familyContext(family),
  ].join('\n');
}

const questions = (member: Member, next: string) =>
  `Answer each question, then ask whether ${member.name} has another one. When ${member.name} has no more questions, ${next}`;

function withoutMoment(family: Family, member: Member, now: number, reminder?: Reminder) {
  const end = `say out loud: "${spoken(lines.call.goodbye(member.name))}" Then call end_call with share no and tell_sender false.`;
  return callWith(family, member, now, [
    reminder
      ? `You have already said the opening line, and ${readReminder(reminder)} Answer a short question about the reminder if ${member.name} asks one, in one short sentence. Then say: "${lines.call.askAnything}"`
      : `You have already said the opening line, and said: "${lines.call.askAnything}"`,
    questions(member, end),
  ]);
}

function instructions(family: Family, member: Member, moment: Moment, connect: boolean, now: number, reminder?: Reminder) {
  const goodbye = `"${spoken(lines.call.goodbye(member.name))}"`;
  return callWith(family, member, now, [
    `You have already said the opening line.${reminder ? ` It ${readReminder(reminder)} If ${member.name} asks about the reminder, answer in one short sentence, then go back to the moment.` : ''} It quoted a moment that ${moment.by.name} shared in the family chat, and asked what it reminds ${member.name} of: ${spoken(lines.sharedBy(moment))}`,
    "Take one step per turn, and wait for the person's answer before the next step:",
    `1. Listen, and let ${member.name} talk as long as they like. Answer warmly in one short sentence. Ask at most one short follow-up question about what they told you, or skip it when they have said enough. The follow-up invites and never tests: ask how it felt or who was there, and never ask for a name, a date, or a fact. When ${member.name} does not remember something, say that it does not matter, and move on.`,
    `2. Ask: "${lines.call.askShare}"`,
    `3. Say: "${lines.call.askAnything}" ${questions(member, 'go to the next step.')}`,
    `4. Ask: "${connect ? lines.call.connect(moment.by.name) : lines.call.reachPerson(moment.by.name)}"`,
    connect
      ? `5. If ${member.name} said yes, say out loud: "${spoken(lines.call.connecting(member.name, moment.by.name))}" Otherwise say out loud: ${goodbye} Then call end_call with their answers.`
      : `5. Say out loud: ${goodbye} Then call end_call with their answers.`,
    `When ${member.name} says goodbye or that they are done, say a short goodbye out loud, then call end_call.`,
  ]);
}

async function afterCall(family: Family, member: Member, moment: Moment, record: CallRecord, ctx: Context) {
  const story = storyOf(record);
  const text = withoutLapses(story.text);
  if (record.shareAsked && (record.share === 'voice' || record.share === 'words') && text) {
    // the voice would still say the dropped lapse, so a trimmed story goes out as words only
    const withVoice = record.share === 'voice' && story.audio.length > 0 && text === story.text.trim();
    // the private send uploads the clip once, and the group post reuses its file id
    const sent = withVoice ? await tell(family, member, { voice: { wav: mulawWav(story.audio) }, text: lines.shared }, ctx) : undefined;
    await shareStory(family, member, moment, { text, voice: sent?.voice }, ctx);
  }
  // the connected call rings the sharer for 20 seconds; a sharer who never picks up gets the ask in the group
  const reached = record.dialed === true && record.callSid !== undefined && (await connected(record.callSid).catch(() => false));
  if (record.tellSender || (record.connect && !reached)) {
    await ctx
      .transport(family.id)
      .send(family.chatId, { text: lines.wouldLoveCall(member.name, moment.by.name), mention: moment.by })
      .catch((error) => log.warn(`The call request for ${moment.by.id} failed: ${error}`));
  }
}

async function follow(sid: string, call: ReturnType<typeof expectCall>, family: Family, member: Member, moment: Moment | undefined, ctx: Context) {
  try {
    if (!(await answered(sid))) return call.forget();
    let limit: NodeJS.Timeout | undefined;
    const record = await Promise.race([call.ended, new Promise<undefined>((done) => (limit = setTimeout(() => done(undefined), CALL_LIMIT_MS)))]);
    clearTimeout(limit);
    if (!record) return call.forget();
    if (moment) await afterCall(family, member, moment, record, ctx);
  } catch (error) {
    call.forget();
    log.warn(`The call ${sid} to member ${member.id} failed: ${error}`);
  }
}

/**
 * Rings the member with a reminder, then about the newest moment that someone else shared and the member has no story for, and answers questions about the
 * family. A call with neither opens with the questions. Resolves once Twilio accepts the call, because the poll awaits each update; the answer, the
 * conversation, and the share run in the background.
 */
export async function callMember(family: Family, member: Member, ctx: Context, reminder?: Reminder): Promise<boolean> {
  const base = process.env.ANCHOR_PUBLIC_URL;
  const moment = newestMoment(family, member);
  if (!member.phone || !process.env.TWILIO_FROM || !base) return false;
  const connectTo = moment && family.members.find((other) => other.id === moment.by.id)?.phone;
  const goodbye = spoken(lines.call.goodbye(member.name));
  const opener = [lines.call.opening(member.name), reminder && reminderLine(reminder), moment ? `${lines.spokenMoment(moment)}\n${lines.remindYou}` : !reminder && lines.call.askAnything]
    .filter(Boolean)
    .map(spoken)
    .join(' ');
  const call = expectCall(
    moment
      ? { instructions: instructions(family, member, moment, connectTo !== undefined, ctx.now(), reminder), opener, askShare: lines.call.askShare, goodbye, connectTo }
      : { instructions: withoutMoment(family, member, ctx.now(), reminder), opener, goodbye },
  );
  let sid: string;
  try {
    sid = await ring(member.phone, `${base.replace(/^http/, 'ws').replace(/\/$/, '')}${STREAM_PATH}`, call.token);
  } catch (error) {
    call.forget();
    log.warn(`Twilio refused a call to member ${member.id}: ${error}`);
    return false;
  }
  await tell(family, member, { text: lines.calling }, ctx);
  void follow(sid, call, family, member, moment, ctx);
  return true;
}

/** 11:00 on the demo-clock day of the last daily call. */
function lastCallAt(member: Member): number {
  if (member.lastCallDay === undefined) return -Infinity;
  const day = new Date(member.lastCallDay * 86_400_000);
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), DAILY_HOUR).getTime();
}

export const calls: Feature = {
  name: 'calls',
  async tick(family: Family, window: Window, ctx: Context) {
    const slot = slotIn(window, DAILY_HOUR);
    for (const member of family.members) {
      if (!member.started || !member.choices.call || !member.phone) continue;
      // ponytail: one call per member per tick, so a second reminder in the same window arrives in private only
      const reminder = family.reminders.find((item) => item.to === member.id && item.sentAt !== undefined && item.sentAt > window.from && item.sentAt <= window.to);
      if (reminder) {
        // a moment read after the reminder counts as the daily call, so 11:00 never rings about it again
        if ((await callMember(family, member, ctx, reminder)) && newestMoment(family, member)) {
          member.lastCallDay = dayIndex(window.to);
          ctx.store.save();
        }
        continue;
      }
      const moment = newestMoment(family, member);
      if (slot === undefined || member.lastCallDay === dayIndex(slot) || !moment || moment.savedAt <= lastCallAt(member)) continue;
      member.lastCallDay = dayIndex(slot);
      ctx.store.save();
      await callMember(family, member, ctx);
    }
  },
};
