process.env.TZ = 'Europe/Athens';

import { Logger } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { openStore } from '../core/store';
import { speak } from '../model/model';
import type { Choices, Context, Family, Incoming } from '../core/types';
import { CHOICES, choiceButtons, members, nextSteps } from './members';

vi.mock('../model/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/model')>()),
  ask: vi.fn(),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));

const wav = Buffer.from('RIFF clip');

const ALL_OFF: Choices = { moments: false, reminders: false, shares: false, voice: false, call: false };
const DEFAULT_CHOICES: Choices = { moments: true, reminders: true, shares: true, voice: false, call: false };

let now: number;
let file: string;
let transport: FakeTransport;
let ctx: Context;
let family: Family;
let sequence: number;

const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();

const fromNikos = (overrides: Partial<Incoming>): Incoming => ({
  chat: 'private',
  chatId: '7',
  messageId: `p${++sequence}`,
  sender: { id: '7', name: 'Nikos' },
  at: now,
  ...overrides,
});

const inGroup = (overrides: Partial<Incoming>): Incoming => ({
  familyId: '-100',
  chat: 'group',
  chatId: '-100',
  messageId: `g${++sequence}`,
  sender: { id: '7', name: 'Nikos' },
  at: now,
  ...overrides,
});

const receive = (event: Incoming) =>
  members.handle(event, event.chat === 'group' ? ctx.store.family(event.familyId) : ctx.store.familyOfMember(event.sender.id), ctx);

const messages = () => transport.sent.map(({ chatId, message }) => [chatId, message]);
const nikos = () => family.members[0];
const saved = () => openStore(file).family('-100');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(speak).mockResolvedValue(wav);
  now = at(25, 12);
  sequence = 0;
  file = join(mkdtempSync(join(tmpdir(), 'anchor-members-')), 'state.json');
  transport = new FakeTransport();
  const store = openStore(file, now);
  ctx = { now: () => now, store, transport: () => transport };
  family = store.addFamily('-100', '-100');
});

afterEach(() => {
  delete process.env.TWILIO_FROM;
});

test('a group message from a new, unstarted member sends the join nudge once, onlyFor the member, with the choose-for-me URL button', async () => {
  await receive(inGroup({ text: 'Good morning everyone' }));
  await receive(inGroup({ text: 'And again' }));
  expect(nikos()).toMatchObject({ id: '7', name: 'Nikos', started: false, nudged: true });
  expect(messages()).toEqual([
    ['-100', { text: lines.nudge('Nikos'), buttons: [{ label: lines.buttons.chooseForMe, url: transport.startLink('-100') }], onlyFor: '7' }],
  ]);
});

test('an "Anchor, ..." message joins the member but skips the nudge, because intents sends its own', async () => {
  await receive(inGroup({ text: 'Anchor, remind me tomorrow' }));
  expect(nikos().nudged).toBeFalsy();
  expect(messages()).toEqual([]);
});

test('a started member gets no nudge, and every group event returns false so capture still sees it', async () => {
  ctx.store.joinMember(family, { id: '7', name: 'Nikos' }).started = true;
  expect(await receive(inGroup({ text: 'hello' }))).toBe(false);
  expect(messages()).toEqual([]);

  expect(await receive(inGroup({ text: 'hello', button: 'x' }))).toBe(false);
  expect(await receive(inGroup({ text: 'hello', joined: true }))).toBe(false);
  expect(await receive(inGroup({ text: 'hello', migratedTo: '-200' }))).toBe(false);
  expect(await receive(inGroup({ text: 'hello', ephemeral: true }))).toBe(false);
});

test('/start with the family id as the payload joins a new person, starts them, and sends welcome with the choice buttons', async () => {
  expect(await receive(fromNikos({ text: '/start -100' }))).toBe(true);
  expect(saved()?.members).toEqual([{ id: '7', name: 'Nikos', started: true, choices: DEFAULT_CHOICES }]);
  expect(messages()).toEqual([['7', { text: lines.welcome('Nikos'), buttons: choiceButtons(nikos()) }]]);
});

test('/start r_<id> finds the family that holds that reminder and starts the member', async () => {
  family.reminders.push({ id: 'abc12345', to: '7', from: { id: '1', name: 'Sofia' }, text: 'buy milk', sourceId: '50', time: '08:00', status: 'offered' });
  expect(await receive(fromNikos({ text: '/start r_abc12345' }))).toBe(true);
  expect(nikos()).toMatchObject({ id: '7', started: true });
  expect(messages()).toEqual([['7', { text: lines.welcome('Nikos'), buttons: choiceButtons(nikos()) }]]);
});

test('/start with a family payload or a reminder payload, from a person outside the group, joins nothing and answers notInGroup', async () => {
  family.reminders.push({ id: 'abc12345', to: '1', from: { id: '1', name: 'Sofia' }, text: 'buy milk', sourceId: '50', time: '08:00', status: 'offered' });
  transport.outsiders.add('7');
  expect(await receive(fromNikos({ text: '/start -100' }))).toBe(true);
  expect(await receive(fromNikos({ text: '/start r_abc12345' }))).toBe(true);
  expect(family.members).toEqual([]);
  expect(messages()).toEqual([
    ['7', { text: lines.notInGroup }],
    ['7', { text: lines.notInGroup }],
  ]);
});

test('/start from a person already in the record needs no membership check', async () => {
  ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  const check = vi.spyOn(transport, 'isMember');
  await receive(fromNikos({ text: '/start -100' }));
  expect(check).not.toHaveBeenCalled();
  expect(nikos().started).toBe(true);
});

test('a membership check that fails joins nothing', async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(transport, 'isMember').mockRejectedValue(new Error('Telegram getChatMember 400: user not found'));
  expect(await receive(fromNikos({ text: '/start -100' }))).toBe(true);
  expect(family.members).toEqual([]);
  expect(messages()).toEqual([['7', { text: lines.notInGroup }]]);
});

test('/start with no payload from a member sends welcome with the choice buttons, and from a stranger goes to the router', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ text: '/start' }));
  expect(member.started).toBe(true);
  expect(messages()).toEqual([['7', { text: lines.welcome('Nikos'), buttons: choiceButtons(member) }]]);

  expect(await receive({ ...fromNikos({ text: '/start' }), chatId: '9', sender: { id: '9', name: 'Eleni' } })).toBe(false);
  expect(messages()).toHaveLength(1);
});

test('a payload that finds no family, from a person with no family, goes to the router, which answers pointer', async () => {
  expect(await receive(fromNikos({ text: '/start nope' }))).toBe(false);
  expect(messages()).toEqual([]);
  expect(family.members).toEqual([]);
});

test('each choice toggle flips the choice, saves, and edits the buttons of the tapped message in place', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  expect(await receive(fromNikos({ button: 'set:reminders', messageId: 'msg-1' }))).toBe(true);
  expect(member.choices.reminders).toBe(false);
  expect(transport.edits).toEqual([{ chatId: '7', messageId: 'msg-1', change: { buttons: choiceButtons(member) } }]);
  expect(saved()?.members[0].choices.reminders).toBe(false);
});

test('a failed edit logs and changes nothing else', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  vi.spyOn(transport, 'edit').mockRejectedValue(new Error('message gone'));
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  expect(await receive(fromNikos({ button: 'set:voice', messageId: 'msg-1' }))).toBe(true);
  expect(member.choices.voice).toBe(true);
  expect(warn).toHaveBeenCalled();
});

test('turning call on without a phone number sends askPhone with the contact button', async () => {
  process.env.TWILIO_FROM = '+15551234567';
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ button: 'set:call', messageId: 'msg-1' }));
  expect(member.choices.call).toBe(true);
  expect(messages()).toEqual([['7', { text: lines.askPhone, buttons: [{ label: lines.buttons.sharePhone, contact: true }] }]]);
});

test('turning call off sends no askPhone', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  member.choices.call = true;
  await receive(fromNikos({ button: 'set:call', messageId: 'msg-1' }));
  expect(member.choices.call).toBe(false);
  expect(messages()).toHaveLength(0);
});

test('an own contact sets the E.164 phone, then sends phoneSaved and a contact card when TWILIO_FROM is set', async () => {
  process.env.TWILIO_FROM = '+15551234567';
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ contact: { phone: '6971234567', userId: '7' } }));
  expect(member.phone).toBe('+6971234567');
  expect(messages()).toEqual([
    ['7', { text: lines.phoneSaved }],
    ['7', { contact: { phone: '+15551234567', name: 'Anchor' } }],
  ]);
});

test('a contact already in E.164 stays as it is', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ contact: { phone: '+306971234567', userId: '7' } }));
  expect(member.phone).toBe('+306971234567');
});

test("another user's contact changes nothing and sends askPhone again", async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ contact: { phone: '6971234567', userId: '99' } }));
  expect(member.phone).toBeUndefined();
  expect(messages()).toEqual([['7', { text: lines.askPhone, buttons: [{ label: lines.buttons.sharePhone, contact: true }] }]]);
});

test('Done sends choicesSaved with the names of the choices that are on, in CHOICES order, and the next steps, as a voice note with the voice choice', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  member.choices = { moments: true, reminders: false, shares: false, voice: true, call: false };
  await receive(fromNikos({ button: 'set:done' }));
  expect(messages()).toEqual([
    ['7', { text: lines.choicesSaved(['family moments', 'voice notes']), buttons: nextSteps(member, 'settings'), voice: { wav } }],
  ]);
});

test('stop turns every choice off, sets started false, closes the invitation, and sends stopped', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  member.started = true;
  member.choices = { moments: true, reminders: true, shares: true, voice: true, call: true };
  member.invitation = { id: 'abcd1234', momentId: 'm1', momentIds: ['m1'], shareAsked: false, helped: false };
  await receive(fromNikos({ text: '/stop' }));
  expect(member).toMatchObject({ started: false, choices: ALL_OFF, invitation: undefined });
  expect(messages()).toEqual([['7', { text: lines.stopped }]]);
});

test('"stop" as a single word, case-insensitively and with punctuation, also stops the member', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  for (const text of ['stop', 'Stop.', ' STOP! ']) {
    member.started = true;
    await receive(fromNikos({ text }));
    expect(member.started).toBe(false);
  }
});

test('a private event from a person who is not a member is left to the router', async () => {
  expect(await receive(fromNikos({ text: 'hello' }))).toBe(false);
  expect(family.members).toEqual([]);
});

test('other private events from a member are left to invitations and intents', async () => {
  ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  expect(await receive(fromNikos({ text: 'hello' }))).toBe(false);
  expect(messages()).toEqual([]);
});

test('CHOICES lists every choice used by choiceButtons', () => {
  expect(CHOICES).toEqual(['moments', 'reminders', 'shares', 'voice', 'call']);
});

test('a choice tap after stop starts the member again', async () => {
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  await receive(fromNikos({ text: 'stop' }));
  expect(member.started).toBe(false);
  await receive(fromNikos({ button: 'set:moments', messageId: 'msg-1' }));
  expect(member).toMatchObject({ started: true, choices: { moments: true } });
  expect(saved()?.members[0].started).toBe(true);
});
