process.env.TZ = 'Europe/Athens';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Mock } from 'vitest';
import { FakeTransport } from '../../core/fake-transport';
import { lines } from '../../core/lines';
import { openStore } from '../../core/store';
import type { Context, Family, Incoming, Moment } from '../../core/types';
import { ask } from '../../model/model';
import { memories } from '../memories';
import { bundles, capture, flush, forget } from './capture';
import { BUNDLE_GAP_MS } from './filter';

vi.mock('../../model/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model/model')>()),
  ask: vi.fn(),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));

let now: number;
let transport: FakeTransport;
let ctx: Context;
let family: Family;
let messageSeq = 0;
const store = () => ctx.store;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 12));
  now = Date.now();
  transport = new FakeTransport();
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'anchor-')), 'state.json'), now);
  ctx = { now: () => now, store, transport: () => transport };
  family = store.addFamily('-100', '-100');
  bundles.length = 0;
  messageSeq = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
  now = Date.now();
}

function event(overrides: Partial<Incoming> = {}): Incoming {
  messageSeq += 1;
  return {
    familyId: '-100',
    chat: 'group',
    chatId: '-100',
    messageId: `m${messageSeq}`,
    sender: { id: 'sofia', name: 'Sofia' },
    at: Date.now(),
    ...overrides,
  };
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'existing-moment',
    by: { id: 'sofia', name: 'Sofia' },
    messageIds: [],
    savedAt: 0,
    text: 'Maria on her first day',
    salience: 3,
    sensitive: false,
    people: [],
    title: "Maria's first day at school",
    stories: [],
    lookbacks: [],
    memoryPostIds: [],
    returns: {},
    ...overrides,
  };
}

const classification = {
  verdict: 'family_moment' as const,
  salience: 4,
  people: ['Maria'],
  eventDate: '2026-09-01',
  title: "Maria's first day at school",
  transcript: '',
};

function tick() {
  return capture.tick?.(family, { from: now, to: now }, ctx);
}

test('a captioned photo becomes a family moment at the tick, and gets a heart', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  const photoEvent = event({ text: 'Maria on her first day', photo: { id: 'photo-1' } });

  expect(await capture.handle(photoEvent, family, ctx)).toBe(true);
  await tick();

  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toEqual([
    {
      id: expect.any(String),
      by: { id: 'sofia', name: 'Sofia' },
      messageIds: [photoEvent.messageId],
      savedAt: now,
      text: 'Maria on her first day',
      photo: { id: 'photo-1' },
      video: undefined,
      voice: undefined,
      salience: 4,
      people: ['Maria'],
      eventDate: '2026-09-01',
      title: "Maria's first day at school",
      sensitive: false,
      stories: [],
      lookbacks: [],
      memoryPostIds: [],
      returns: {},
    },
  ]);
  expect(family.moments[0]).not.toHaveProperty('wordless');
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: photoEvent.messageId, emoji: '\u2764' }]);
  expect(family.counters.family_moment).toBe(1);
});

test('a sensitive verdict saves the moment with sensitive: true, and still gets a heart', async () => {
  (ask as Mock).mockResolvedValue({ ...classification, verdict: 'sensitive' });
  const textEvent = event({ text: 'We lost grandpa today, sharing this' });

  await capture.handle(textEvent, family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments).toHaveLength(1);
  expect(family.moments[0].sensitive).toBe(true);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: textEvent.messageId, emoji: '\u2764' }]);
  expect(family.counters.sensitive).toBe(1);
});

test('logistics and small_talk get no moment and no reaction, but their counters increment', async () => {
  (ask as Mock).mockResolvedValueOnce({ ...classification, verdict: 'logistics' });
  await capture.handle(event({ text: 'pick up the kids at five' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  (ask as Mock).mockResolvedValueOnce({ ...classification, verdict: 'small_talk' });
  await capture.handle(event({ text: 'lol that is so funny honestly' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments).toEqual([]);
  expect(transport.reactions).toEqual([]);
  expect(family.counters.logistics).toBe(1);
  expect(family.counters.small_talk).toBe(1);
});

test('a sticker, a forwarded text, a command, and a bare link fail the rules and never reach ask', async () => {
  await capture.handle(event({ unsupported: true }), family, ctx);
  await capture.handle(event({ text: 'look at this', forwarded: true }), family, ctx);
  await capture.handle(event({ text: '/memory' }), family, ctx);
  await capture.handle(event({ text: 'https://example.com' }), family, ctx);

  expect(ask).not.toHaveBeenCalled();
  expect(family.counters.rules).toBe(4);
  expect(bundles).toEqual([]);
});

test('"ok great" and a bare video without a thumbnail are dropped at the close, with no ask call', async () => {
  await capture.handle(event({ text: 'ok great' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  await capture.handle(event({ video: { id: 'video-1' } }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  expect(ask).not.toHaveBeenCalled();
  expect(family.counters.rules).toBe(2);
  expect(bundles).toEqual([]);
  expect(family.moments).toEqual([]);
});

test('a captured moment keeps the tags from the model', async () => {
  (ask as Mock).mockResolvedValue({ ...classification, tags: ['Lucy', 'dog'] });
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  await capture.handle(event({ photo: { id: 'photo-1' }, text: 'Lucy found the ball again' }), family, ctx);

  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments[0].tags).toEqual(['Lucy', 'dog']);
});

test('a captured photo keeps the description from the model, and a moment without a picture has none', async () => {
  const description = 'The photo shows a girl with a red backpack at a school gate.';
  (ask as Mock).mockResolvedValue({ ...classification, description });
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  await capture.handle(event({ photo: { id: 'photo-1' }, text: 'Maria on her first day' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();
  await capture.handle(event({ sender: { id: 'eleni', name: 'Eleni' }, text: 'Maria loved her first day' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments).toHaveLength(2);
  expect(family.moments[0].description).toBe(description);
  expect(family.moments[1]).not.toHaveProperty('description');
});

test('a bare photo becomes a wordless moment 5 minutes later: ask gets the photo, the text is the title, and it gets a heart', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  const photoEvent = event({ photo: { id: 'photo-1' } });
  await capture.handle(photoEvent, family, ctx);

  advance(5 * 60_000);
  await tick();

  const [, , options] = (ask as Mock).mock.calls[0];
  expect(options.media).toEqual([{ data: Buffer.from('x'), mimeType: 'image/jpeg' }]);
  expect(family.moments).toHaveLength(1);
  expect(family.moments[0]).toMatchObject({ text: classification.title, title: classification.title, wordless: true, photo: { id: 'photo-1' } });
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: photoEvent.messageId, emoji: '\u2764' }]);
  expect(family.counters.family_moment).toBe(1);
});

test('a text, then a photo 3 minutes later from the same sender: one moment with the text in her own words, not wordless', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  const textEvent = event({ text: 'Maria on her first day' });
  await capture.handle(textEvent, family, ctx);

  advance(3 * 60_000);
  await tick();
  expect(ask).not.toHaveBeenCalled();
  const photoEvent = event({ photo: { id: 'photo-1' } });
  await capture.handle(photoEvent, family, ctx);
  await tick();

  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);
  expect(family.moments[0].messageIds).toEqual([textEvent.messageId, photoEvent.messageId]);
  expect(family.moments[0].text).toBe('Maria on her first day');
  expect(family.moments[0].photo).toEqual({ id: 'photo-1' });
  expect(family.moments[0]).not.toHaveProperty('wordless');
});

test('a captioned video is classified from its thumbnail, and the moment keeps the video', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('thumb-1', { data: Buffer.from('t'), mimeType: 'image/jpeg' });
  const videoEvent = event({ text: 'Maria at the party', video: { id: 'video-1' }, thumbnail: { id: 'thumb-1' } });

  await capture.handle(videoEvent, family, ctx);
  await tick();

  expect(family.moments[0].video).toEqual({ id: 'video-1' });
  const [, , options] = (ask as Mock).mock.calls[0];
  expect(options.media).toEqual([{ data: Buffer.from('t'), mimeType: 'image/jpeg' }]);
});

test('a bare photo, then a voice note from the same sender: one moment with the photo, the voice, and the transcript', async () => {
  (ask as Mock).mockResolvedValue({ ...classification, transcript: 'She was so happy that day' });
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  transport.files.set('voice-1', { data: Buffer.from('v'), mimeType: 'audio/ogg' });
  const photoEvent = event({ photo: { id: 'photo-1' } });
  await capture.handle(photoEvent, family, ctx);

  advance(30_000);
  const voiceEvent = event({ voice: { id: 'voice-1' } });
  await capture.handle(voiceEvent, family, ctx);

  expect(bundles).toHaveLength(1);
  await tick();

  expect(family.moments).toHaveLength(1);
  expect(family.moments[0].photo).toEqual({ id: 'photo-1' });
  expect(family.moments[0].voice).toEqual({ id: 'voice-1' });
  expect(family.moments[0].text).toBe('She was so happy that day');
});

test('a text bundle is not classified at 4:59 after its last message, and is classified at 5:00', async () => {
  (ask as Mock).mockResolvedValue(classification);
  await capture.handle(event({ text: 'Maria on her first day' }), family, ctx);

  advance(4 * 60_000 + 59_000);
  await tick();
  expect(ask).not.toHaveBeenCalled();
  expect(bundles).toHaveLength(1);

  advance(1000);
  await tick();
  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);
});

test('a photo, then a text 30 seconds later from the same sender: one bundle with both message ids', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  const photoEvent = event({ photo: { id: 'photo-1' } });
  await capture.handle(photoEvent, family, ctx);

  advance(30_000);
  const textEvent = event({ text: 'Maria on her first day' });
  await capture.handle(textEvent, family, ctx);

  expect(bundles).toHaveLength(1);
  await tick();

  expect(family.moments).toHaveLength(1);
  expect(family.moments[0].messageIds).toEqual([photoEvent.messageId, textEvent.messageId]);
});

test('a bare photo, a second bare photo, then a text: two moments, the first wordless at the next tick, and the text joins the second', async () => {
  (ask as Mock)
    .mockResolvedValueOnce({ ...classification, title: 'A plate of pasta' })
    .mockResolvedValueOnce({ ...classification, title: 'Danae in the morning' });
  transport.files.set('photo-food', { data: Buffer.from('f'), mimeType: 'image/jpeg' });
  transport.files.set('photo-danae', { data: Buffer.from('d'), mimeType: 'image/jpeg' });
  const foodEvent = event({ photo: { id: 'photo-food' } });
  await capture.handle(foodEvent, family, ctx);
  advance(30_000);
  const danaeEvent = event({ photo: { id: 'photo-danae' } });
  await capture.handle(danaeEvent, family, ctx);
  expect(bundles).toHaveLength(2);

  await tick();
  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);

  advance(30_000);
  const textEvent = event({ text: 'Η Δανάη το πρωί' });
  await capture.handle(textEvent, family, ctx);
  await tick();

  expect(family.moments).toHaveLength(2);
  const [food, danae] = family.moments;
  expect(food).toMatchObject({ messageIds: [foodEvent.messageId], photo: { id: 'photo-food' }, text: 'A plate of pasta', wordless: true });
  expect(danae).toMatchObject({ messageIds: [danaeEvent.messageId, textEvent.messageId], photo: { id: 'photo-danae' }, text: 'Η Δανάη το πρωί' });
  expect(danae).not.toHaveProperty('wordless');
});

test('a 3-photo album with one caption is one moment with the first photo and the caption, and a photo outside the album starts its own bundle', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('1'), mimeType: 'image/jpeg' });
  const album = [
    event({ photo: { id: 'photo-1' }, albumId: 'album-1', text: 'Maria on her first day' }),
    event({ photo: { id: 'photo-2' }, albumId: 'album-1' }),
    event({ photo: { id: 'photo-3' }, albumId: 'album-1' }),
  ];
  for (const albumEvent of album) await capture.handle(albumEvent, family, ctx);
  expect(bundles).toHaveLength(1);

  await capture.handle(event({ photo: { id: 'photo-4' } }), family, ctx);
  expect(bundles).toHaveLength(2);
  await tick();

  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);
  expect(family.moments[0]).toMatchObject({
    messageIds: album.map((albumEvent) => albumEvent.messageId),
    photo: { id: 'photo-1' },
    text: 'Maria on her first day',
  });
  expect(bundles).toHaveLength(1);
  expect(bundles[0].events[0].photo).toEqual({ id: 'photo-4' });
});

test('a tick between two messages of a captioned album keeps them in one bundle, and a tick after the grace closes it', async () => {
  (ask as Mock).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('1'), mimeType: 'image/jpeg' });
  const first = event({ photo: { id: 'photo-1' }, albumId: 'album-1', text: 'Maria on her first day' });
  await capture.handle(first, family, ctx);

  advance(1000);
  await tick();
  expect(ask).not.toHaveBeenCalled();
  const second = event({ photo: { id: 'photo-2' }, albumId: 'album-1' });
  await capture.handle(second, family, ctx);
  expect(bundles).toHaveLength(1);

  advance(3000);
  await tick();
  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);
  expect(family.moments[0]).toMatchObject({ messageIds: [first.messageId, second.messageId], photo: { id: 'photo-1' }, text: 'Maria on her first day' });
});

test('two texts 5 minutes apart from the same sender join one bundle, and a second more opens another', async () => {
  await capture.handle(event({ text: 'first message here' }), family, ctx);
  advance(5 * 60_000);
  await capture.handle(event({ text: 'second message here' }), family, ctx);
  expect(bundles).toHaveLength(1);

  advance(5 * 60_000 + 1000);
  await capture.handle(event({ text: 'third message here' }), family, ctx);
  expect(bundles).toHaveLength(2);
});

test('a voice note alone uses the transcript, or the title when the transcript is empty', async () => {
  transport.files.set('voice-1', { data: Buffer.from('v'), mimeType: 'audio/ogg' });
  (ask as Mock).mockResolvedValueOnce({ ...classification, transcript: 'She loved that trip' });
  await capture.handle(event({ voice: { id: 'voice-1' } }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();
  expect(family.moments[0].text).toBe('She loved that trip');
  expect(family.moments[0]).not.toHaveProperty('wordless');

  transport.files.set('voice-2', { data: Buffer.from('v'), mimeType: 'audio/ogg' });
  (ask as Mock).mockResolvedValueOnce({ ...classification, transcript: '' });
  await capture.handle(event({ voice: { id: 'voice-2' } }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();
  expect(family.moments[1].text).toBe(classification.title);
  expect(family.moments[1].wordless).toBe(true);
});

test('ask rejecting, or an invalid verdict, counts as failed with no moment', async () => {
  const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  (ask as Mock).mockRejectedValueOnce(new Error('boom'));
  await capture.handle(event({ text: 'Maria on her first day' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  (ask as Mock).mockResolvedValueOnce({ ...classification, verdict: 'nonsense' });
  await capture.handle(event({ text: 'another moment worth keeping' }), family, ctx);
  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments).toEqual([]);
  expect(family.counters.failed).toBe(2);
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('classification failed'));
  warnSpy.mockRestore();
});

test('two concurrent ticks classify a pending bundle once', async () => {
  let resolveAsk!: (value: unknown) => void;
  (ask as Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveAsk = resolve;
    }),
  );
  await capture.handle(event({ text: 'Maria on her first day' }), family, ctx);
  advance(BUNDLE_GAP_MS);

  const tick1 = tick();
  const tick2 = tick();
  resolveAsk(classification);
  await Promise.all([tick1, tick2]);

  expect(ask).toHaveBeenCalledTimes(1);
  expect(family.moments).toHaveLength(1);
});

test('a forget deletes the moment it replies to, the moment of a memory post, or just the story of a story message', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const m1 = moment({ id: 'm1', messageIds: ['msg-1'] });
  const m2 = moment({ id: 'm2', messageIds: ['msg-2'], memoryPostIds: ['post-2'] });
  const m3 = moment({
    id: 'm3',
    messageIds: ['msg-3'],
    stories: [{ id: 's1', by: { id: 'nikos', name: 'Nikos' }, at: 0, text: 'story text', messageIds: ['story-3'] }],
  });
  family.moments.push(m1, m2, m3);

  const forgetMoment = event({ text: 'Anchor, forget this', replyTo: 'msg-1' });
  expect(await forget.handle(forgetMoment, family, ctx)).toBe(true);
  expect(family.moments.find((m) => m.id === 'm1')).toBeUndefined();
  expect(saveSpy).toHaveBeenCalledTimes(1);

  const forgetMemoryPost = event({ text: 'Anchor, forget this', replyTo: 'post-2' });
  await forget.handle(forgetMemoryPost, family, ctx);
  expect(family.moments.find((m) => m.id === 'm2')).toBeUndefined();
  expect(saveSpy).toHaveBeenCalledTimes(2);

  const forgetStory = event({ text: 'Anchor, forget this', replyTo: 'story-3' });
  await forget.handle(forgetStory, family, ctx);
  const remaining = family.moments.find((m) => m.id === 'm3');
  expect(remaining).toBeDefined();
  expect(remaining?.stories).toEqual([]);
  expect(saveSpy).toHaveBeenCalledTimes(3);

  expect(transport.reactions).toEqual([
    { chatId: '-100', messageId: forgetMoment.messageId, emoji: '👌' },
    { chatId: '-100', messageId: forgetMemoryPost.messageId, emoji: '👌' },
    { chatId: '-100', messageId: forgetStory.messageId, emoji: '👌' },
  ]);
});

test('a forget removes an open bundle before its tick, so the tick calls no ask, and the drop alone does not save', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const bundleEvent = event({ text: 'Maria on her first day' });
  await capture.handle(bundleEvent, family, ctx);
  await forget.handle(event({ text: 'Anchor, forget this', replyTo: bundleEvent.messageId }), family, ctx);
  expect(bundles).toEqual([]);
  expect(saveSpy).not.toHaveBeenCalled();

  advance(BUNDLE_GAP_MS);
  await tick();
  expect(ask).not.toHaveBeenCalled();
  expect(family.moments).toEqual([]);
});

test('a forget while ask is pending leaves no moment saved', async () => {
  let resolveAsk!: (value: unknown) => void;
  (ask as Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveAsk = resolve;
    }),
  );
  const bundleEvent = event({ text: 'Maria on her first day' });
  await capture.handle(bundleEvent, family, ctx);
  advance(BUNDLE_GAP_MS);

  const pending = tick();
  await forget.handle(event({ text: 'Anchor, forget this', replyTo: bundleEvent.messageId }), family, ctx);
  resolveAsk(classification);
  await pending;

  expect(family.moments).toEqual([]);
});

test('a forget that owns nothing still reacts but does not save, and a forget with no reply changes nothing silently', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const stray = event({ text: 'Anchor, forget this', replyTo: 'does-not-exist' });
  expect(await forget.handle(stray, family, ctx)).toBe(true);
  expect(family.moments).toEqual([]);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: stray.messageId, emoji: '👌' }]);
  expect(saveSpy).not.toHaveBeenCalled();

  const noReply = event({ text: 'Anchor, forget this' });
  expect(await forget.handle(noReply, family, ctx)).toBe(true);
  expect(transport.reactions).toHaveLength(1);
  expect(saveSpy).not.toHaveBeenCalled();
});

test('a keep-quiet marks the moment sensitive and keeps it in place', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const m1 = moment({ id: 'm1', messageIds: ['msg-1'], sensitive: false });
  family.moments.push(m1);
  const keepQuiet = event({ text: "Anchor, don't bring this back", replyTo: 'msg-1' });
  expect(await forget.handle(keepQuiet, family, ctx)).toBe(true);
  expect(family.moments).toHaveLength(1);
  expect(family.moments[0].id).toBe('m1');
  expect(family.moments[0].sensitive).toBe(true);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: keepQuiet.messageId, emoji: '👌' }]);
  expect(saveSpy).toHaveBeenCalledTimes(1);
});

test('a keep-quiet accepts the U+2019 apostrophe too', async () => {
  const m1 = moment({ id: 'm1', messageIds: ['msg-1'] });
  family.moments.push(m1);
  const keepQuiet = event({ text: 'Anchor, don’t bring this back', replyTo: 'msg-1' });
  expect(await forget.handle(keepQuiet, family, ctx)).toBe(true);
  expect(family.moments[0].sensitive).toBe(true);
});

test('a keep-quiet on an open bundle makes the saved moment sensitive', async () => {
  (ask as Mock).mockResolvedValue(classification);
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const textEvent = event({ text: 'Maria on her first day' });
  await capture.handle(textEvent, family, ctx);
  await forget.handle(event({ text: "Anchor, don't bring this back", replyTo: textEvent.messageId }), family, ctx);
  expect(saveSpy).not.toHaveBeenCalled(); // no moment exists yet; only the in-memory bundle flag flipped

  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments[0].sensitive).toBe(true);
  expect(saveSpy).toHaveBeenCalled(); // the tick's close() saves the new, already-sensitive moment
});

test('an open bundle survives a group migration: it saves into the family and the heart goes to the new chat id', async () => {
  (ask as Mock).mockResolvedValue(classification);
  const textEvent = event({ text: 'Maria on her first day' });
  await capture.handle(textEvent, family, ctx);
  expect(bundles).toHaveLength(1);

  // intro.ts mutates the family object in place on a migration; it never replaces it
  family.id = family.chatId = '-1009';

  advance(BUNDLE_GAP_MS);
  await tick();

  expect(family.moments).toHaveLength(1);
  expect(transport.reactions).toEqual([{ chatId: '-1009', messageId: textEvent.messageId, emoji: '❤' }]);
});

function echoPair() {
  const older = moment({ id: 'm-old', by: { id: 'nikos', name: 'Nikos' }, title: 'First day at school in 1958' });
  const newer = moment({ id: 'm-new', echo: 'm-old', echoPostIds: ['echo-1', 'echo-2'] });
  family.moments.push(older, newer);
  return { older, newer };
}

const whichButtons = (prefix: string) => [
  { label: 'Nikos: First day at school in 1958', data: `${prefix}:m-old` },
  { label: "Sofia: Maria's first day at school", data: `${prefix}:m-new` },
];

test('a forget on either photo of an echo post asks which moment, with one button per moment, and changes nothing', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const { older, newer } = echoPair();

  for (const replyTo of ['echo-1', 'echo-2']) {
    const forgetEcho = event({ text: 'Anchor, forget this', replyTo });
    expect(await forget.handle(forgetEcho, family, ctx)).toBe(true);
    expect(transport.sent.at(-1)?.message).toEqual({ text: lines.forgetWhich, replyTo: forgetEcho.messageId, buttons: whichButtons('fgt') });
  }

  expect(family.moments).toEqual([older, newer]);
  expect(transport.reactions).toEqual([]);
  expect(saveSpy).not.toHaveBeenCalled();
});

test('a keep-quiet on an echo post asks which moment with the keep-quiet buttons, and changes nothing', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const { older, newer } = echoPair();

  const quietEcho = event({ text: "Anchor, don't bring this back", replyTo: 'echo-2' });
  expect(await forget.handle(quietEcho, family, ctx)).toBe(true);

  expect(transport.sent).toEqual([
    { chatId: '-100', messageId: 'sent-1', message: { text: lines.quietWhich, replyTo: quietEcho.messageId, buttons: whichButtons('qt') } },
  ]);
  expect([older.sensitive, newer.sensitive]).toEqual([false, false]);
  expect(transport.reactions).toEqual([]);
  expect(saveSpy).not.toHaveBeenCalled();
});

test('a which-one button forgets or quiets only its own moment, and reacts 👌 on the which-one message', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const { older, newer } = echoPair();

  expect(await forget.handle(event({ messageId: 'which-1', button: 'qt:m-new' }), family, ctx)).toBe(true);
  expect(newer.sensitive).toBe(true);
  expect(older.sensitive).toBe(false);

  expect(await forget.handle(event({ messageId: 'which-2', button: 'fgt:m-old' }), family, ctx)).toBe(true);
  expect(family.moments).toEqual([newer]);

  expect(transport.reactions).toEqual([
    { chatId: '-100', messageId: 'which-1', emoji: '👌' },
    { chatId: '-100', messageId: 'which-2', emoji: '👌' },
  ]);
  expect(saveSpy).toHaveBeenCalledTimes(2);
});

test('a which-one button for a moment that is gone does nothing', async () => {
  const saveSpy = vi.spyOn(ctx.store, 'save');
  const { older, newer } = echoPair();

  expect(await forget.handle(event({ button: 'fgt:gone' }), family, ctx)).toBe(true);
  expect(await forget.handle(event({ button: 'qt:gone' }), family, ctx)).toBe(true);

  expect(family.moments).toEqual([older, newer]);
  expect(transport.reactions).toEqual([]);
  expect(saveSpy).not.toHaveBeenCalled();
});

test('a which-one button label is the sender and the title, clipped to 40 characters', async () => {
  const long = moment({ id: 'm-long', title: 'The whole family at the lake house on a very long summer day' });
  const newer = moment({ id: 'm-new', echo: 'm-long', echoPostIds: ['echo-1'] });
  family.moments.push(long, newer);

  await forget.handle(event({ text: 'Anchor, forget this', replyTo: 'echo-1' }), family, ctx);

  const labels = transport.sent[0].message.buttons?.map((button) => button.label) ?? [];
  expect(labels[0]).toBe('Sofia: The whole family at the lake hou…');
  expect(labels.every((label) => label.length <= 40)).toBe(true);
});

test('a forget on an echo post whose reply send rejects still returns true and logs a warning', async () => {
  const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  echoPair();
  vi.spyOn(transport, 'send').mockRejectedValue(new Error('blocked'));

  const forgetEcho = event({ text: 'Anchor, forget this', replyTo: 'echo-1' });
  expect(await forget.handle(forgetEcho, family, ctx)).toBe(true);

  expect(warnSpy).toHaveBeenCalled();
});

test('a reply to an echo post is not a story: memories skips it, and capture bundles it as usual', async () => {
  const { newer: m1 } = echoPair();

  const reply = event({ text: 'That was such a lovely day', replyTo: 'echo-2' });
  expect(await memories.handle?.(reply, family, ctx)).toBe(false);
  expect(await capture.handle(reply, family, ctx)).toBe(true);

  expect(bundles).toHaveLength(1);
  expect(bundles[0].events).toEqual([reply]);
  expect(m1.stories).toEqual([]);
});

test('forget.handle and capture.handle return false for a private event', async () => {
  const privateEvent: Incoming = {
    chat: 'private',
    chatId: 'sofia',
    messageId: 'p1',
    sender: { id: 'sofia', name: 'Sofia' },
    at: Date.now(),
    text: 'Anchor, forget this',
  };
  expect(await forget.handle(privateEvent, family, ctx)).toBe(false);
  expect(await capture.handle(privateEvent, family, ctx)).toBe(false);
});

test('forget.handle and capture.handle return false when the router found no family', async () => {
  expect(await forget.handle(event({ text: 'Anchor, forget this', replyTo: 'x' }), undefined, ctx)).toBe(false);
  expect(await capture.handle(event({ text: 'hello there friend' }), undefined, ctx)).toBe(false);
});

test('capture leaves a group button tap to the later features', async () => {
  expect(await capture.handle(event({ button: 'shr:yes:abcd1234' }), family, ctx)).toBe(false);
  expect(family.counters).toEqual({});
});

test('flush closes every open bundle of the family at once, and waits for a bundle that the tick is already closing', async () => {
  let answer: (value: unknown) => void = () => undefined;
  (ask as Mock).mockReturnValueOnce(new Promise((resolve) => (answer = resolve))).mockResolvedValue(classification);
  transport.files.set('photo-1', { data: Buffer.from('x'), mimeType: 'image/jpeg' });
  await capture.handle(event({ text: 'Maria on her first day', photo: { id: 'photo-1' } }), family, ctx);
  const closing = tick();
  await capture.handle(event({ sender: { id: 'eleni', name: 'Eleni' }, text: 'Lunch at grandma’s on Sunday with the cousins' }), family, ctx);
  const other = store().addFamily('-200', '-200');
  bundles.push({ family: other, sender: { id: 'x', name: 'X' }, events: [event({ text: 'another family' })] });

  const flushed = flush(family, ctx);
  answer(classification);
  await Promise.all([flushed, closing]);
  expect(family.moments.map(({ by }) => by.name).sort()).toEqual(['Eleni', 'Sofia']);
  expect(bundles.map((bundle) => bundle.family)).toEqual([other]);
});
