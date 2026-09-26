import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { createRouter } from '../core/router';
import { openStore } from '../core/store';
import type { Choices, Incoming } from '../core/types';
import { intro } from './intro';

const DEFAULT_CHOICES: Choices = { moments: true, reminders: true, shares: true, voice: false, call: false };

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'anchor-intro-')), 'state.json');
  const transport = new FakeTransport();
  const store = openStore(file);
  const router = createRouter([intro], { now: () => 0, store, transport: () => transport });
  return { file, transport, store, router };
}

const joined: Incoming = {
  familyId: '-100',
  chat: 'group',
  chatId: '-100',
  messageId: '',
  sender: { id: '1', name: 'Sofia' },
  at: 0,
  joined: true,
};

const introButtons = (transport: FakeTransport, familyId: string) => [{ label: lines.buttons.chooseForMe, url: transport.startLink(familyId) }];

test('joining a group saves a new family and posts intro with the choose-for-me button in the group', async () => {
  const { file, transport, router } = setup();
  await router.route(joined);
  expect(openStore(file).family('-100')).toEqual({ id: '-100', chatId: '-100', members: [], moments: [], offers: [], reminders: [], counters: {} });
  expect(transport.sent).toEqual([
    { chatId: '-100', messageId: 'sent-1', message: { text: lines.intro, buttons: introButtons(transport, '-100') } },
  ]);
});

test('joining the same group again posts intro again and keeps one family', async () => {
  const { transport, store, router } = setup();
  await router.route(joined);
  await router.route(joined);
  expect(store.state.families).toHaveLength(1);
  expect(transport.sent.map(({ message }) => message.text)).toEqual([lines.intro, lines.intro]);
});

test('a group that became a supergroup keeps its family under the new chat id, and the migration sends nothing', async () => {
  const { file, transport, store, router } = setup();
  await router.route(joined);
  const family = store.family('-100');
  if (family) store.joinMember(family, { id: '42', name: 'Nikos' }).started = true;
  const supergroup = { ...joined, familyId: '-1009', chatId: '-1009' };
  await router.route(supergroup);
  await router.route({ ...joined, joined: undefined, messageId: '7', migratedTo: '-1009' });

  expect(openStore(file).state.families).toEqual([
    {
      id: '-1009',
      chatId: '-1009',
      members: [{ id: '42', name: 'Nikos', started: true, choices: DEFAULT_CHOICES }],
      moments: [],
      offers: [],
      reminders: [],
      counters: {},
    },
  ]);
  expect(transport.sent.map(({ chatId }) => chatId)).toEqual(['-100', '-1009']);
});

test('a migration clears the message ids of the old group, because a supergroup numbers its messages from 1 again', async () => {
  const { store, router } = setup();
  await router.route(joined);
  const moment = {
    id: 'm1',
    by: { id: '1', name: 'Sofia' },
    messageIds: ['57'],
    savedAt: 0,
    text: 'Maria on her first day at school',
    salience: 3,
    sensitive: false,
    people: [],
    title: "Maria's first day at school",
    stories: [{ id: 's1', by: { id: '42', name: 'Nikos' }, at: 0, text: 'She would not let go', messageIds: ['60'] }],
    lookbacks: [],
    memoryPostIds: ['58'],
    echoPostIds: ['59'],
    returns: {},
  };
  store.family('-100')?.moments.push(moment);
  await router.route({ ...joined, joined: undefined, messageId: '61', migratedTo: '-1009' });

  const moved = store.family('-1009')?.moments[0];
  expect([moved?.messageIds, moved?.memoryPostIds, moved?.echoPostIds, moved?.stories[0].messageIds]).toEqual([[], [], [], []]);
  expect(moved?.text).toBe('Maria on her first day at school');
});

test('intro leaves every other event to the next feature', async () => {
  const { store, transport } = setup();
  const handled = await intro.handle?.({ ...joined, joined: undefined, text: 'hello' }, undefined, {
    now: () => 0,
    store,
    transport: () => transport,
  });
  expect(handled).toBe(false);
  expect(store.state.families).toEqual([]);
});
