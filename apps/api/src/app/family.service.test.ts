import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { FakeTransport } from './core/fake-transport';
import { lines } from './core/lines';
import { createRouter } from './core/router';
import { openStore } from './core/store';
import type { Incoming } from './core/types';
import { FamilyService, FEATURES, nextWindow } from './family.service';
import { bundles } from './features/capture/capture';
import { httpFetch, type HttpResponse } from './http';
import { ask } from './model/model';

vi.mock('./http', () => ({ httpFetch: vi.fn() }));
vi.mock('./transports/poll-fetch', async () => {
  const http = await import('./http');
  return { pollFetch: (url: string, init: RequestInit) => http.httpFetch(url, init) };
});
vi.mock('./model/model', async (importOriginal) => ({ ...(await importOriginal<typeof import('./model/model')>()), ask: vi.fn() }));
const fetchMock = vi.mocked(httpFetch);

const ok = (result: unknown): HttpResponse => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result }),
  text: async () => '',
  arrayBuffer: async () => new ArrayBuffer(0),
});

const stateFile = () => join(mkdtempSync(join(tmpdir(), 'anchor-host-')), 'state.json');
const anchorBot = { id: 999, is_bot: true, first_name: 'Anchor', username: 'anchor_test_bot' };
const sofia = { id: 111, is_bot: false, first_name: 'Sofia' };
const group = { id: -1001234567890, title: 'The Pappas family', type: 'supergroup' };
const date = 1790340000;
const updates = [
  {
    update_id: 1,
    my_chat_member: {
      chat: group,
      from: sofia,
      date,
      old_chat_member: { status: 'left', user: anchorBot },
      new_chat_member: { status: 'member', user: anchorBot },
    },
  },
  { update_id: 2, message: { message_id: 3, from: { id: 222, is_bot: false, first_name: 'Nikos' }, chat: { id: 222, type: 'private' }, date, text: 'hi' } },
];

afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

test('without a token the host starts no store, no tick, and no poll', () => {
  const file = stateFile();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
  vi.stubEnv('ANCHOR_STATE_FILE', file);
  const host = new FamilyService();
  host.onApplicationBootstrap();
  host.onApplicationShutdown();
  expect(existsSync(file)).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('with a token the host polls Telegram, introduces Anchor to a new group, and points a stranger to the group', async () => {
  const file = stateFile();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'TOKEN');
  vi.stubEnv('ANCHOR_STATE_FILE', file);
  const sent: unknown[] = [];
  let polls = 0;
  fetchMock.mockImplementation(async (url, init) => {
    const method = url.slice(url.lastIndexOf('/') + 1);
    const params = JSON.parse(String(init?.body ?? '{}'));
    if (method === 'getMe') return ok(anchorBot);
    if (method === 'setMyCommands') return ok(true);
    if (method === 'sendMessage') {
      sent.push({ chat_id: params.chat_id, text: params.text });
      return ok({ message_id: 10 + sent.length, chat: group, date });
    }
    polls += 1;
    if (polls === 1) return ok(updates);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return ok([]);
  });

  const host = new FamilyService();
  host.onApplicationBootstrap();
  await vi.waitFor(() =>
    expect(sent).toEqual([
      { chat_id: '-1001234567890', text: lines.intro },
      { chat_id: '222', text: lines.pointer },
    ]),
  );
  host.onApplicationShutdown();

  expect(JSON.parse(readFileSync(file, 'utf8')).families).toEqual([
    { id: '-1001234567890', chatId: '-1001234567890', members: [], moments: [], offers: [], reminders: [], counters: {} },
  ]);
});

test('FEATURES keeps the order of spec 5.4', () => {
  expect(FEATURES.map((feature) => feature.name)).toEqual([
    'transcripts',
    'talk',
    'intro',
    'fastforward',
    'forget',
    'reminders',
    'scams',
    'members',
    'invitations',
    'memories',
    'intents',
    'capture',
    'latestPhotos',
    'shares',
    'echoes',
    'calls',
  ]);
});

test('nextWindow starts an empty window at to when restart is set, and keeps the running window otherwise', () => {
  expect(nextWindow(100, 200, false)).toEqual({ from: 100, to: 200 });
  expect(nextWindow(100, 200, true)).toEqual({ from: 200, to: 200 });
});

test('through FEATURES, a forwarded "stop" in private reaches the scam check before members, so the member keeps every choice', async () => {
  const transport = new FakeTransport();
  const store = openStore(stateFile());
  const router = createRouter(FEATURES, { now: () => Date.now(), store, transport: () => transport });
  const family = store.addFamily('-100', '-100');
  const sofia = store.joinMember(family, { id: '1', name: 'Sofia' });
  sofia.started = true;
  vi.mocked(ask).mockResolvedValue({ asks: false, claims: 'none' });

  await router.route({ chat: 'private', chatId: '1', messageId: 'p1', sender: { id: '1', name: 'Sofia' }, at: Date.now(), text: 'stop', forwarded: true });
  expect(sofia.started).toBe(true);
  expect(transport.sent.map(({ message }) => message.text)).toEqual([lines.scam.neutral]);
});

test('through FEATURES, a captioned photo gets a heart and "Anchor, forget this" reaches forget before ask and capture', async () => {
  const now = new Date(2026, 8, 25, 12).getTime();
  const transport = new FakeTransport();
  const store = openStore(stateFile(), now);
  const router = createRouter(FEATURES, { now: () => now, store, transport: () => transport });
  const family = store.addFamily('-100', '-100');
  const message = (fields: Partial<Incoming>): Incoming => ({
    familyId: '-100',
    chat: 'group',
    chatId: '-100',
    messageId: 'm1',
    sender: { id: '1', name: 'Sofia' },
    at: Date.now(),
    ...fields,
  });
  transport.files.set('p1', { data: Buffer.from('photo'), mimeType: 'image/jpeg' });
  vi.mocked(ask).mockResolvedValue({
    verdict: 'family_moment',
    salience: 4,
    people: ['Maria'],
    eventDate: '',
    title: "Maria's first day at school",
    transcript: '',
  });

  await router.route(message({ photo: { id: 'p1' }, text: 'Maria on her first day at school' }));
  await router.tick({ from: now, to: now + 2000 });
  expect(family.moments.map((moment) => moment.title)).toEqual(["Maria's first day at school"]);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: 'm1', emoji: '\u2764', big: undefined }]);

  await router.route(message({ messageId: 'm2', text: 'Anchor, forget this', replyTo: 'm1' }));
  expect(family.moments).toEqual([]);
  expect(bundles).toEqual([]);
  expect(transport.reactions.at(-1)).toEqual({ chatId: '-100', messageId: 'm2', emoji: '👌', big: undefined });
});
