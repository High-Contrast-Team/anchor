import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { dayIndex } from '../core/clock';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { createRouter } from '../core/router';
import { openStore } from '../core/store';
import type { Context, Incoming } from '../core/types';
import { ask } from '../model/model';
import { bundles } from './capture/capture';
import { fastforward } from './fastforward';

vi.mock('../model/model', async (importOriginal) => ({ ...(await importOriginal<typeof import('../model/model')>()), ask: vi.fn() }));

const NOW = new Date(2026, 8, 25, 12).getTime();
const DEFAULT = { moments: true, reminders: true, shares: true, voice: false, call: false };

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'anchor-fastforward-')), 'state.json');
  const transport = new FakeTransport();
  const store = openStore(file);
  store.addFamily('-100', '-100');
  store.save();
  const ctx: Context = { now: () => NOW + store.state.clockOffset, store, transport: () => transport, restartWindow: vi.fn() };
  const router = createRouter([fastforward], ctx);
  return { file, transport, store, ctx, router };
}

function command(text: string, chat: 'group' | 'private' = 'group', ephemeral?: boolean): Incoming {
  return {
    familyId: chat === 'group' ? '-100' : undefined,
    chat,
    chatId: chat === 'group' ? '-100' : '1',
    messageId: 'msg-1',
    sender: { id: '1', name: 'Sofia' },
    at: NOW,
    text,
    ephemeral,
  };
}

test("an admin's /fastforward 7 jumps the clock and replies with the new time", async () => {
  const { file, transport, router } = setup();
  transport.admins.add('1');
  await router.route(command('/fastforward 7'));
  expect(openStore(file).state.clockOffset).toBe(7 * 86_400_000);
  expect(transport.sent).toEqual([
    { chatId: '-100', messageId: 'sent-1', message: { text: "⏩ It's now 2 October 2026 at 12:00 on the family clock.", replyTo: 'msg-1' } },
  ]);
});

test('a second jump adds to the first', async () => {
  const { file, transport, router } = setup();
  transport.admins.add('1');
  await router.route(command('/fastforward 7'));
  await router.route(command('/fastforward 3'));
  expect(openStore(file).state.clockOffset).toBe(10 * 86_400_000);
  expect(transport.sent.at(-1)?.message.text).toBe("⏩ It's now 5 October 2026 at 12:00 on the family clock.");
});

const invalidArguments = [
  '/fastforward',
  '/fastforward 0',
  '/fastforward 401',
  '/fastforward 1.5',
  '/fastforward -3',
  '/fastforward abc',
  '/fastforward 7 days',
];

test.each(invalidArguments)('invalid argument %s gets the usage line and no jump', async (text) => {
  const { file, transport, router } = setup();
  transport.admins.add('1');
  await router.route(command(text));
  expect(openStore(file).state.clockOffset).toBe(0);
  expect(transport.sent).toEqual([{ chatId: '-100', messageId: 'sent-1', message: { text: lines.fastforwardUsage, replyTo: 'msg-1' } }]);
});

test('a member who is not an admin gets adminOnly, no jump, and handle returns true', async () => {
  const { store, transport, ctx } = setup();
  const event = command('/fastforward 7');
  const handled = await fastforward.handle?.(event, store.family('-100'), ctx);
  expect(handled).toBe(true);
  expect(transport.sent.map(({ chatId, message }) => [chatId, message])).toEqual([[event.chatId, { text: lines.adminOnly, replyTo: event.messageId }]]);
  expect(store.state.clockOffset).toBe(0);
});

test('a group command with no family on record returns false and sends nothing', async () => {
  const { transport, ctx } = setup();
  const handled = await fastforward.handle?.(command('/fastforward 7'), undefined, ctx);
  expect(handled).toBe(false);
  expect(transport.sent).toEqual([]);
});

test.each([
  ['/fastforwarding 7', 'group'] as const,
  ['/memory', 'group'] as const,
  ['hello', 'group'] as const,
  ['/fastforward 7', 'private'] as const,
])('%s in a %s chat returns false', async (text, chat) => {
  const { store, transport, ctx } = setup();
  transport.admins.add('1');
  const handled = await fastforward.handle?.(command(text, chat), store.family('-100'), ctx);
  expect(handled).toBe(false);
  expect(transport.sent).toEqual([]);
});

test("an admin's /fastforward 08:05 jumps to the next local 08:05, restarts the window, and replies only to the presenter", async () => {
  const { file, transport, router, ctx } = setup();
  transport.admins.add('1');
  await router.route(command('/fastforward 08:05'));
  expect(NOW + openStore(file).state.clockOffset).toBe(new Date(2026, 8, 26, 8, 5).getTime());
  expect(ctx.restartWindow).toHaveBeenCalledOnce();
  expect(transport.sent).toEqual([
    { chatId: '-100', messageId: 'sent-1', message: { text: "⏩ It's now 26 September 2026 at 08:05 on the family clock.", onlyFor: '1' } },
  ]);
});

test("an admin's /fastforward now sets the family clock back to the real time, restarts the window, and replies only to the presenter", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 9, 30));
  try {
    const { file, transport, router, ctx } = setup();
    transport.admins.add('1');
    await router.route(command('/fastforward 3'));
    await router.route(command('/fastforward now'));
    expect(NOW + openStore(file).state.clockOffset).toBe(new Date(2026, 8, 25, 9, 30).getTime());
    expect(ctx.restartWindow).toHaveBeenCalledOnce();
    expect(transport.sent.at(-1)?.message).toEqual({ text: "⏩ It's now 25 September 2026 at 09:30 on the family clock.", onlyFor: '1' });
  } finally {
    vi.useRealTimers();
  }
});

test('/fastforward now forgets the day markers of the undone days, so their slots fire again, and keeps the markers of the real days', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 9, 30));
  try {
    const { store, transport, router } = setup();
    transport.admins.add('1');
    const family = store.family('-100');
    if (!family) throw new Error('no family');
    const today = dayIndex(Date.now());
    const later = new Date(2026, 8, 27, 12).getTime();
    family.lastMemoryDay = today + 2;
    family.members.push(
      { id: '2', name: 'Sofia', started: true, choices: DEFAULT, lastInvitationDay: today + 2, lastCallDay: today + 2, seenAt: later },
      { id: '3', name: 'Eleni', started: true, choices: DEFAULT, lastInvitationDay: today, lastCallDay: today - 1, seenAt: Date.now() - 1000 },
    );
    await router.route(command('/fastforward now'));
    expect(family.lastMemoryDay).toBeUndefined();
    expect(family.members).toEqual([
      { id: '2', name: 'Sofia', started: true, choices: DEFAULT },
      { id: '3', name: 'Eleni', started: true, choices: DEFAULT, lastInvitationDay: today, lastCallDay: today - 1, seenAt: Date.now() - 1000 },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('/fastforward to a time still ahead today stays on the same day', async () => {
  const { store, transport, router } = setup();
  transport.admins.add('1');
  await router.route(command('/fastforward 18:30'));
  expect(NOW + store.state.clockOffset).toBe(new Date(2026, 8, 25, 18, 30).getTime());
});

test('a jump in days leaves the window alone', async () => {
  const { transport, router, ctx } = setup();
  transport.admins.add('1');
  await router.route(command('/fastforward 7'));
  expect(ctx.restartWindow).not.toHaveBeenCalled();
});

test.each(['/fastforward 25:00', '/fastforward 12:60', '/fastforward 8:05', '/fastforward 08:05 pm'])(
  'invalid time %s gets the usage line and no jump',
  async (text) => {
    const { store, transport, router, ctx } = setup();
    transport.admins.add('1');
    await router.route(command(text));
    expect(store.state.clockOffset).toBe(0);
    expect(ctx.restartWindow).not.toHaveBeenCalled();
    expect(transport.sent.map(({ message }) => message.text)).toEqual([lines.fastforwardUsage]);
  },
);

test('an ephemeral command gets every reply only for the presenter, with no reply to', async () => {
  const { transport, router } = setup();
  await router.route(command('/fastforward 7', 'group', true));
  transport.admins.add('1');
  await router.route(command('/fastforward', 'group', true));
  await router.route(command('/fastforward 7', 'group', true));
  expect(transport.sent.map(({ message }) => message)).toEqual([
    { text: lines.adminOnly, onlyFor: '1' },
    { text: lines.fastforwardUsage, onlyFor: '1' },
    { text: "⏩ It's now 2 October 2026 at 12:00 on the family clock.", onlyFor: '1' },
  ]);
});

test('a jump first saves every open bundle of the family, so a text posted a minute before joins the memory of the next day', async () => {
  const { store, transport, router } = setup();
  transport.admins.add('1');
  const family = store.family('-100');
  if (!family) throw new Error('no family');
  vi.mocked(ask).mockResolvedValue({ verdict: 'family_moment', salience: 3, people: [], eventDate: '', title: 'Sunday lunch', transcript: '' });
  bundles.push({ family, sender: { id: '2', name: 'Eleni' }, events: [{ ...command('Lunch at grandma’s on Sunday with the cousins'), messageId: 'msg-0' }] });

  await router.route(command('/fastforward 1'));
  expect(family.moments).toEqual([expect.objectContaining({ text: 'Lunch at grandma’s on Sunday with the cousins', savedAt: NOW })]);
  expect(store.state.clockOffset).toBe(86_400_000);
  expect(bundles).toEqual([]);
});
