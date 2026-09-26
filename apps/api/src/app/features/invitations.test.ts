process.env.TZ = 'Europe/Athens';

import { Logger } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { dayIndex } from '../core/clock';
import { FakeTransport } from '../core/fake-transport';
import { lines } from '../core/lines';
import { openStore } from '../core/store';
import { Blocked, type Choices, type Context, type Family, type Incoming, type Invitation, type Moment } from '../core/types';
import { ask, speak } from '../model/model';
import { asksAnchor } from './capture/filter';
import { invitations, sendMe, sendNow } from './invitations';

const DEFAULT_CHOICES: Choices = { moments: true, reminders: true, shares: true, voice: false, call: false };

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
let sequence: number;

const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const wav = Buffer.from('RIFF clip');
const STYLE = 'warm, calm and slow, like a kind family friend talking to a grandparent';
const sofiaSaid = 'Sofia shared: «Maria on her first day at school»';
const memoryButtons = (id: string) => [
  { label: lines.buttons.tellMeMore, data: `inv:more:${id}` },
  { label: lines.buttons.replyToFamily, data: `inv:reply:${id}` },
  { label: lines.buttons.notNow, data: `inv:later:${id}` },
];
const replyButtons = (id: string) => lines.familyReplies.map(([emoji, words], index) => ({ label: `${emoji} ${words}`, data: `inv:say${index}:${id}` }));
const doneButton = (id: string, label: string) => [{ label, data: `inv:done:${id}` }];
const shareButtons = (id: string) => [
  { label: lines.buttons.share, data: `inv:share:${id}` },
  { label: lines.buttons.noThanks, data: `inv:keep:${id}` },
];

const build = (overrides: Partial<Moment> = {}): Moment => ({
  id: 'm1',
  by: { id: '1', name: 'Sofia' },
  messageIds: ['57', '58'],
  savedAt: at(25, 8),
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

const eleni = { id: '2', name: 'Eleni' };
const nikos = () => family.members[0];

const invite = (moment: Moment, overrides: Partial<Invitation> = {}) => {
  nikos().invitation = { id: 'abcd1234', momentId: moment.id, momentIds: [moment.id], shareAsked: false, helped: false, ...overrides };
  return nikos().invitation;
};

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
  sender: { id: '1', name: 'Sofia' },
  at: now,
  ...overrides,
});

const receive = (event: Incoming) =>
  invitations.handle(event, event.chat === 'group' ? ctx.store.family(event.familyId) : ctx.store.familyOfMember(event.sender.id), ctx);

const tickAt = (time: number) => {
  now = time;
  return invitations.tick(family, { from: time - 60_000, to: time }, ctx);
};

// a tap on a button of the message with this id
const tap = (data: string, messageId: string) => receive(fromNikos({ button: data, messageId }));

const messages = () => transport.sent.map(({ chatId, message }) => [chatId, message]);
const edits = () => transport.edits.map(({ chatId, messageId, change }) => [chatId, messageId, change]);
const saved = () => openStore(file).family('-100');
const silenceWarnings = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(speak).mockResolvedValue(wav);
  now = at(25, 12);
  sequence = 0;
  file = join(mkdtempSync(join(tmpdir(), 'anchor-')), 'state.json');
  transport = new FakeTransport();
  const store = openStore(file, now);
  ctx = { now: () => now, store, transport: () => transport };
  family = store.addFamily('-100', '-100');
  const member = ctx.store.joinMember(family, { id: '7', name: 'Nikos' });
  member.started = true;
  member.choices.moments = true;
});

test('a group event is left to the members feature', async () => {
  expect(await receive(inGroup({ text: '/memory' }))).toBe(false);
});

test('the 11:00 tick sends the photo with its sharer, then the question with the three buttons, once a day', async () => {
  add();
  await tickAt(at(25, 11));

  const { id } = nikos().invitation ?? { id: '' };
  expect(id).toMatch(/^[0-9a-f]{8}$/);
  expect(messages()).toEqual([
    ['7', { photo: { id: 'photo-57' }, text: sofiaSaid }],
    ['7', { text: lines.remindYou, buttons: memoryButtons(id) }],
  ]);
  expect(speak).not.toHaveBeenCalled();
  const record = saved();
  expect(record?.moments[0].returns).toEqual({ '7': { count: 1 } });
  expect(record?.members[0]).toEqual({
    id: '7',
    name: 'Nikos',
    started: true,
    choices: DEFAULT_CHOICES,
    lastInvitationDay: dayIndex(at(25, 11)),
    seenAt: at(25, 8),
    invitation: { id, momentId: 'm1', momentIds: ['m1'], shareAsked: false, helped: false },
  });

  const save = vi.spyOn(ctx.store, 'save');
  now = at(25, 11, 30);
  await invitations.tick(family, { from: at(25, 10), to: now }, ctx);
  expect(transport.sent).toHaveLength(2);
  expect(save).not.toHaveBeenCalled();
});

test('with the voice choice, the voice says the sharer, the description of the photo, and the question', async () => {
  nikos().choices.voice = true;
  add({ description: 'The photo shows a girl with a red backpack at a school gate.' });
  await tickAt(at(25, 11));

  expect(speak).toHaveBeenCalledWith(`${sofiaSaid}\nThe photo shows a girl with a red backpack at a school gate.\n${lines.remindYou}`, STYLE);
  expect(messages()).toEqual([
    ['7', { photo: { id: 'photo-57' }, text: sofiaSaid }],
    ['7', { text: lines.remindYou, buttons: memoryButtons(nikos().invitation?.id ?? ''), voice: { wav } }],
  ]);
});

test('a failed voice clip sends the question as text with the buttons', async () => {
  silenceWarnings();
  nikos().choices.voice = true;
  vi.mocked(speak).mockRejectedValue(new Error('no TTS model left'));
  add();
  await tickAt(at(25, 11));
  expect(transport.sent[1].message).toEqual({ text: lines.remindYou, buttons: memoryButtons(nikos().invitation?.id ?? '') });
});

test('a wordless photo is captioned by its title, never as a quote', async () => {
  add({ text: "Maria's first day at school", wordless: true });
  await tickAt(at(25, 11));
  expect(transport.sent[0].message).toEqual({ photo: { id: 'photo-57' }, text: "Sofia shared a photo: Maria's first day at school" });
});

test('a moment with a video goes out as the video, and a moment with no picture as one message', async () => {
  add({ video: { id: 'video-57' } });
  await tickAt(at(25, 11));
  expect(transport.sent[0].message).toEqual({ video: { id: 'video-57' }, text: sofiaSaid });

  family.moments = [build({ photo: undefined })];
  await tickAt(at(26, 11));
  expect(transport.sent.slice(2).map(({ message }) => message.text)).toEqual([`${sofiaSaid}\n${lines.remindYou}`]);
});

test('the memory of the week holds up to 5 newest moments, the own ones too, and the photos form an album oldest first', async () => {
  vi.mocked(ask).mockResolvedValue({ caption: 'Sofia and Eleni shared school and lunch.' });
  add({ id: 'old', savedAt: at(17, 12), photo: { id: 'photo-old' } });
  add({ id: 'quiet', sensitive: true, savedAt: at(24, 12) });
  add({ id: 'after', savedAt: at(25, 11, 1) });
  add({ id: 'text', by: eleni, photo: undefined, text: 'Lunch at grandma’s on Sunday', savedAt: at(20, 12) });
  add({ id: 'own', by: { id: '7', name: 'Nikos' }, photo: { id: 'photo-own' }, savedAt: at(21, 12) });
  add({ id: 'a', savedAt: at(22, 12), photo: { id: 'photo-a' } });
  add({ id: 'b', by: eleni, savedAt: at(23, 12), photo: { id: 'photo-b' } });
  add({ id: 'c', savedAt: at(24, 12), photo: { id: 'photo-c' } });
  add({ id: 'd', by: eleni, savedAt: at(25, 10), photo: { id: 'photo-d' } });
  await tickAt(at(25, 11));

  const [prompt] = vi.mocked(ask).mock.calls[0];
  expect(prompt).toContain('with the label "This week in the family": 5 family moments.');
  const caption = lines.weekMemory('Sofia and Eleni shared school and lunch.');
  const { id } = nikos().invitation ?? { id: '' };
  expect(messages()).toEqual([
    ['7', { album: ['photo-own', 'photo-a', 'photo-b', 'photo-c', 'photo-d'].map((photo) => ({ photo: { id: photo } })), text: caption }],
    ['7', { text: lines.remindYou, buttons: memoryButtons(id) }],
  ]);
  // Sofia and Eleni tie with 2 moments each, and Sofia shared first, so her newest moment leads
  expect(nikos().invitation).toMatchObject({ momentId: 'c', momentIds: ['own', 'a', 'b', 'c', 'd'] });
  expect(nikos().seenAt).toBe(at(25, 10));
});

test('a week with one photo and a text moment sends the photo with the caption, and the voice says the caption before the question', async () => {
  nikos().choices.voice = true;
  add({ id: 'text', by: eleni, photo: undefined, text: 'Lunch at grandma’s on Sunday', savedAt: at(24, 12) });
  add();
  await tickAt(at(25, 11));

  const caption = lines.weekMemory(lines.weekShared(family.moments));
  expect(caption).toBe('This week in the family 💛\nEleni and Sofia shared 2 moments.');
  expect(speak).toHaveBeenCalledWith(`${caption}\n${lines.remindYou}`, STYLE);
  expect(messages()).toEqual([
    ['7', { photo: { id: 'photo-57' }, text: caption }],
    ['7', { text: lines.remindYou, buttons: memoryButtons(nikos().invitation?.id ?? ''), voice: { wav } }],
  ]);
});

test('a week with no moment takes the 5 newest, and an empty record sends nothing', async () => {
  await tickAt(at(25, 11));
  expect(transport.sent).toEqual([]);
  expect(saved()?.members[0].lastInvitationDay).toBe(dayIndex(at(25, 11)));

  add({ id: 'older', savedAt: at(2, 12), photo: undefined });
  add({ id: 'old', savedAt: at(10, 12) });
  await tickAt(at(26, 11));
  expect(nikos().invitation?.momentIds).toEqual(['older', 'old']);
});

test('every new day sends the memory again, with a new id, and the open one closes without a message', async () => {
  const moment = add();
  await tickAt(at(25, 11));
  const first = nikos().invitation?.id;
  await tickAt(at(26, 11));
  await tickAt(at(27, 11));
  expect(transport.sent).toHaveLength(6);
  expect(nikos().invitation?.id).not.toBe(first);
  expect(moment.returns['7']).toEqual({ count: 3 });
});

test('every started member with family moments gets the memory, and one caption call serves the same week', async () => {
  const eleniMember = ctx.store.joinMember(family, eleni);
  eleniMember.started = true;
  eleniMember.choices.moments = true;
  ctx.store.joinMember(family, { id: '9', name: 'Maria' });
  add();
  add({ id: 'm2', by: eleni, photo: { id: 'photo-99' }, savedAt: at(25, 7) });
  await tickAt(at(25, 11));

  expect(ask).toHaveBeenCalledTimes(1);
  expect(transport.sent.map(({ chatId }) => chatId).sort()).toEqual(['2', '2', '7', '7']);
  expect(nikos().invitation?.momentId).toBe('m2');
  expect(eleniMember.invitation?.momentId).toBe('m1');
});

test('a member who blocked Anchor stops getting memories, and the return still counts', async () => {
  vi.spyOn(transport, 'send').mockRejectedValue(new Blocked());
  add();
  await tickAt(at(25, 11));
  const record = saved();
  expect(record?.members[0]).toMatchObject({ started: false, lastInvitationDay: dayIndex(at(25, 11)) });
  expect(record?.moments[0].returns['7'].count).toBe(1);
});

test('"Reply to the family" swaps the buttons in place, a reply goes to the group, and Anchor asks to call the top sharer', async () => {
  const moment = add({ by: eleni });
  await tickAt(at(25, 11));
  const { id } = nikos().invitation ?? { id: '' };
  const memory = transport.sent[1].messageId;

  expect(await tap(`inv:reply:${id}`, memory)).toBe(true);
  expect(edits()).toEqual([['7', memory, { buttons: replyButtons(id) }]]);

  await tap(`inv:say2:${id}`, memory);
  await tap(`inv:say2:${id}`, memory);
  await tap(`inv:reply:${id}`, memory);
  expect(edits().slice(1)).toEqual([['7', memory, { buttons: doneButton(id, lines.done.sent) }]]);
  expect(messages().slice(2)).toEqual([
    ['-100', { text: 'Nikos: «I miss you all 💛»', replyTo: moment.messageIds[0] }],
    ['7', { text: lines.askCall('Eleni'), buttons: [{ label: 'Yes, ask Eleni', data: `inv:call:${id}` }, { label: 'No, thanks', data: `inv:nocall:${id}` }] }],
  ]);

  const question = transport.sent[3].messageId;
  await tap(`inv:call:${id}`, question);
  await tap(`inv:call:${id}`, question);
  await tap(`inv:done:${id}`, question);
  expect(edits().slice(2)).toEqual([['7', question, { buttons: doneButton(id, lines.done.askedCall('Eleni')) }]]);
  expect(messages().slice(4)).toEqual([['-100', { text: lines.wouldLoveCall('Nikos', 'Eleni'), mention: eleni }]]);
  expect(saved()?.members[0].invitation).toMatchObject({ said: true, askedCall: true });
});

test('"No, thanks" on the call question removes its buttons, and a memory of only own moments asks no call', async () => {
  add({ by: eleni });
  await tickAt(at(25, 11));
  const { id } = nikos().invitation ?? { id: '' };
  await tap(`inv:say0:${id}`, transport.sent[1].messageId);
  await tap(`inv:nocall:${id}`, transport.sent[3].messageId);
  expect(edits().at(-1)).toEqual(['7', transport.sent[3].messageId, { buttons: [] }]);
  expect(messages().filter(([chatId]) => chatId === '-100')).toEqual([['-100', { text: 'Nikos: «Sending my love ❤️»', replyTo: '57' }]]);

  family.moments = [build({ by: { id: '7', name: 'Nikos' } })];
  await tickAt(at(26, 11));
  const own = nikos().invitation?.id;
  const sent = transport.sent.length;
  await tap(`inv:say1:${own}`, transport.sent.at(-1)?.messageId ?? '');
  expect(messages().slice(sent)).toEqual([['-100', { text: 'Nikos: «That made me smile 😊»', replyTo: '57' }]]);
});

test('"Later, please" collapses the buttons in place and keeps the memory open for a story', async () => {
  add();
  await tickAt(at(25, 11));
  const invitation = nikos().invitation;
  await tap(`inv:later:${invitation?.id}`, transport.sent[1].messageId);
  expect(edits()).toEqual([['7', transport.sent[1].messageId, { buttons: doneButton(invitation?.id ?? '', lines.done.later) }]]);
  expect(transport.sent).toHaveLength(2);
  expect(nikos().invitation).toBe(invitation);
});

test('"Tell me more" names each moment, then plays the voice notes of the sharers with the next two buttons', async () => {
  nikos().choices.voice = true;
  add({ description: 'The photo shows a girl at a school gate.', voice: { id: 'voice-57' } });
  add({ id: 'm2', by: eleni, photo: { id: 'photo-99' }, savedAt: at(24, 9), text: 'Sunday lunch' });
  add({ id: 'm3', by: eleni, photo: undefined, savedAt: at(24, 10), text: 'The cousins sang', voice: { id: 'voice-99' } });
  await tickAt(at(25, 11));
  const { id } = nikos().invitation ?? { id: '' };
  vi.mocked(speak).mockClear();
  const sent = transport.sent.length;

  await tap(`inv:more:${id}`, transport.sent[1].messageId);
  const [m1, m2, m3] = family.moments;
  expect(speak).toHaveBeenCalledWith(lines.aboutMoments([m2, m3, m1], true), STYLE);
  const next = [
    { label: lines.buttons.replyToFamily, data: `inv:reply:${id}` },
    { label: lines.buttons.dontShowThese, data: `inv:hide:${id}` },
  ];
  expect(messages().slice(sent)).toEqual([
    ['7', { text: lines.aboutMoments([m2, m3, m1]), voice: { wav } }],
    ['7', { voice: { id: 'voice-99' } }],
    ['7', { voice: { id: 'voice-57' }, buttons: next }],
  ]);
  expect(edits()).toEqual([]);
});

test('"Don\'t show me these again" hides the moments for this member only, and the family still sees them', async () => {
  const moment = add();
  add({ id: 'm2', by: eleni, photo: undefined, text: 'Sunday lunch', savedAt: at(24, 9) });
  await tickAt(at(25, 11));
  const { id } = nikos().invitation ?? { id: '' };
  await tap(`inv:more:${id}`, transport.sent[1].messageId);
  const more = transport.sent[2].messageId;

  await tap(`inv:hide:${id}`, more);
  expect(edits()).toEqual([['7', more, { buttons: doneButton(id, lines.done.hidden) }]]);
  expect(saved()?.members[0].hidden).toEqual(['m2', 'm1']);
  expect(nikos().invitation).toBeUndefined();
  expect(moment.sensitive).toBe(false);

  add({ id: 'm3', savedAt: at(25, 12) });
  await tickAt(at(26, 11));
  expect(nikos().invitation?.momentIds).toEqual(['m3']);
});

test('a tap on an older or closed memory removes the buttons of that message and does nothing else', async () => {
  add();
  await tickAt(at(25, 11));
  const { id: old } = nikos().invitation ?? { id: '' };
  await tickAt(at(26, 11));
  const sent = transport.sent.length;

  expect(await tap(`inv:reply:${old}`, transport.sent[1].messageId)).toBe(true);
  expect(await tap('inv:what:3f1c9a2e-5b7d-4e0a-9c1b-2d3e4f5a6b7c', 'old-voice')).toBe(true);
  nikos().invitation = undefined;
  expect(await tap(`inv:more:${old}`, 'closed')).toBe(true);
  expect(edits()).toEqual([
    ['7', transport.sent[1].messageId, { buttons: [] }],
    ['7', 'old-voice', { buttons: [] }],
    ['7', 'closed', { buttons: [] }],
  ]);
  expect(transport.sent).toHaveLength(sent);
});

test('"Send me a moment" and a share offer send a memory of one moment with the same buttons', async () => {
  const moment = add();
  await sendNow(family, nikos(), moment, ctx);
  expect(messages()).toEqual([
    ['7', { photo: { id: 'photo-57' }, text: sofiaSaid }],
    ['7', { text: lines.remindYou, buttons: memoryButtons(nikos().invitation?.id ?? '') }],
  ]);

  add({ id: 'm2', savedAt: at(20, 8), photo: { id: 'photo-99' } });
  nikos().hidden = ['m1'];
  await sendMe(family, nikos(), ctx);
  expect(nikos().invitation?.momentIds).toEqual(['m2']);
});

test('a story reply gets thanks with the share buttons once, and a second story reply joins the first', async () => {
  invite(add());
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'story' });
  expect(await receive(fromNikos({ text: 'She would not let go of my hand' }))).toBe(true);
  expect(await receive(fromNikos({ text: 'Then she ran in' }))).toBe(true);

  const [prompt, schema, options] = vi.mocked(ask).mock.calls[0];
  for (const part of [
    "Maria's first day at school",
    'Sofia',
    'Maria on her first day at school',
    'She would not let go of my hand',
    '- question: ',
  ]) {
    expect(prompt).toContain(part);
  }
  expect(schema).toEqual({
    type: 'object',
    properties: { transcript: { type: 'string' }, kind: { type: 'string', enum: ['story', 'unsure', 'question', 'request', 'other'] } },
    required: ['transcript', 'kind'],
  });
  expect(options).toEqual({ media: [], fast: true });
  expect(saved()?.members[0].invitation).toEqual({
    id: 'abcd1234',
    momentId: 'm1',
    momentIds: ['m1'],
    shareAsked: true,
    helped: false,
    story: { text: 'She would not let go of my hand\nThen she ran in' },
  });
  expect(messages()).toEqual([['7', { text: lines.thanks, buttons: shareButtons('abcd1234') }]]);
});

test('a voice reply sends the downloaded clip to the call, and the story keeps the first voice note and the transcripts', async () => {
  const first = { data: Buffer.from('first clip'), mimeType: 'audio/ogg' };
  transport.files.set('voice-a', first);
  transport.files.set('voice-b', { data: Buffer.from('second clip'), mimeType: 'audio/ogg' });
  const invitation = invite(add());
  vi.mocked(ask).mockResolvedValueOnce({ transcript: ' She held my hand ', kind: 'story' }).mockResolvedValueOnce({ transcript: '', kind: 'story' });
  await receive(fromNikos({ voice: { id: 'voice-a' } }));
  await receive(fromNikos({ voice: { id: 'voice-b' } }));

  expect(vi.mocked(ask).mock.calls[0][2]).toEqual({ media: [first], fast: true });
  expect(invitation.story).toEqual({ text: `She held my hand\n${lines.voiceNote}`, voice: { id: 'voice-a' } });
});

test('a first unsure reply gets gentleHelp and the voice note of the moment, and a second one closes with warmClose', async () => {
  invite(add({ voice: { id: 'voice-57' } }));
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'unsure' });
  await receive(fromNikos({ text: 'a school?' }));
  expect(messages()).toEqual([
    ['7', { text: lines.gentleHelp('25 September 2026', "Maria's first day at school") }],
    ['7', { voice: { id: 'voice-57' } }],
  ]);
  expect(saved()?.members[0].invitation).toEqual({ id: 'abcd1234', momentId: 'm1', momentIds: ['m1'], shareAsked: false, helped: true });

  await receive(fromNikos({ text: 'a park?' }));
  expect(transport.sent[2].message).toEqual({ text: lines.warmClose });
  expect(saved()?.members[0].invitation).toBeUndefined();
  expect(ask).not.toHaveBeenCalled();
});

test('a short reply that ends with "?" is decided in code: "school?" is unsure, and "who is that?" is a question', async () => {
  invite(add({ eventDate: '1958-06-01' }));
  await receive(fromNikos({ text: 'school?' }));
  expect(messages()).toEqual([['7', { text: lines.gentleHelp('1 June 1958', "Maria's first day at school") }]]);

  await receive(fromNikos({ text: 'Who is that?' }));
  expect(transport.sent[1].message).toEqual({ text: lines.tellDirectly("Maria's first day at school", '1 June 1958', 'Sofia') });
  expect(ask).not.toHaveBeenCalled();
});

test('a longer reply that ends with "?" still goes to the model', async () => {
  invite(add());
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'story' });
  await receive(fromNikos({ text: "It was her first day, wasn't it?" }));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(transport.sent[0].message).toMatchObject({ text: lines.thanks });
});

test('a fixed phrase while an invitation is open goes to intents, and the invitation stays open', async () => {
  const moment = add();
  const invitation = invite(moment);
  for (const text of ['settings', 'I want to change my settings', "this month's birthdays?", 'What did I miss?', 'call me', 'Send me a moment', 'Another moment']) {
    expect(await receive(fromNikos({ text }))).toBe(false);
  }
  expect(nikos().invitation).toBe(invitation);
  expect(transport.sent).toEqual([]);
  expect(ask).not.toHaveBeenCalled();
});

test('a long story that names birthdays in passing stays a story', async () => {
  invite(add());
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'story' });
  await receive(fromNikos({ text: 'I remember all the birthdays we had in that garden', voice: { id: 'voice-a' } }));
  expect(nikos().invitation?.story).toEqual({ text: 'I remember all the birthdays we had in that garden', voice: { id: 'voice-a' } });
});

test('a request to Anchor while an invitation is open goes to intents, and the invitation stays open', async () => {
  const moment = add();
  const invitation = invite(moment);
  for (const text of ['A memory of Lucy', 'more photos?', 'Show me photos of Lucy', 'remind me about my pills']) {
    expect(await receive(fromNikos({ text }))).toBe(false);
  }
  expect(ask).not.toHaveBeenCalled();

  vi.mocked(ask).mockResolvedValue({ kind: 'request', transcript: '' });
  expect(await receive(fromNikos({ text: 'When is lunch on Sunday, at grandma’s?' }))).toBe(false);
  expect(nikos().invitation).toBe(invitation);
  expect(transport.sent).toEqual([]);
});

test('a story that starts like a request stays a story', () => {
  for (const text of ['The photo reminds me of the Acropolis', 'A memory of Lucy: she loved the sea and ran every morning', 'It reminds me of our trip']) {
    expect(asksAnchor(text)).toBe(false);
  }
});

test('a story reply after a keep-quiet turns the moment sensitive sends no thanks and returns false', async () => {
  add();
  await tickAt(at(25, 11));
  const sentBefore = transport.sent.length;
  family.moments[0].sensitive = true;

  expect(await receive(fromNikos({ text: 'She would not let go of my hand' }))).toBe(false);
  expect(transport.sent).toHaveLength(sentBefore);
  expect(ask).not.toHaveBeenCalled();
  expect(nikos().invitation).toBeUndefined();
});

test('"Yes, share it" for a moment that turned sensitive while the story waited posts nothing in the group', async () => {
  const moment = add();
  invite(moment, { story: { text: 'She would not let go of my hand' }, shareAsked: true });
  moment.sensitive = true;

  expect(await receive(fromNikos({ button: 'inv:share:abcd1234' }))).toBe(false);
  expect(transport.sent).toEqual([]);
  expect(nikos().invitation).toBeUndefined();
});

test('a forget during a pending reply call sends nothing after the call resolves', async () => {
  const moment = add();
  invite(moment);
  let answer: (value: unknown) => void;
  vi.mocked(ask).mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const reply = receive(fromNikos({ text: 'She would not let go of my hand' }));
  family.moments.splice(family.moments.indexOf(moment), 1);
  answer({ transcript: '', kind: 'story' });

  expect(await reply).toBe(true);
  expect(transport.sent).toEqual([]);
});

test('a question reply gets tellDirectly and keeps the invitation open, and a later unsure reply still gets gentleHelp', async () => {
  invite(add({ eventDate: '1958-06-01' }));
  vi.mocked(ask).mockResolvedValueOnce({ transcript: '', kind: 'question' }).mockResolvedValueOnce({ transcript: '', kind: 'unsure' });
  await receive(fromNikos({ text: 'who is that?' }));
  expect(messages()).toEqual([['7', { text: lines.tellDirectly("Maria's first day at school", '1 June 1958', 'Sofia') }]]);
  expect(nikos().invitation).toMatchObject({ momentId: 'm1', helped: false });

  await receive(fromNikos({ text: 'a school?' }));
  expect(transport.sent[1].message).toEqual({ text: lines.gentleHelp('1 June 1958', "Maria's first day at school") });
  expect(nikos().invitation?.helped).toBe(true);
});

test('a question while a story waits for the share buttons still gets tellDirectly', async () => {
  const waiting = invite(add(), { story: { text: 'She ran in' }, shareAsked: true });
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'question' });
  await receive(fromNikos({ text: 'what is this?' }));
  expect(messages()).toEqual([['7', { text: lines.tellDirectly("Maria's first day at school", '25 September 2026', 'Sofia') }]]);
  expect(nikos().invitation).toBe(waiting);
});

test('gentleHelp dates the moment by its event date when it has one', async () => {
  invite(add({ eventDate: '1958-06-01' }));
  await receive(fromNikos({ text: 'the old school?' }));
  expect(messages()).toEqual([['7', { text: lines.gentleHelp('1 June 1958', "Maria's first day at school") }]]);
});

test('an other reply closes with warmClose, a sticker or a forward is other with no call, and other while a story waits sends nothing', async () => {
  const moment = add();
  vi.mocked(ask).mockResolvedValue({ transcript: '', kind: 'other' });
  invite(moment);
  await receive(fromNikos({ text: 'ok' }));
  expect(nikos().invitation).toBeUndefined();

  invite(moment);
  await receive(fromNikos({ unsupported: true }));
  invite(moment);
  await receive(fromNikos({ text: 'Look at this one', forwarded: true }));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(nikos().invitation).toBeUndefined();

  const waiting = invite(moment, { story: { text: 'She ran in' }, shareAsked: true });
  await receive(fromNikos({ text: '👍' }));
  expect(nikos().invitation).toEqual(waiting);
  expect(transport.sent.map(({ message }) => message.text)).toEqual([lines.warmClose, lines.warmClose, lines.warmClose]);
});

test('a failed or invalid reply call reads a voice note or 3 words as a story, and "ok" as other', async () => {
  silenceWarnings();
  const moment = add();
  vi.mocked(ask).mockRejectedValueOnce(new Error('Gemini is down')).mockResolvedValueOnce({ kind: 'maybe' });
  const told = invite(moment);
  await receive(fromNikos({ text: 'She ran in' }));
  expect(told.story).toEqual({ text: 'She ran in' });

  invite(moment);
  await receive(fromNikos({ text: 'ok' }));
  expect(nikos().invitation).toBeUndefined();

  const spoken = invite(moment);
  await receive(fromNikos({ voice: { id: 'missing-clip' } }));
  expect(spoken.story).toEqual({ text: lines.voiceNote, voice: { id: 'missing-clip' } });
  expect(transport.sent.map(({ message }) => message.text)).toEqual([lines.thanks, lines.warmClose, lines.thanks]);
});

test('"Yes, share it" posts storyAdded as a reply to the moment with a mention of the sender, reacts with a big heart, and ignores a second tap', async () => {
  const moment = add();
  invite(moment, { story: { text: 'She would not let go of my hand' }, shareAsked: true });
  expect(await receive(fromNikos({ button: 'inv:share:abcd1234' }))).toBe(true);
  expect(await receive(fromNikos({ button: 'inv:share:abcd1234' }))).toBe(true);

  expect(messages()).toEqual([
    ['-100', { text: lines.storyAdded('Nikos', 'Sofia', 'She would not let go of my hand'), replyTo: '57', mention: { id: '1', name: 'Sofia' } }],
    ['7', { text: lines.shared }],
  ]);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: 'sent-1', emoji: '\u2764', big: true }]);
  const record = saved();
  expect(record?.moments[0].stories).toEqual([
    { id: expect.any(String), by: { id: '7', name: 'Nikos' }, at: now, text: 'She would not let go of my hand', messageIds: ['sent-1'] },
  ]);
  expect(record?.members[0].invitation).toBeUndefined();
});

test('a shared voice story follows storyAdded as the voice note, not as a reply', async () => {
  const moment = add();
  invite(moment, { story: { text: 'She held my hand', voice: { id: 'voice-a' } }, shareAsked: true });
  await receive(fromNikos({ button: 'inv:share:abcd1234' }));
  expect(messages()).toEqual([
    ['-100', { text: lines.storyAdded('Nikos', 'Sofia', 'She held my hand'), replyTo: '57', mention: { id: '1', name: 'Sofia' } }],
    ['-100', { voice: { id: 'voice-a' } }],
    ['7', { text: lines.shared }],
  ]);
  expect(transport.reactions).toEqual([{ chatId: '-100', messageId: 'sent-1', emoji: '\u2764', big: true }]);
  expect(moment.stories[0]).toMatchObject({ text: 'She held my hand', voice: { id: 'voice-a' }, messageIds: ['sent-1', 'sent-2'] });
});

test('"No, thanks" sends notShared, closes the invitation, and keeps no story', async () => {
  const moment = add();
  invite(moment, { story: { text: 'She ran in' }, shareAsked: true });
  await receive(fromNikos({ button: 'inv:keep:abcd1234' }));
  expect(messages()).toEqual([['7', { text: lines.notShared }]]);
  expect(saved()?.members[0].invitation).toBeUndefined();
  expect(moment.stories).toEqual([]);
});

test('a reply whose call is still pending when the 11:00 slot replaces the memory sends no thanks', async () => {
  const old = invite(add());
  let answer: (value: unknown) => void;
  vi.mocked(ask).mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const reply = receive(fromNikos({ text: 'She would not let go of my hand' }));
  await tickAt(at(26, 11));
  answer({ transcript: '', kind: 'story' });

  expect(await reply).toBe(true);
  expect(transport.sent.map(({ message }) => message.text)).toEqual([sofiaSaid, lines.remindYou]);
  expect(old.story).toBeUndefined();
  expect(nikos().invitation).not.toBe(old);
});
test('a reply to an invitation whose moment was forgotten closes the invitation and is left to the router', async () => {
  invite(add());
  family.moments.length = 0;
  expect(await receive(fromNikos({ text: 'She would not let go of my hand' }))).toBe(false);
  expect(saved()?.members[0].invitation).toBeUndefined();
  expect(ask).not.toHaveBeenCalled();
  expect(transport.sent).toEqual([]);
});

test('with no open invitation, or for another command, a private message is left to the router', async () => {
  expect(await receive(fromNikos({ text: 'hello' }))).toBe(false);
  invite(add());
  expect(await receive(fromNikos({ text: '/help' }))).toBe(false);
  expect(ask).not.toHaveBeenCalled();
  expect(transport.sent).toEqual([]);
});
