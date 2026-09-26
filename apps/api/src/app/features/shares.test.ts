process.env.TZ = 'Europe/Athens';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { FADE_MS } from '../core/offers';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { openStore } from '../core/store';
import type { Context, Family, Incoming, Moment } from '../core/types';
import { speak } from '../model/model';
import { shares } from './shares';

vi.mock('../model/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/model')>()),
  ask: vi.fn(),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));

let now: number;
let file: string;
let transport: FakeTransport;
let ctx: Context;
let family: Family;

const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const wav = Buffer.from('RIFF clip');

const build = (overrides: Partial<Moment> = {}): Moment => ({
  id: 'm1',
  by: { id: '1', name: 'Sofia' },
  messageIds: ['57', '58'],
  savedAt: at(25, 11, 30),
  text: 'Maria on her first day at school',
  photo: { id: 'photo-57' },
  salience: 3,
  sensitive: false,
  people: ['Maria'],
  title: "Maria's first day at school",
  stories: [],
  lookbacks: [],
  memoryPostIds: [],
  returns: {},
  ...overrides,
});

const add = (overrides: Partial<Moment> = {}) => {
  const moment = build(overrides);
  family.moments.push(moment);
  return moment;
};

const tickAt = (time: number, from = time - 60_000) => {
  now = time;
  return shares.tick(family, { from, to: time }, ctx);
};

const inGroup = (button: string, sender = '1', overrides: Partial<Incoming> = {}): Incoming => ({
  familyId: '-100',
  chat: 'group',
  chatId: '-100',
  messageId: 'g1',
  sender: { id: sender, name: 'Sofia' },
  at: now,
  button,
  ...overrides,
});

const member = (id: string) => {
  const found = family.members.find((item) => item.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
};
const messages = () => transport.sent.map(({ chatId, message }) => [chatId, message]);
const offerButtons = (id: string) => [
  { label: lines.buttons.sendIt, data: `shr:yes:${id}` },
  { label: lines.buttons.noThanks, data: `shr:no:${id}` },
  { label: lines.buttons.stopOffering, data: `shr:stop:${id}` },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(speak).mockResolvedValue(wav);
  now = at(25, 12);
  file = join(mkdtempSync(join(tmpdir(), 'anchor-shares-')), 'state.json');
  const store = openStore(file, now);
  transport = new FakeTransport();
  ctx = { now: () => now, store, transport: () => transport };
  family = store.addFamily('-100', '-100');
  store.joinMember(family, { id: '1', name: 'Sofia' });
  const nikos = store.joinMember(family, { id: '7', name: 'Nikos' });
  nikos.started = true;
  nikos.choices.moments = true;
  const eleni = store.joinMember(family, { id: '8', name: 'Eleni' });
  eleni.started = true;
  eleni.choices.moments = true;
});

test('the tick sends the sender one ephemeral offer for a new moment, onlyFor the sender, with the three buttons', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  expect(messages()).toEqual([
    ['-100', { text: lines.shareOffer(['Nikos', 'Eleni']), onlyFor: '1', buttons: offerButtons(family.offers[0].id) }],
  ]);
  expect(family.offers).toHaveLength(1);
  expect(family.offers[0]).toMatchObject({ kind: 'share', to: '1', ref: 'm1' });
});

test('the tick makes no offer twice for the same moment', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  await tickAt(at(25, 13), at(25, 11));
  expect(family.offers).toHaveLength(1);
});

test('the tick makes no offer for a sensitive moment', async () => {
  add({ sensitive: true });
  await tickAt(at(25, 12), at(25, 11));
  expect(family.offers).toEqual([]);
});

test('the tick makes no offer for a sender without choices.shares', async () => {
  member('1').choices.shares = false;
  add();
  await tickAt(at(25, 12), at(25, 11));
  expect(family.offers).toEqual([]);
});

test('the tick makes no offer for a moment outside the window', async () => {
  add({ savedAt: at(24, 12) });
  await tickAt(at(25, 12), at(25, 11));
  expect(family.offers).toEqual([]);
});

test('the tick makes no offer with no recipient', async () => {
  member('7').choices.moments = false;
  member('8').choices.moments = false;
  add();
  await tickAt(at(25, 12), at(25, 11));
  expect(family.offers).toEqual([]);
});

test('the recipients exclude the sender and members without started or choices.moments', async () => {
  const sofia = member('1');
  sofia.started = true;
  sofia.choices.moments = true;
  member('8').started = false;
  add({ by: { id: '7', name: 'Nikos' } });
  await tickAt(at(25, 12), at(25, 11));
  expect(messages()[0]).toEqual(['-100', { text: lines.shareOffer(['Sofia']), onlyFor: '7', buttons: offerButtons(family.offers[0].id) }]);
});

test('"Yes, send it" delivers the moment as an invitation to each recipient and edits the offer to shareSent', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  const id = family.offers[0].id;
  const event = inGroup(`shr:yes:${id}`);
  expect(await shares.handle(event, family, ctx)).toBe(true);

  const nikosMessages = transport.sent.filter(({ chatId }) => chatId === '7');
  const eleniMessages = transport.sent.filter(({ chatId }) => chatId === '8');
  expect(nikosMessages).toHaveLength(2);
  expect(nikosMessages[0].message.photo).toEqual({ id: 'photo-57' });
  expect(nikosMessages[1].message.text).toBe(lines.remindYou);
  expect(eleniMessages).toHaveLength(2);
  expect(family.offers).toEqual([]);
  expect(transport.edits).toEqual([{ chatId: '-100', messageId: transport.sent[0].messageId, change: { text: lines.shareSent(['Nikos', 'Eleni']), onlyFor: '1' } }]);
});

test('"No thanks" removes the offer and changes nothing else', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  const id = family.offers[0].id;
  const event = inGroup(`shr:no:${id}`);
  expect(await shares.handle(event, family, ctx)).toBe(true);
  expect(family.offers).toEqual([]);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: transport.sent[0].messageId, onlyFor: '1' }]);
  expect(member('1').choices.shares).toBe(true);
});

test('"Stop offering this" turns choices.shares off and edits the offer to offersOff', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  const id = family.offers[0].id;
  const event = inGroup(`shr:stop:${id}`);
  expect(await shares.handle(event, family, ctx)).toBe(true);
  expect(member('1').choices.shares).toBe(false);
  expect(transport.edits).toEqual([{ chatId: '-100', messageId: transport.sent[0].messageId, change: { text: lines.offersOff, onlyFor: '1' } }]);
  expect(family.offers).toEqual([]);
});

test('a tap on a faded or unknown offer removes the tapped message and changes nothing', async () => {
  const event = inGroup('shr:yes:missing', '1', { messageId: 'g9' });
  expect(await shares.handle(event, family, ctx)).toBe(true);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'g9', onlyFor: '1' }]);
  expect(family.offers).toEqual([]);
});

test('a tap from someone other than the offer owner removes the tapped message and changes nothing', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  const id = family.offers[0].id;
  const event = inGroup(`shr:yes:${id}`, '7', { messageId: 'g9' });
  expect(await shares.handle(event, family, ctx)).toBe(true);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'g9', onlyFor: '7' }]);
  expect(family.offers).toHaveLength(1);
});

test('an unanswered offer fades after FADE_MS', async () => {
  add();
  await tickAt(at(25, 12), at(25, 11));
  expect(family.offers).toHaveLength(1);
  const sentBefore = transport.sent.length;
  await tickAt(now + FADE_MS, now);
  expect(family.offers).toEqual([]);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: transport.sent[sentBefore - 1].messageId, onlyFor: '1' }]);
});
