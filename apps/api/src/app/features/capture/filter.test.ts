process.env.TZ = 'Europe/Athens';

import { expect, test } from 'vitest';
import type { Family, Incoming } from '../../core/types';
import { fixedIntent, isClosed, passesRules, typedText, wordCount, worthClassifying } from './filter';
import type { Bundle } from './filter';

test('wordCount counts the words of a text and skips links', () => {
  expect(wordCount(undefined)).toBe(0);
  expect(wordCount('  ')).toBe(0);
  expect(wordCount('Maria on her first day')).toBe(5);
  expect(wordCount('https://example.com www.example.org http://a.b/c')).toBe(0);
  expect(wordCount('look https://example.com at this')).toBe(3);
});

const sender = { id: '1', name: 'Sofia' };
const family: Family = { id: '-100', chatId: '-100', members: [], moments: [], offers: [], reminders: [], counters: {} };

function event(overrides: Partial<Incoming> = {}): Incoming {
  return { chat: 'group', chatId: '-100', messageId: '1', sender, at: 0, ...overrides };
}

function bundle(events: Incoming[]): Bundle {
  return { family, sender, events };
}

test('passesRules drops an unsupported message, a forwarded message, a command, and a bare link', () => {
  expect(passesRules(event({ unsupported: true }))).toBe(false);
  expect(passesRules(event({ text: 'look at this', forwarded: true }))).toBe(false);
  expect(passesRules(event({ text: '/memory' }))).toBe(false);
  expect(passesRules(event({ text: 'https://example.com' }))).toBe(false);
});

test('passesRules keeps a photo with no caption, a video, and a plain text', () => {
  expect(passesRules(event({ photo: { id: 'p1' } }))).toBe(true);
  expect(passesRules(event({ video: { id: 'v1' } }))).toBe(true);
  expect(passesRules(event({ text: 'Maria on her first day' }))).toBe(true);
});

test('isClosed is true 5 minutes after the last message, and not a second before', () => {
  const open = bundle([event({ text: 'hello' })]);
  expect(isClosed(open, 5 * 60_000 - 1000)).toBe(false);
  expect(isClosed(open, 5 * 60_000)).toBe(true);
});

test('isClosed waits the 5 minutes for a bare photo, so a text can still join it', () => {
  const photo = bundle([event({ photo: { id: 'p1' } })]);
  expect(isClosed(photo, 5 * 60_000 - 1000)).toBe(false);
  expect(isClosed(photo, 5 * 60_000)).toBe(true);
});

test('isClosed is true at once for a sealed bundle, which a newer picture from the sender replaced', () => {
  expect(isClosed({ ...bundle([event({ photo: { id: 'p1' } })]), sealed: true }, 0)).toBe(true);
});

test('isClosed waits 3 seconds after an album message for the rest of the album, even with a picture and words', () => {
  const album = bundle([event({ text: 'Maria', photo: { id: 'p1' }, albumId: 'a1' })]);
  expect(isClosed(album, 2999)).toBe(false);
  expect(isClosed(album, 3000)).toBe(true);
});

test('isClosed is true at once for a voice note without a picture, so its ❤ lands within seconds', () => {
  expect(isClosed(bundle([event({ voice: { id: 'a1' } })]), 0)).toBe(true);
  expect(isClosed(bundle([event({ text: 'Listen to this' }), event({ voice: { id: 'a1' } })]), 0)).toBe(true);
});

test('isClosed is true at once for a captioned photo, and for a captioned video', () => {
  expect(isClosed(bundle([event({ text: 'Maria', photo: { id: 'p1' } })]), 0)).toBe(true);
  expect(isClosed(bundle([event({ text: 'Maria', video: { id: 'v1' } })]), 0)).toBe(true);
});

test('worthClassifying drops fewer than 3 typed words, and a bare video without a thumbnail', () => {
  expect(worthClassifying(bundle([event({ text: 'ok great' })]))).toBe(false);
  expect(worthClassifying(bundle([event({ video: { id: 'v1' } })]))).toBe(false);
});

test('worthClassifying keeps a bare photo, and a bare video with a thumbnail', () => {
  expect(worthClassifying(bundle([event({ photo: { id: 'p1' } })]))).toBe(true);
  expect(worthClassifying(bundle([event({ video: { id: 'v1' }, thumbnail: { id: 't1' } })]))).toBe(true);
});

test('worthClassifying keeps 3 typed words, a voice note alone, and a photo with a caption', () => {
  expect(worthClassifying(bundle([event({ text: 'a b c' })]))).toBe(true);
  expect(worthClassifying(bundle([event({ voice: { id: 'v1' } })]))).toBe(true);
  expect(worthClassifying(bundle([event({ text: 'Maria', photo: { id: 'p1' } })]))).toBe(true);
});

test('worthClassifying keeps a bare photo or a bare video that also carries a voice note', () => {
  expect(worthClassifying(bundle([event({ photo: { id: 'p1' } }), event({ messageId: '2', voice: { id: 'v1' } })]))).toBe(true);
  expect(worthClassifying(bundle([event({ video: { id: 'v1' } }), event({ messageId: '2', voice: { id: 'v2' } })]))).toBe(true);
});

test('typedText joins the texts and the captions of the bundle in message order', () => {
  const events = [event({ messageId: '1', text: 'Maria on her first day' }), event({ messageId: '2', text: 'so proud of her' })];
  expect(typedText(bundle(events))).toBe('Maria on her first day\nso proud of her');
});

test('fixedIntent decides the fixed phrases in code, and leaves every other text to the model', () => {
  const cases: [string, ReturnType<typeof fixedIntent>][] = [
    ['can you send me the family photos?', 'sendMe'],
    ['Send me a moment', 'sendMe'],
    ['Another moment', 'sendMe'],
    ['settings', 'settings'],
    ['My settings', 'settings'],
    ['please call me', 'callMe'],
    ['Call me', 'callMe'],
    ['What did I miss?', 'missed'],
    ['stop', 'stop'],
    ['Stop.', 'stop'],
    ['My mother used to send me to the village school', undefined],
    ['Stop, this one makes me cry', undefined],
    ['who is that?', undefined],
    ['when did Maria start school?', undefined],
  ];
  for (const [text, intent] of cases) expect([text, fixedIntent(text)]).toEqual([text, intent]);
});
