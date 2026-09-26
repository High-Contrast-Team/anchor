process.env.TZ = 'Europe/Athens';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { FakeTransport } from '../../core/fake-transport';
import { FADE_MS } from '../../core/offers';
import { lines } from '../../core/lines';
import { createRouter } from '../../core/router';
import { openStore } from '../../core/store';
import { Blocked, type Context, type Family, type Feature, type Incoming, type Store } from '../../core/types';
import { ask } from '../../model/model';
import { fastforward } from '../fastforward';
import { offerInPrivate, reminders } from './reminders';

vi.mock('../../model/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model/model')>()),
  ask: vi.fn(),
}));

const PILLS = 'Dad, remember to take your pills with you when we leave in the morning.';
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const NIKOS = { id: '42', name: 'Nikos' };
const ELENI = { id: '7', name: 'Eleni' };

let now: number;
let store: Store;
let family: Family;
let transport: FakeTransport;
let ctx: Context;
let seen: Incoming[];
let router: ReturnType<typeof createRouter>;

// stands in for members and capture, so a test sees whether the event still reaches them
const after: Feature = {
  name: 'after',
  async handle(event) {
    seen.push(event);
    return event.chat === 'private';
  },
};

beforeEach(() => {
  vi.mocked(ask).mockReset();
  now = at(25, 12);
  store = openStore(join(mkdtempSync(join(tmpdir(), 'anchor-reminders-')), 'state.json'));
  family = store.addFamily('-100', '-100');
  store.joinMember(family, NIKOS).started = true;
  store.joinMember(family, ELENI).started = true;
  transport = new FakeTransport();
  transport.admins.add(ELENI.id);
  ctx = { now: () => now + store.state.clockOffset, store, transport: () => transport, restartWindow: vi.fn() };
  seen = [];
  router = createRouter([fastforward, reminders, after], ctx);
});

const nikos = () => family.members[0];
const group = (text: string, sender = ELENI, extra: Partial<Incoming> = {}): Incoming => ({
  familyId: '-100',
  chat: 'group',
  chatId: '-100',
  messageId: '9',
  sender,
  at: now,
  text,
  ...extra,
});
const pills = () => group(PILLS, ELENI, { replyTo: '5', replyToSender: NIKOS });
const tap = (data: string, sender = NIKOS, messageId = 'sent-1'): Incoming => ({
  familyId: '-100',
  chat: 'group',
  chatId: '-100',
  messageId,
  sender,
  at: now,
  button: data,
  ephemeral: true,
});
const privately = (text: string, sender = NIKOS): Incoming => ({ chat: 'private', chatId: sender.id, messageId: '70', sender, at: now, text });
const tick = () => router.tick({ from: ctx.now() - 2000, to: ctx.now() });

async function offer(answer: object = { offer: true, who: '42', time: '08:00' }) {
  vi.mocked(ask).mockResolvedValue(answer);
  await router.route(pills());
  return family.offers[0]?.id;
}

test('the pills sentence offers Nikos a reminder at 08:00 that only he sees, and capture still sees the message', async () => {
  const id = await offer();
  expect(transport.sent).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      message: {
        text: `⏰ Eleni wrote: «${PILLS}»\nShall I remind you?`,
        buttons: [
          { label: 'Yes, at 08:00', data: `rem:${id}:08:00` },
          { label: 'Pick another time', data: `rem:${id}:more` },
          { label: 'No, thanks', data: `rem:${id}:no` },
          { label: 'Stop offering reminders', data: `rem:${id}:stop` },
        ],
        onlyFor: '42',
      },
    },
  ]);
  expect(family.reminders).toEqual([
    { id: expect.stringMatching(/^[0-9a-f]{8}$/), to: '42', from: ELENI, text: PILLS, sourceId: '9', time: '08:00', status: 'offered' },
  ]);
  expect(family.offers).toEqual([{ id, kind: 'reminder', to: '42', messageId: 'sent-1', at: now, ref: family.reminders[0].id }]);
  expect(family.moments).toEqual([]);
  expect(seen).toEqual([pills()]);
});

test('Nikos sets the reminder, and /fastforward 08:05 delivers it to him in private', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  expect(transport.edits).toEqual([{ chatId: '-100', messageId: 'sent-1', change: { text: "Done ✍ I'll remind you at 08:00 in our private chat.", onlyFor: '42' } }]);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: '9', emoji: '✍', big: undefined }]);
  expect(family.reminders[0]).toMatchObject({ status: 'set', due: at(26, 8) });
  expect(family.offers).toEqual([]);

  await tick();
  expect(transport.sent).toHaveLength(1);

  await router.route(group('/fastforward 08:05'));
  expect(ctx.restartWindow).toHaveBeenCalledOnce();
  await tick();
  expect(transport.sent.at(-1)).toEqual({ chatId: '42', messageId: 'sent-3', message: { text: `⏰ Your reminder. Eleni wrote: «${PILLS}»` } });
  expect(family.reminders[0]).toMatchObject({ status: 'sent', sentAt: ctx.now() });

  await tick();
  expect(transport.sent).toHaveLength(3);
});

test('a reminder for the sender reads "You wrote"', async () => {
  await offer({ offer: true, who: '7', time: '08:00' });
  expect(transport.sent[0].message).toMatchObject({ text: `⏰ You wrote: «${PILLS}»\nShall I remind you?`, onlyFor: '7' });
  expect(family.reminders[0].to).toBe('7');
});

test('an offer with no time shows the four default times', async () => {
  const id = await offer({ offer: true, who: '42', time: '' });
  expect(transport.sent[0].message.buttons).toEqual([
    { label: 'Yes, at 08:00', data: `rem:${id}:08:00` },
    { label: 'Yes, at 12:00', data: `rem:${id}:12:00` },
    { label: 'Yes, at 18:00', data: `rem:${id}:18:00` },
    { label: 'Yes, at 21:00', data: `rem:${id}:21:00` },
    { label: 'No, thanks', data: `rem:${id}:no` },
    { label: 'Stop offering reminders', data: `rem:${id}:stop` },
  ]);
  await router.route(tap(`rem:${id}:18:00`));
  expect(family.reminders[0]).toMatchObject({ time: '18:00', status: 'set', due: at(25, 18) });
});

test('every button data holds at most 64 bytes', async () => {
  await offer();
  for (const button of transport.sent[0].message.buttons ?? []) expect(Buffer.byteLength(button.data ?? '')).toBeLessThanOrEqual(64);
});

test('"Another time" swaps the buttons in place for four times around the suggestion', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:more`));
  expect(transport.edits).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      change: {
        buttons: [
          { label: 'Yes, at 07:00', data: `rem:${id}:07:00` },
          { label: 'Yes, at 07:30', data: `rem:${id}:07:30` },
          { label: 'Yes, at 08:30', data: `rem:${id}:08:30` },
          { label: 'Yes, at 09:00', data: `rem:${id}:09:00` },
          { label: 'No, thanks', data: `rem:${id}:no` },
        ],
        onlyFor: '42',
      },
    },
  ]);
  expect(family.offers).toHaveLength(1);
  await router.route(tap(`rem:${id}:07:30`));
  expect(family.reminders[0]).toMatchObject({ time: '07:30', status: 'set', due: at(26, 7, 30) });
});

test('"No thanks" removes the offer and the reminder', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:no`));
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'sent-1', onlyFor: '42' }]);
  expect(family.offers).toEqual([]);
  expect(family.reminders).toEqual([]);
});

test('"Stop offering reminders" turns the choice off, and no offer comes again', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:stop`));
  expect(transport.edits).toEqual([{ chatId: '-100', messageId: 'sent-1', change: { text: lines.offersOff, onlyFor: '42' } }]);
  expect(nikos().choices.reminders).toBe(false);
  expect(family.offers).toEqual([]);
  expect(family.reminders).toEqual([]);

  await offer();
  expect(transport.sent).toHaveLength(1);
});

test('a member who never started gets a Start button, and /start r_<id> sets the reminder before the welcome', async () => {
  nikos().started = false;
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  const reminder = family.reminders[0];
  expect(reminder.status).toBe('waiting');
  expect(transport.edits).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      change: {
        text: "Tap Start, and I'll remind you at 08:00 in our private chat 🙂",
        buttons: [{ label: 'Start', url: `https://t.me/anchor_test_bot?start=r_${reminder.id}` }],
        onlyFor: '42',
      },
    },
  ]);
  expect(transport.reactions).toEqual([]);
  expect(family.offers).toHaveLength(1);

  seen = [];
  await router.route(privately(`/start r_${reminder.id}`));
  expect(reminder).toMatchObject({ status: 'set', due: at(26, 8) });
  expect(transport.sent.at(-1)).toEqual({ chatId: '42', messageId: 'sent-2', message: { text: "Done ✍ I'll remind you here at 08:00." } });
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: '9', emoji: '✍', big: undefined }]);
  expect(seen).toHaveLength(1);
});

test('/start r_<id> from another person, or for a reminder that is not waiting, changes nothing', async () => {
  const id = await offer();
  const reminder = family.reminders[0];
  await router.route(privately(`/start r_${reminder.id}`));
  expect(reminder.status).toBe('offered');
  nikos().started = false;
  await router.route(tap(`rem:${id}:08:00`));
  await router.route(privately(`/start r_${reminder.id}`, ELENI));
  expect(reminder.status).toBe('waiting');
  expect(transport.sent).toHaveLength(1);
});

test('a tap from anybody but the recipient changes nothing', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`, ELENI));
  expect(family.reminders[0].status).toBe('offered');
  expect(transport.edits).toEqual([]);
  expect(transport.removed).toEqual([]);
});

test('a tap on an offer that faded or closed removes the tapped message and changes nothing', async () => {
  await router.route(tap('rem:deadbeef:08:00', NIKOS, 'eph-3'));
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'eph-3', onlyFor: '42' }]);
  expect(seen).toEqual([]);
});

test('an unanswered offer fades after 10 minutes and deletes its reminder', async () => {
  await offer();
  now += FADE_MS - 1;
  await tick();
  expect(transport.removed).toEqual([]);
  now += 1;
  await tick();
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'sent-1', onlyFor: '42' }]);
  expect(family.offers).toEqual([]);
  expect(family.reminders).toEqual([]);
});

test('an offer that waits for Start fades and deletes its reminder', async () => {
  nikos().started = false;
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  now += FADE_MS;
  await tick();
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'sent-1', onlyFor: '42' }]);
  expect(family.reminders).toEqual([]);
});

test('a confirmed reminder outlives the fade of its Start offer', async () => {
  nikos().started = false;
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  await router.route(privately(`/start r_${family.reminders[0].id}`));
  now += FADE_MS;
  await tick();
  expect(family.reminders).toEqual([expect.objectContaining({ status: 'set' })]);
});

test('a reminder to a member who blocked Anchor counts as sent', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  vi.spyOn(transport, 'send').mockRejectedValue(new Blocked());
  now = at(26, 8);
  await tick();
  expect(family.reminders[0].status).toBe('sent');
  expect(nikos().started).toBe(false);
});

test('a member who turned reminders off gets no reminder', async () => {
  const id = await offer();
  await router.route(tap(`rem:${id}:08:00`));
  nikos().choices.reminders = false;
  now = at(26, 8);
  await tick();
  expect(transport.sent).toHaveLength(1);
  expect(family.reminders[0].status).toBe('sent');
});

test('a member with reminders off gets no offer', async () => {
  nikos().choices.reminders = false;
  await offer();
  expect(transport.sent).toEqual([]);
  expect(family.reminders).toEqual([]);
});

test('the sender joins the family before the call', async () => {
  vi.mocked(ask).mockResolvedValue({ offer: true, who: '8', time: '' });
  await router.route(group('Remind me to call the plumber tomorrow', { id: '8', name: 'Maria' }));
  expect(family.members.map((member) => member.id)).toEqual(['42', '7', '8']);
  expect(transport.sent[0].message.onlyFor).toBe('8');
});

test('a mention of someone who is not a member gets no offer', async () => {
  vi.mocked(ask).mockResolvedValue({ offer: true, who: 'unknown', time: '' });
  await router.route(group('@odisseasmk , remember to receive your prize tomorrow'));
  expect(transport.sent).toEqual([]);
  expect(family.reminders).toEqual([]);
});

test('a weekday after tomorrow makes no call and no offer', async () => {
  await router.route(group('@odisseasmk , remember to receive your prize on Sunday'));
  expect(ask).not.toHaveBeenCalled();
  expect(transport.sent).toEqual([]);
  expect(seen).toHaveLength(1);
});

test('a message that does not pass the gate makes no call', async () => {
  await router.route(group('Maria on her first day at school'));
  expect(ask).not.toHaveBeenCalled();
  expect(seen).toHaveLength(1);
});

test('a failed offer send keeps no reminder', async () => {
  vi.spyOn(transport, 'send').mockRejectedValue(new Error('not an admin'));
  await offer();
  expect(family.reminders).toEqual([]);
  expect(family.offers).toEqual([]);
});

const privateTap = (data: string, sender = NIKOS, messageId = 'sent-1'): Incoming => ({ chat: 'private', chatId: sender.id, messageId, sender, at: now, button: data });

test('a private request gets the offer in private, with no stop button, and a tap sets it and answers with a new line', async () => {
  await offerInPrivate(family, nikos(), 'remind me about my pills', '', '70', ctx);
  const id = family.reminders[0].id;
  expect(transport.sent).toEqual([
    {
      chatId: '42',
      messageId: 'sent-1',
      message: {
        text: '⏰ «remind me about my pills»\nWhen shall I remind you?',
        buttons: [...['08:00', '12:00', '18:00', '21:00'].map((time) => ({ label: `Yes, at ${time}`, data: `rem:${id}:${time}` })), { label: 'No, thanks', data: `rem:${id}:no` }],
      },
    },
  ]);
  expect(family.offers).toEqual([]);

  nikos().choices.reminders = false;
  await router.route(privateTap(`rem:${id}:18:00`));
  expect(transport.edits).toEqual([{ chatId: '42', messageId: 'sent-1', change: { buttons: [] } }]);
  expect(transport.sent.at(-1)).toMatchObject({ chatId: '42', message: { text: "Done ✍ I'll remind you here at 18:00." } });
  expect(family.reminders[0]).toMatchObject({ status: 'set', due: at(25, 18) });
  expect(nikos().choices.reminders).toBe(true);
  expect(seen).toEqual([]);

  now = at(25, 18, 1);
  await tick();
  expect(transport.sent.at(-1)).toMatchObject({ chatId: '42', message: { text: '⏰ Your reminder. You wrote: «remind me about my pills»' } });
});

test('a private offer with a time swaps to the times around it, and "No thanks" drops the reminder', async () => {
  await offerInPrivate(family, nikos(), 'remind me to call Eleni at 18:00', '18:00', '70', ctx);
  const id = family.reminders[0].id;
  await router.route(privateTap(`rem:${id}:more`));
  expect(transport.edits.at(-1)?.change.buttons?.map((button) => button.data)).toEqual([
    ...['17:00', '17:30', '18:30', '19:00'].map((time) => `rem:${id}:${time}`),
    `rem:${id}:no`,
  ]);
  await router.route(privateTap(`rem:${id}:no`));
  expect(family.reminders).toEqual([]);
  expect(transport.sent.at(-1)?.message.text).toBe(lines.notNow);
  await router.route(privateTap(`rem:${id}:18:00`));
  expect(transport.edits.at(-1)).toEqual({ chatId: '42', messageId: 'sent-1', change: { buttons: [] } });
});

test('a group message that tells a birthday saves it, and each member who started gets an offer in private, except the person', async () => {
  store.joinMember(family, { id: '9', name: 'Maria' }).started = true;
  store.joinMember(family, { id: '11', name: 'Dimitris' });
  vi.mocked(ask).mockResolvedValue({ birthdays: [{ name: 'Maria', date: '10-03' }, { name: 'Nobody', date: '13-40' }] });
  const text = "Don't forget, Maria's birthday is on 3 October!";

  await router.route(group(text));

  expect(family.birthdays).toEqual([{ name: 'Maria', date: '10-03', from: ELENI }]);
  expect(family.offers).toEqual([]);
  expect(transport.sent.map((sent) => [sent.chatId, sent.message.text])).toEqual([
    ['42', "🎂 Eleni mentioned Maria's birthday on 3 October. Shall I remind you that morning?"],
    ['7', "🎂 You mentioned Maria's birthday on 3 October. Shall I remind you that morning?"],
  ]);
  const id = family.reminders[0].id;
  expect(transport.sent[0].message.buttons).toEqual([
    { label: 'Yes, remind me', data: `rem:${id}:yes` },
    { label: 'No, thanks', data: `rem:${id}:no` },
  ]);
  expect(seen).toEqual([group(text)]);

  await router.route(group(text));
  expect(transport.sent).toHaveLength(2);
});

test('"Yes, remind me" sets the birthday reminder, and 09:00 on the day delivers it', async () => {
  vi.mocked(ask).mockResolvedValue({ birthdays: [{ name: 'Maria', date: '10-03' }] });
  await router.route(group("Maria's birthday is on 3 October"));
  const id = family.reminders[0].id;

  await router.route(privateTap(`rem:${id}:yes`));
  expect(transport.sent.at(-1)).toMatchObject({ chatId: '42', message: { text: "Done ✍ I'll remind you of Maria's birthday on 3 October at 09:00." } });
  expect(family.reminders[0]).toMatchObject({ status: 'set', due: new Date(2026, 9, 3, 9).getTime() });

  now = new Date(2026, 9, 3, 9, 0, 1).getTime();
  await tick();
  expect(transport.sent.at(-1)).toMatchObject({ chatId: '42', message: { text: "🎂 Today is Maria's birthday." } });
});

test('a birthday today, a message with no birthday word, and a failed call send no birthday offer', async () => {
  vi.mocked(ask).mockResolvedValue({ birthdays: [{ name: 'Maria', date: '09-25' }] });
  await router.route(group('Happy birthday, Maria!'));
  expect(family.birthdays).toEqual([{ name: 'Maria', date: '09-25', from: ELENI }]);

  vi.mocked(ask).mockReset();
  await router.route(group('See you at lunch'));
  vi.mocked(ask).mockRejectedValue(new Error('down'));
  await router.route(group("Nikos's birthday is on 1 October"));
  expect(transport.sent).toEqual([]);
});

test('"No thanks" on a birthday offer drops the reminder that "this month\'s birthdays" already set', async () => {
  vi.mocked(ask).mockResolvedValue({ birthdays: [{ name: 'Maria', date: '09-30' }] });
  await router.route(group("Maria's birthday is on the 30th"));
  const id = family.reminders[0].id;
  family.reminders[0].status = 'set';

  await router.route(privateTap(`rem:${id}:no`));

  expect(family.reminders.filter((item) => item.to === '42')).toEqual([]);
});

test('a birthday that just passed is saved, and gets no offer a year away', async () => {
  vi.mocked(ask).mockResolvedValue({ birthdays: [{ name: 'Maria', date: '09-24' }] });
  await router.route(group("Maria's birthday was yesterday, what a party!"));
  expect(family.birthdays).toEqual([{ name: 'Maria', date: '09-24', from: ELENI }]);
  expect(transport.sent).toEqual([]);
});
