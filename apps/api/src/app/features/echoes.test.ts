import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { createRouter } from '../core/router';
import { openStore } from '../core/store';
import type { Family, Moment, Person } from '../core/types';
import { ask } from '../model/model';
import { echoes } from './echoes';

vi.mock('../model/model', async (importOriginal) => ({ ...(await importOriginal<typeof import('../model/model')>()), ask: vi.fn() }));

type MomentIdSchema = { properties: { momentId: { enum: string[] }; earlier: { enum: string[] } } };

const NOW = new Date(2026, 8, 25, 12).getTime();
const WEEK = 7 * 86_400_000;
const sofia: Person = { id: 'u-sofia', name: 'Sofia' };
const dimitris: Person = { id: 'u-dimitris', name: 'Dimitris' };

beforeEach(() => {
  vi.mocked(ask).mockReset();
});

let count = 0;
function makeMoment(over: Partial<Moment> = {}): Moment {
  count += 1;
  return {
    id: `m${count}`,
    by: sofia,
    messageIds: [],
    savedAt: NOW,
    text: 'text',
    salience: 3,
    sensitive: false,
    people: [],
    title: 'title',
    stories: [],
    lookbacks: [],
    memoryPostIds: [],
    returns: {},
    ...over,
  };
}

function pair(family: Family, newer: Partial<Moment> = {}) {
  const candidate = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW, ...newer });
  family.moments.push(candidate, newMoment);
  return { candidate, newMoment };
}

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'anchor-echoes-')), 'state.json');
  const transport = new FakeTransport();
  const store = openStore(file, NOW);
  const family = store.addFamily('-100', '-100');
  const ctx = { now: () => NOW, store, transport: () => transport };
  const router = createRouter([echoes], ctx);
  return { file, transport, family, ctx, router };
}

test('a match with earlier match posts an album with the older moment first and sets echo', async () => {
  const { file, transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 2000, title: 'first day', text: 'his first day', photo: { id: 'photo-older' } });
  const newer = makeMoment({ by: sofia, savedAt: NOW, title: 'first day again', text: 'her first day', photo: { id: 'photo-newer' } });
  family.moments.push(older, newer);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      message: {
        album: [{ photo: { id: 'photo-older' } }, { photo: { id: 'photo-newer' } }],
        text: lines.echoCaption(older, newer),
      },
    },
  ]);
  const schema = vi.mocked(ask).mock.calls[0][1] as MomentIdSchema;
  expect(schema.properties.momentId.enum).toEqual([older.id, 'none']);
  expect(schema.properties.earlier.enum).toEqual(['new', 'match']);
  const reloaded = openStore(file).family('-100');
  expect(reloaded?.moments.find((m) => m.id === newer.id)?.echo).toBe(older.id);
});

test('a match with earlier new keeps the newer moment first, the journey case', async () => {
  const { transport, family, router } = setup();
  const maria = makeMoment({
    by: sofia,
    savedAt: NOW - 12 * 86400000,
    title: "Maria's first day",
    text: 'Maria walked in smiling',
    photo: { id: 'maria-photo' },
  });
  const grandfather = makeMoment({
    by: dimitris,
    savedAt: NOW,
    title: "grandfather's old photo",
    text: 'his old first day',
    photo: { id: 'grandfather-photo' },
  });
  family.moments.push(maria, grandfather);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: maria.id, earlier: 'new' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      message: {
        album: [{ photo: { id: 'grandfather-photo' } }, { photo: { id: 'maria-photo' } }],
        text: lines.echoCaption(grandfather, maria),
      },
    },
  ]);
});

test('different eventDate values order the older event first, even when earlier names the other moment', async () => {
  const { transport, family, router } = setup();
  const newer = makeMoment({ by: dimitris, savedAt: NOW, eventDate: '2015-06-01', text: 'new text', photo: { id: 'p-new' } });
  const older = makeMoment({ by: sofia, savedAt: NOW - WEEK - 5000, eventDate: '2020-06-01', text: 'match text', photo: { id: 'p-match' } });
  family.moments.push(older, newer);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      message: {
        album: [{ photo: { id: 'p-new' } }, { photo: { id: 'p-match' } }],
        text: lines.echoCaption(newer, older),
      },
    },
  ]);
});

test('a none answer posts nothing and leaves echo unset', async () => {
  const { transport, family, router } = setup();
  const { newMoment } = pair(family);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: 'none', earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([]);
  expect(newMoment.echo).toBeUndefined();
});

test('an id outside the candidates posts nothing and leaves echo unset', async () => {
  const { transport, family, router } = setup();
  const { newMoment } = pair(family);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: 'not-a-real-id', earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([]);
  expect(newMoment.echo).toBeUndefined();
});

test('a failed call posts nothing and leaves echo unset', async () => {
  const { transport, family, router } = setup();
  const { newMoment } = pair(family);
  vi.mocked(ask).mockRejectedValueOnce(new Error('boom'));
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([]);
  expect(newMoment.echo).toBeUndefined();
});

test('a null answer posts nothing, leaves echo unset, and does not throw', async () => {
  const { transport, family, ctx } = setup();
  const { newMoment } = pair(family);
  vi.mocked(ask).mockResolvedValueOnce(null);
  await expect(echoes.tick?.(family, { from: NOW - 10, to: NOW }, ctx)).resolves.toBeUndefined();

  expect(transport.sent).toEqual([]);
  expect(newMoment.echo).toBeUndefined();
});

test('a new moment with an echo already gets no call', async () => {
  const { transport, family, router } = setup();
  pair(family, { echo: 'already-echoed' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(ask).not.toHaveBeenCalled();
  expect(transport.sent).toEqual([]);
});

test('a send failure for the first new moment does not stop the second from getting its echo', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 10000, photo: { id: 'older-photo' } });
  const first = makeMoment({ by: sofia, savedAt: NOW - 5, photo: { id: 'first-photo' } });
  const second = makeMoment({ by: { id: 'u-eleni', name: 'Eleni' }, savedAt: NOW, photo: { id: 'second-photo' } });
  family.moments.push(older, first, second);
  vi.spyOn(transport, 'send').mockRejectedValueOnce(new Error('network blip'));
  vi.mocked(ask).mockResolvedValue({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(ask).toHaveBeenCalledTimes(2);
  expect(first.echo).toBe(older.id);
  expect(second.echo).toBe(older.id);
  expect(transport.sent).toEqual([
    {
      chatId: '-100',
      messageId: 'sent-1',
      message: {
        album: [{ photo: { id: 'older-photo' } }, { photo: { id: 'second-photo' } }],
        text: lines.echoCaption(older, second),
      },
    },
  ]);
});

test('a moment marked sensitive by the time its turn comes gets no model call', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 10000 });
  const first = makeMoment({ by: sofia, savedAt: NOW - 5 });
  const second = makeMoment({ by: dimitris, savedAt: NOW });
  family.moments.push(older, first, second);
  vi.mocked(ask).mockImplementationOnce(async () => {
    second.sensitive = true;
    return { momentId: 'none', earlier: 'match' };
  });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(ask).toHaveBeenCalledTimes(1);
  expect(transport.sent).toEqual([]);
});

test('a same-sender pair gets no call when the only older moment has the same sender', async () => {
  const { family, router } = setup();
  const older = makeMoment({ by: sofia, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW });
  family.moments.push(older, newMoment);
  await router.tick({ from: NOW - 10, to: NOW });

  expect(ask).not.toHaveBeenCalled();
});

test('a same-sender moment is excluded from the enum when other candidates exist', async () => {
  const { family, router } = setup();
  const sameSender = makeMoment({ by: sofia, savedAt: NOW - WEEK - 2000 });
  const otherSender = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW });
  family.moments.push(sameSender, otherSender, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: otherSender.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  const schema = vi.mocked(ask).mock.calls[0][1] as MomentIdSchema;
  expect(schema.properties.momentId.enum).toEqual([otherSender.id, 'none']);
});

test('a sensitive new moment gets no call', async () => {
  const { family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW, sensitive: true });
  family.moments.push(older, newMoment);
  await router.tick({ from: NOW - 10, to: NOW });

  expect(ask).not.toHaveBeenCalled();
});

test('a sensitive older moment is excluded from the enum', async () => {
  const { family, router } = setup();
  const sensitiveOlder = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 2000, sensitive: true });
  const validOlder = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW });
  family.moments.push(sensitiveOlder, validOlder, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: validOlder.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  const schema = vi.mocked(ask).mock.calls[0][1] as MomentIdSchema;
  expect(schema.properties.momentId.enum).toEqual([validOlder.id, 'none']);
});

test('a moment saved outside the window gets no call', async () => {
  const { family, router } = setup();
  const candidate = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 5000 });
  const outside = makeMoment({ by: sofia, savedAt: NOW - WEEK - 2000 });
  family.moments.push(candidate, outside);
  await router.tick({ from: NOW - 1000, to: NOW });

  expect(ask).not.toHaveBeenCalled();
});

test('a moment deleted during the call posts nothing and leaves echo unset', async () => {
  const { transport, family, router } = setup();
  const { candidate, newMoment } = pair(family);
  vi.mocked(ask).mockImplementationOnce(async () => {
    family.moments = family.moments.filter((moment) => moment.id !== newMoment.id);
    return { momentId: candidate.id, earlier: 'match' };
  });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([]);
});

test('a moment marked sensitive during the call posts nothing and leaves echo unset', async () => {
  const { transport, family, router } = setup();
  const { candidate, newMoment } = pair(family);
  vi.mocked(ask).mockImplementationOnce(async () => {
    candidate.sensitive = true;
    return { momentId: candidate.id, earlier: 'match' };
  });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toEqual([]);
  expect(newMoment.echo).toBeUndefined();
});

test('a video wins over a photo', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000, photo: { id: 'photo-1' }, video: { id: 'video-1' } });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW, photo: { id: 'photo-2' } });
  family.moments.push(older, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent[0].message.album).toEqual([{ video: { id: 'video-1' } }, { photo: { id: 'photo-2' } }]);
});

test('one picture posts a single photo or video message', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW, video: { id: 'video-only' } });
  family.moments.push(older, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent[0].message).toEqual({
    video: { id: 'video-only' },
    text: lines.echoCaption(older, newMoment),
  });
});

test('a then-and-now post with one wordless photo names that photo by its title and quotes the other moment', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000, text: 'My first day, 1958', photo: { id: 'photo-older' } });
  const newMoment = makeMoment({
    by: sofia,
    savedAt: NOW,
    title: "Maria's first day at school",
    text: "Maria's first day at school",
    wordless: true,
    photo: { id: 'photo-newer' },
  });
  family.moments.push(older, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent[0].message.text).toBe(
    "Then and now 💛\nDimitris shared: «My first day, 1958»\nSofia shared a photo: Maria's first day at school",
  );
});

test('no picture posts the caption as text', async () => {
  const { transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000 });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW });
  family.moments.push(older, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent[0].message).toEqual({ text: lines.echoCaption(older, newMoment) });
});

test('a matched echo sets echoPostIds on the newer moment to every message id of the album', async () => {
  const { file, transport, family, router } = setup();
  const older = makeMoment({ by: dimitris, savedAt: NOW - WEEK - 1000, photo: { id: 'photo-older' } });
  const newMoment = makeMoment({ by: sofia, savedAt: NOW, photo: { id: 'photo-newer' } });
  family.moments.push(older, newMoment);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  expect(transport.sent).toHaveLength(1);
  const postIds = [transport.sent[0].messageId, `${transport.sent[0].messageId}-2`];
  expect(newMoment.echoPostIds).toEqual(postIds);
  const reloaded = openStore(file).family('-100');
  expect(reloaded?.moments.find((m) => m.id === newMoment.id)?.echoPostIds).toEqual(postIds);
});

test('the caption is cut at 1024 characters, the Telegram caption limit', async () => {
  const { transport, family, router } = setup();
  const olderBy = { id: 'u-long-1', name: 'A'.repeat(128) };
  const newerBy = { id: 'u-long-2', name: 'B'.repeat(128) };
  const older = makeMoment({ by: olderBy, savedAt: NOW - WEEK - 2000, text: 'a'.repeat(700), photo: { id: 'photo-older' } });
  const newer = makeMoment({ by: newerBy, savedAt: NOW, text: 'b'.repeat(700), photo: { id: 'photo-newer' } });
  family.moments.push(older, newer);
  vi.mocked(ask).mockResolvedValueOnce({ momentId: older.id, earlier: 'match' });
  await router.tick({ from: NOW - 10, to: NOW });

  const text = transport.sent[0].message.text ?? '';
  expect(text).toHaveLength(1024);
  expect(lines.echoCaption(older, newer).startsWith(text)).toBe(true);
});

test('a candidate saved in the last 7 days is no echo, so two moments of one week never post a then-and-now album', async () => {
  const { transport, family, router } = setup();
  family.moments.push(makeMoment({ by: dimitris, savedAt: NOW - WEEK + 1 }), makeMoment({ by: sofia, savedAt: NOW }));
  await router.tick({ from: NOW - 10, to: NOW });
  expect(ask).not.toHaveBeenCalled();
  expect(transport.sent).toEqual([]);
});
