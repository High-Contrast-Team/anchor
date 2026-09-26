import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';
import { FakeTransport } from './core/fake-transport';
import { lines } from './core/lines';
import { openStore } from './core/store';
import type { Context, Family, Moment, Person } from './core/types';
import { httpFetch, type HttpResponse } from './http';
import { deleteMyData, join, media, me, moments, myData, verifyIdToken } from './web';

vi.mock('./http', () => ({ httpFetch: vi.fn() }));
const fetchMock = vi.mocked(httpFetch);

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'oidc-1', alg: 'RS256' }] };
fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => jwks } as HttpResponse);

const BOT_ID = '8123456789';
const ADD_LINK = 'https://t.me/anchor_test_bot?startgroup&admin=delete_messages';
const sofia: Person = { id: '111', name: 'Sofia' };
const nikos: Person = { id: '222', name: 'Nikos' };

const idToken = (claims: object, options: jwt.SignOptions = {}) =>
  jwt.sign({ id: 111, given_name: 'Sofia', name: 'Sofia Pappas', ...claims }, privateKey, {
    algorithm: 'RS256',
    keyid: 'oidc-1',
    issuer: 'https://oauth.telegram.org',
    audience: BOT_ID,
    expiresIn: 3600,
    ...options,
  });

let transport: FakeTransport;
let ctx: Context;
let family: Family;

const moment = (id: string, by: Person, extra: Partial<Moment> = {}): Moment => ({
  id,
  by,
  messageIds: [`msg-${id}`],
  savedAt: Date.UTC(2026, 8, 20),
  text: `words of ${id}`,
  salience: 3,
  sensitive: false,
  people: [],
  title: `title of ${id}`,
  stories: [],
  lookbacks: [],
  memoryPostIds: [],
  returns: {},
  ...extra,
});

beforeEach(() => {
  transport = new FakeTransport();
  const store = openStore(joinPath(mkdtempSync(joinPath(tmpdir(), 'anchor-web-')), 'state.json'));
  ctx = { now: () => Date.now(), store, transport: () => transport };
  family = store.addFamily('-100', '-100');
});

test('a Telegram id_token gives the person, and a wrong or missing token gives 401', async () => {
  expect(await verifyIdToken(`Bearer ${idToken({})}`, BOT_ID)).toEqual(sofia);
  expect(await verifyIdToken(`Bearer ${idToken({ given_name: undefined })}`, BOT_ID)).toEqual({ id: '111', name: 'Sofia Pappas' });
  await expect(verifyIdToken(undefined, BOT_ID)).rejects.toThrow(UnauthorizedException);
  await expect(verifyIdToken(`Bearer ${idToken({}, { audience: '999' })}`, BOT_ID)).rejects.toThrow(UnauthorizedException);
  await expect(verifyIdToken(`Bearer ${idToken({}, { issuer: 'https://evil.example' })}`, BOT_ID)).rejects.toThrow(UnauthorizedException);
  await expect(verifyIdToken(`Bearer ${idToken({}, { expiresIn: -10 })}`, BOT_ID)).rejects.toThrow(UnauthorizedException);
  const forged = jwt.sign({ id: 111 }, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, { algorithm: 'RS256', keyid: 'oidc-1', issuer: 'https://oauth.telegram.org', audience: BOT_ID });
  await expect(verifyIdToken(`Bearer ${forged}`, BOT_ID)).rejects.toThrow(UnauthorizedException);
});

test('join adds a person in the group, sends the choices once, and gives the add link to a person in no group', async () => {
  ctx.store.joinMember(family, nikos);

  expect(await join(sofia, ctx, ADD_LINK)).toEqual({ status: 'joined', family: { members: [nikos, sofia] } });
  expect(family.members.find((member) => member.id === sofia.id)?.started).toBe(true);
  expect(transport.sent).toHaveLength(1);
  expect(transport.sent[0]).toMatchObject({ chatId: sofia.id, message: { text: lines.welcome('Sofia') } });

  await join(sofia, ctx, ADD_LINK);
  expect(transport.sent).toHaveLength(1);

  transport.outsiders.add('333');
  expect(await join({ id: '333', name: 'Eleni' }, ctx, ADD_LINK)).toEqual({ status: 'no-family', addLink: ADD_LINK });
});

test('the family view hides sensitive moments, lists the newest first, and closes to a person who left the group', async () => {
  ctx.store.joinMember(family, sofia);
  ctx.store.joinMember(family, nikos);
  const story = { id: 's1', by: nikos, at: Date.UTC(2026, 8, 21), text: 'I remember that day', messageIds: [] };
  family.moments.push(
    moment('m1', sofia, { photo: { id: 'p1', mimeType: 'image/jpeg' }, eventDate: '2026-09-01', stories: [story] }),
    moment('m2', nikos, { savedAt: Date.UTC(2026, 8, 22), voice: { id: 'v2', mimeType: 'audio/ogg' } }),
    moment('m3', nikos, { sensitive: true, photo: { id: 'p3' } }),
  );
  transport.files.set('p1', { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' });

  expect(await me(sofia, ctx)).toEqual({ member: sofia, family: { members: [sofia, nikos] } });
  expect(await moments(sofia, ctx)).toEqual([
    { id: 'm2', by: nikos, savedAt: '2026-09-22T00:00:00.000Z', title: 'title of m2', text: 'words of m2', hasPhoto: false, hasVoice: true, stories: [] },
    {
      id: 'm1',
      by: sofia,
      savedAt: '2026-09-20T00:00:00.000Z',
      title: 'title of m1',
      text: 'words of m1',
      eventDate: '2026-09-01',
      hasPhoto: true,
      hasVoice: false,
      stories: [{ id: 's1', by: nikos, at: '2026-09-21T00:00:00.000Z', text: 'I remember that day', hasVoice: false }],
    },
  ]);
  expect(await media(sofia, ctx, 'm1', 'photo')).toEqual({ data: Buffer.from('jpeg'), mimeType: 'image/jpeg' });
  await expect(media(sofia, ctx, 'm3', 'photo')).rejects.toThrow(NotFoundException);
  await expect(media(sofia, ctx, 'm1', 'voice')).rejects.toThrow(NotFoundException);

  const other = ctx.store.addFamily('-200', '-200');
  const leftFirst = (chatId: string, userId: string) => Promise.resolve(!(chatId === '-100' && userId === sofia.id));
  transport.isMember = leftFirst;
  expect(await join(sofia, ctx, ADD_LINK)).toEqual({ status: 'joined', family: { members: [sofia] } });
  expect(await me(sofia, ctx)).toEqual({ member: sofia, family: { members: [sofia] } });
  expect(await moments(sofia, ctx)).toEqual([]);

  other.members = [];
  await expect(moments(sofia, ctx)).rejects.toThrow(ForbiddenException);
  await expect(media(sofia, ctx, 'm1', 'photo')).rejects.toThrow(ForbiddenException);
  await expect(me({ id: '333', name: 'Eleni' }, ctx)).rejects.toThrow(ForbiddenException);
});

test('my data exports what the person shared, sensitive included, and delete removes it and the person', () => {
  ctx.store.joinMember(family, sofia);
  ctx.store.joinMember(family, nikos);
  const mine = { id: 's1', by: sofia, at: 1, text: 'my story', messageIds: [] };
  const theirs = { id: 's2', by: nikos, at: 2, text: 'his story', messageIds: [] };
  family.moments.push(
    moment('m1', sofia, { sensitive: true }),
    moment('m2', nikos, { stories: [mine, theirs], returns: { [sofia.id]: { count: 1 }, [nikos.id]: { count: 1 } } }),
  );
  family.reminders.push({ id: 'r1', to: sofia.id, from: nikos, text: 'pills at 8', sourceId: 'g1', time: '08:00', status: 'set' });
  family.offers.push({ id: 'o1', kind: 'share', to: sofia.id, messageId: 'e1', at: 0, ref: 'm2' });
  family.chat = [
    { id: 'g1', by: 'Sofia', text: 'good morning', at: 1 },
    { id: 'g2', by: 'Nikos', text: 'hello', at: 2 },
  ];

  const other = ctx.store.addFamily('-200', '-200');
  ctx.store.joinMember(other, sofia);
  other.moments.push(moment('m9', sofia));

  const [exported, second] = myData(sofia, ctx).families;
  expect(exported.member).toMatchObject(sofia);
  expect(exported.moments.map((item) => item.id)).toEqual(['m1']);
  expect(exported.stories).toEqual([{ momentId: 'm2', ...mine }]);
  expect(exported.reminders.map((item) => item.id)).toEqual(['r1']);
  expect(second.moments.map((item) => item.id)).toEqual(['m9']);

  deleteMyData(sofia, ctx);
  expect(other.members).toEqual([]);
  expect(other.moments).toEqual([]);
  expect(family.members.map((member) => member.id)).toEqual([nikos.id]);
  expect(family.moments.map((item) => item.id)).toEqual(['m2']);
  expect(family.moments[0].stories).toEqual([theirs]);
  expect(Object.keys(family.moments[0].returns)).toEqual([nikos.id]);
  expect(family.reminders).toEqual([]);
  expect(family.offers).toEqual([]);
  expect(family.chat).toEqual([{ id: 'g2', by: 'Nikos', text: 'hello', at: 2 }]);
  expect(() => myData(sofia, ctx)).toThrow(ForbiddenException);
});
