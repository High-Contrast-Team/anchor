import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { demoNow } from './core/clock';
import { FakeTransport } from './core/fake-transport';
import { lines } from './core/lines';
import { createRouter } from './core/router';
import { openStore } from './core/store';
import type { Context, Incoming, Person } from './core/types';
import { FEATURES, nextWindow } from './family.service';
import { bundles } from './features/capture/capture';
import { choiceButtons } from './features/members';
import * as model from './model/model';

vi.mock('./model/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./model/model')>()),
  ask: vi.fn(),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));

const HOUR = 3_600_000;
const eleni: Person = { id: 'u-eleni', name: 'Eleni' };
const nikos: Person = { id: 'u-nikos', name: 'Nikos' };
const sofia: Person = { id: 'u-sofia', name: 'Sofia' };
const alexandros: Person = { id: 'u-alexandros', name: 'Alexandros' };
const maria = "Maria's first day of school! She wore her new red backpack.";
const nikosFirstDay = 'My first day of school, 1958. My mother walked me to the gate.';
const nikosStory = 'My first day was in 1958. My mother walked me to the village school, and I cried at the gate.';
const pills = 'Dad, remember to take your pills with you when we leave in the morning.';
const wav = Buffer.from('RIFF clip');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 12));
  bundles.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'anchor-demo-')), 'state.json'), Date.now());
  const family = store.addFamily('-100', '-100');
  const transport = new FakeTransport();
  transport.admins.add(eleni.id);
  transport.files.set('photo-maria', { data: Buffer.from('maria jpeg'), mimeType: 'image/jpeg' });
  transport.files.set('photo-1958', { data: Buffer.from('1958 jpeg'), mimeType: 'image/jpeg' });
  transport.files.set('voice-nikos', { data: Buffer.from('nikos ogg'), mimeType: 'audio/ogg' });
  for (const id of ['photo-beach', 'photo-castle', 'voice-castle']) transport.files.set(id, { data: Buffer.from(id), mimeType: 'application/octet-stream' });
  let restart = false;
  const ctx: Context = { now: () => demoNow(store.state, 86400), store, transport: () => transport, restartWindow: () => (restart = true) };
  const router = createRouter(FEATURES, ctx);
  let from = ctx.now();
  let id = 0;
  return {
    store,
    family,
    transport,
    ctx,
    say: (sender: Person, message: Partial<Incoming>) =>
      router.route({ familyId: '-100', chat: 'group', chatId: '-100', messageId: String(++id), sender, at: Date.now(), ...message }),
    whisper: (sender: Person, message: Partial<Incoming>) =>
      router.route({ chat: 'private', chatId: sender.id, messageId: String(++id), sender, at: Date.now(), ...message }),
    // the host's tick loop: each window runs from the previous one to now, and restartWindow empties the next one
    tick: async () => {
      const to = ctx.now();
      const window = nextWindow(from, to, restart);
      restart = false;
      await router.tick(window);
      from = to;
    },
  };
}

vi.mocked(model.ask).mockImplementation(async (prompt: string, schema: object) => {
  const properties = (schema as { properties: Record<string, unknown> }).properties;
  const momentId = (prompt.match(/- id (\S+): "Maria's first day at school"/) ?? prompt.match(/(\S+): "Maria's first day at school"/))?.[1];
  if (properties.verdict) {
    const isNikos = prompt.includes('1958');
    return {
      verdict: prompt.includes('pills') ? 'logistics' : 'family_moment',
      salience: 4,
      people: [isNikos ? 'Nikos' : 'Maria'],
      eventDate: '',
      title: isNikos ? "Nikos's first day at school" : "Maria's first day at school",
      transcript: '',
    };
  }
  if (properties.earlier) return { momentId, earlier: 'new' };
  // the intent prompt quotes the demo phrases as examples, so only the quoted message decides
  if (properties.intent) return prompt.includes(': "can you send me the family photos?"') ? { intent: 'sendMe', momentId: 'none' } : { intent: 'find', momentId };
  if (properties.kind) return { kind: 'story', transcript: nikosStory };
  if (properties.offer) return prompt.includes('pills') ? { offer: true, who: nikos.id, time: '08:00' } : { offer: false, who: 'unknown', time: '' };
  if (properties.caption) return { caption: 'Eleni and Alexandros shared a day at the beach.' };
  return { momentId };
});

vi.mocked(model.speak).mockResolvedValue(wav);

test('the v2 demo script: Nikos joins and chooses, a share offer, his voice story, and a private reminder', async () => {
  const { store, family, transport, say, whisper, tick } = setup();
  const eleniMember = store.joinMember(family, eleni);
  eleniMember.started = true;
  const toGroup = () => transport.sent.filter(({ chatId, message }) => chatId === '-100' && !message.onlyFor);

  // beat 1: only Nikos sees the nudge, and the group sees only his question
  await say(nikos, { text: 'Anchor, can you send me the family photos?' });
  const chooseButton = { label: lines.buttons.chooseForMe, url: transport.startLink('-100') };
  expect(transport.sent).toEqual([{ chatId: '-100', messageId: 'sent-1', message: { text: lines.nudge('Nikos'), buttons: [chooseButton], onlyFor: nikos.id } }]);

  // beat 2: Start with family moments on, the voice choice that turns ✅ in place, and Done as a voice note
  await whisper(nikos, { text: '/start -100' });
  const member = family.members.find((person) => person.id === nikos.id);
  expect(member?.started).toBe(true);
  expect(transport.sent.at(-1)?.message.text).toBe(lines.welcome('Nikos'));
  const screen = transport.sent.at(-1)?.messageId ?? '';
  await whisper(nikos, { button: 'set:voice', messageId: screen });
  expect(transport.edits.map(({ messageId, change }) => [messageId, change])).toEqual([[screen, { buttons: member && choiceButtons(member) }]]);
  expect(member?.choices).toMatchObject({ moments: true, voice: true });
  await whisper(nikos, { button: 'set:done' });
  expect(transport.sent.at(-1)?.message).toMatchObject({
    text: lines.choicesSaved(['family moments', 'reminders', 'share offers', 'voice notes']),
    voice: { wav },
  });

  // beat 3: the photo gets ❤, and only Eleni sees the share offer
  await say(eleni, { text: maria, photo: { id: 'photo-maria' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  const [moment] = family.moments;
  expect(transport.reactions).toContainEqual({ chatId: '-100', messageId: moment.messageIds[0], emoji: '\u2764', big: undefined });
  const [offer] = family.offers;
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: lines.shareOffer(['Nikos']), onlyFor: eleni.id });
  await say(eleni, { button: `shr:yes:${offer.id}`, messageId: offer.messageId, ephemeral: true });
  expect(transport.edits.at(-1)).toEqual({ chatId: '-100', messageId: offer.messageId, change: { text: lines.shareSent(['Nikos']), onlyFor: eleni.id } });

  // beat 4: the photo and the memory voice note in private, his voice story, and the story in the group
  const inPrivate = transport.sent.filter(({ chatId }) => chatId === nikos.id).slice(-2).map(({ message }) => message);
  expect(inPrivate).toEqual([{ photo: { id: 'photo-maria' }, text: lines.sharedBy(moment) }, expect.objectContaining({ voice: { wav }, text: lines.remindYou })]);
  vi.mocked(model.transcribe).mockResolvedValueOnce(nikosStory);
  await whisper(nikos, { voice: { id: 'voice-nikos', mimeType: 'audio/ogg' } });
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: lines.thanks, voice: { wav } });
  await whisper(nikos, { button: `inv:share:${member?.invitation?.id}` });
  const story = toGroup().at(-2);
  expect(story?.message).toMatchObject({ text: lines.storyAdded('Nikos', 'Eleni', nikosStory), mention: eleni });
  expect(transport.reactions).toContainEqual({ chatId: '-100', messageId: story?.messageId, emoji: '\u2764', big: true });
  expect(toGroup().at(-1)?.message).toEqual({ voice: { id: 'voice-nikos', mimeType: 'audio/ogg' } });
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: lines.shared, voice: { wav } });

  // beat 5: only Nikos sees the reminder offer, and the family sees only the ✍
  const seenByGroup = toGroup().length;
  await say(eleni, { text: pills, replyTo: '1', replyToSender: nikos });
  const [reminderOffer] = family.offers;
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: lines.reminderOffer('Eleni', pills), onlyFor: nikos.id });
  await say(nikos, { button: `rem:${reminderOffer.id}:08:00`, messageId: reminderOffer.messageId, ephemeral: true });
  expect(transport.edits.at(-1)?.change).toEqual({ text: lines.reminderSet('08:00'), onlyFor: nikos.id });
  expect(transport.reactions.at(-1)).toMatchObject({ emoji: '✍' });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  expect(family.moments).toHaveLength(1);

  // beat 6: only Eleni sees the jump, and Nikos gets his reminder in private as a voice note
  await say(eleni, { text: '/fastforward 08:05', ephemeral: true });
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: expect.stringContaining('08:05'), onlyFor: eleni.id });
  await tick();
  expect(transport.sent.at(-1)).toMatchObject({ chatId: nikos.id, message: { text: lines.reminder('Eleni', pills), voice: { wav } } });
  expect(toGroup()).toHaveLength(seenByGroup);
});

test('a voice story in the group becomes a family moment with its transcript and its voice', async () => {
  const { family, say, tick } = setup();
  vi.mocked(model.transcribe).mockResolvedValueOnce(nikosFirstDay);
  await say(nikos, { voice: { id: 'voice-nikos', mimeType: 'audio/ogg' } });
  vi.setSystemTime(Date.now() + 5 * 60_000);
  await tick();
  expect(family.moments).toEqual([expect.objectContaining({ text: nikosFirstDay, voice: { id: 'voice-nikos', mimeType: 'audio/ogg' } })]);
});

test('after stop, settings and a choice tap start Nikos again, and the next share offer reaches him', async () => {
  const { store, family, transport, say, whisper, tick } = setup();
  store.joinMember(family, eleni).started = true;
  await whisper(nikos, { text: '/start -100' });
  await whisper(nikos, { text: 'stop' });
  const member = family.members.find((person) => person.id === nikos.id);
  expect(member).toMatchObject({ started: false, choices: { moments: false } });

  await whisper(nikos, { text: 'settings' });
  expect(transport.sent.at(-1)?.message.text).toBe(lines.choicesScreen);
  const screen = transport.sent.at(-1)?.messageId ?? '';
  await whisper(nikos, { button: 'set:moments', messageId: screen });
  await whisper(nikos, { button: 'set:done' });
  expect(member).toMatchObject({ started: true, choices: { moments: true } });

  await say(eleni, { text: maria, photo: { id: 'photo-maria' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  const [offer] = family.offers;
  expect(transport.sent.at(-1)?.message).toMatchObject({ text: lines.shareOffer(['Nikos']), onlyFor: eleni.id });
  await say(eleni, { button: `shr:yes:${offer.id}`, messageId: offer.messageId, ephemeral: true });
  expect(transport.sent.filter(({ chatId }) => chatId === nikos.id).at(-1)?.message.text).toBe(lines.remindYou);
});

test('v1 cues still work: then and now, a question, and the 18:00 post one week later', async () => {
  const { store, family, transport, say, tick } = setup();

  await say(eleni, { text: maria, photo: { id: 'photo-maria' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  const [first] = family.moments;
  expect(first).toMatchObject({ by: eleni, text: maria, title: "Maria's first day at school", photo: { id: 'photo-maria' } });

  // two moments of one week are no echo, so then and now needs a week between them
  await say(eleni, { text: '/fastforward 7' });
  expect(transport.sent.at(-1)?.message.text).toBe(lines.fastforwarded('2 October 2026 at 12:00'));
  await tick();

  await say(nikos, { text: nikosFirstDay, photo: { id: 'photo-1958' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  const second = family.moments[1];
  expect(second.echo).toBe(first.id);
  expect(transport.sent.at(-1)?.message).toEqual({
    album: [{ photo: { id: 'photo-1958' } }, { photo: { id: 'photo-maria' } }],
    text: lines.echoCaption(second, first),
  });

  await say(nikos, { text: 'Anchor, when did Maria start school?' });
  expect(transport.sent.at(-1)?.message).toEqual({
    photo: { id: 'photo-maria' },
    text: lines.askAnswer("Maria's first day at school", '25 September 2026', []),
    replyTo: '4',
  });

  vi.setSystemTime(Date.now() + 6 * HOUR + 60_000);
  await tick();
  expect(transport.sent.at(-1)?.message).toEqual({ photo: { id: 'photo-maria' }, text: lines.memoryCaption(lines.labels['7'], first) });
  expect(store.state.clockOffset).toBe(7 * 24 * HOUR);
});

test('on cue: /fastforward 7 then /memory posts one week ago at once, before the next 18:00', async () => {
  const { family, transport, say, tick } = setup();
  await say(eleni, { text: maria, photo: { id: 'photo-maria' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();

  await say(eleni, { text: '/fastforward 7' });
  const afterJump = transport.sent.length;
  await tick();
  expect(transport.sent).toHaveLength(afterJump);

  await say(eleni, { text: '/memory' });
  const label = lines.labels['7'];
  expect(transport.sent.at(-1)?.message).toEqual({ photo: { id: 'photo-maria' }, text: lines.memoryCaption(label, family.moments[0]) });
});

test('the stage flow: two posts, /fastforward 1, a private memory for every started member, one-tap replies, and the same memory on each jump', async () => {
  const { family, transport, say, whisper, tick } = setup();
  for (const person of [sofia, eleni, alexandros]) await whisper(person, { text: '/start -100' });
  await whisper(sofia, { button: 'set:voice', messageId: transport.sent[0].messageId });
  const toGroup = () => transport.sent.filter(({ chatId, message }) => chatId === '-100' && !message.onlyFor).map(({ message }) => message);
  const toMember = (person: Person) => transport.sent.filter(({ chatId }) => chatId === person.id);
  const invitationOf = (person: Person) => family.members.find((member) => member.id === person.id)?.invitation;

  // step 1: Eleni, then Alexandros, post a photo with a caption, and Alexandros adds a voice note before the ❤
  await say(eleni, { text: 'Sunday at the beach with the kids', photo: { id: 'photo-beach' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  vi.mocked(model.transcribe).mockResolvedValueOnce('We built it all afternoon.');
  await say(alexandros, { text: 'The sandcastle we built', photo: { id: 'photo-castle' } });
  await say(alexandros, { voice: { id: 'voice-castle', mimeType: 'audio/ogg' } });
  vi.setSystemTime(Date.now() + 2000);
  await tick();
  const [beach, castle] = family.moments;
  expect(family.moments).toHaveLength(2);
  expect(castle).toMatchObject({ by: alexandros, photo: { id: 'photo-castle' }, voice: { id: 'voice-castle', mimeType: 'audio/ogg' } });
  expect(transport.reactions.map(({ messageId, emoji }) => [messageId, emoji])).toEqual([
    [beach.messageIds[0], '\u2764'],
    [castle.messageIds[0], '\u2764'],
  ]);

  // steps 2 and 3: only Eleni sees the jump, and every started member gets the album, then one message with the three buttons
  await say(eleni, { text: '/fastforward 1', ephemeral: true });
  expect(transport.sent.at(-1)?.message).toMatchObject({ onlyFor: eleni.id });
  await tick();
  const album = {
    album: [{ photo: { id: 'photo-beach' } }, { photo: { id: 'photo-castle' } }],
    text: lines.weekMemory('Eleni and Alexandros shared a day at the beach.'),
  };
  for (const person of [sofia, eleni, alexandros]) {
    const id = invitationOf(person)?.id;
    const buttons = [
      { label: 'Tell me more', data: `inv:more:${id}` },
      { label: 'Reply to the family', data: `inv:reply:${id}` },
      { label: 'Later, please', data: `inv:later:${id}` },
    ];
    expect(toMember(person).slice(-2).map(({ message }) => message)).toEqual([album, expect.objectContaining({ text: lines.remindYou, buttons })]);
  }
  expect(toMember(sofia).at(-1)?.message.voice).toEqual({ wav });
  expect(toGroup()).toEqual([]);

  // step 4: the buttons of the same message change at once to the three replies
  const id = invitationOf(sofia)?.id;
  const memory = toMember(sofia).at(-1)?.messageId ?? '';
  await whisper(sofia, { button: `inv:reply:${id}`, messageId: memory });
  expect(transport.edits.at(-1)).toEqual({
    chatId: sofia.id,
    messageId: memory,
    change: { buttons: ['❤️ Sending my love', '😊 That made me smile', '💛 I miss you all'].map((label, index) => ({ label, data: `inv:say${index}:${id}` })) },
  });

  // step 5: the reply goes to the group as a reply to Eleni's post, and the buttons collapse
  await whisper(sofia, { button: `inv:say2:${id}`, messageId: memory });
  expect(transport.edits.at(-1)).toEqual({ chatId: sofia.id, messageId: memory, change: { buttons: [{ label: '✅ Sent to the family', data: `inv:done:${id}` }] } });
  expect(toGroup()).toEqual([{ text: 'Sofia: «I miss you all 💛»', replyTo: beach.messageIds[0] }]);

  // steps 6 and 7: one voice note asks about a call, and "Yes, ask Eleni" asks Eleni in the group with a mention
  const question = toMember(sofia).at(-1);
  expect(question?.message).toEqual({
    text: 'Shall I ask Eleni to call you?',
    buttons: [
      { label: 'Yes, ask Eleni', data: `inv:call:${id}` },
      { label: 'No, thanks', data: `inv:nocall:${id}` },
    ],
    voice: { wav },
  });
  await whisper(sofia, { button: `inv:call:${id}`, messageId: question?.messageId });
  expect(transport.edits.at(-1)?.change).toEqual({ buttons: [{ label: '✅ Asked Eleni to call you', data: `inv:done:${id}` }] });
  expect(toGroup().at(-1)).toEqual({ text: 'Eleni, Sofia would love a call from you 💛', mention: eleni });

  // two more jumps with no new post: every member gets the memory again, and no echo and no group memory posts
  const posted = toGroup().length;
  for (let jump = 2; jump <= 3; jump++) {
    const before = transport.sent.length;
    await say(eleni, { text: '/fastforward 1', ephemeral: true });
    await tick();
    const sent = transport.sent.slice(before).filter(({ chatId }) => chatId !== '-100');
    for (const person of [sofia, eleni, alexandros]) {
      expect(sent.filter(({ chatId }) => chatId === person.id).map(({ message }) => message.album ?? message.text)).toEqual([album.album, lines.remindYou]);
    }
  }
  expect(toGroup()).toHaveLength(posted);
});
