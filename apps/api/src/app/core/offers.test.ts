import { Logger } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { FADE_MS, closeOffer, fadeOffers, findOffer, sendOffer } from './offers';
import { openStore } from './store';
import { FakeTransport } from './fake-transport';
import type { Context, Family, Member, Offer, Outgoing } from './types';

function setup() {
  const transport = new FakeTransport();
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'anchor-offers-')), 'state.json'));
  const family = store.addFamily('-100', '-100');
  const member = store.joinMember(family, { id: '42', name: 'Nikos' });
  let now = 1_000_000;
  const ctx: Context = { now: () => now, store, transport: () => transport };
  return { transport, store, family, member, ctx, at: (time: number) => (now = time) };
}

async function send(
  family: Family,
  kind: Offer['kind'],
  to: Member,
  ref: string,
  message: (id: string) => Outgoing,
  ctx: Context,
): Promise<Offer> {
  const offer = await sendOffer(family, kind, to, ref, message, ctx);
  if (!offer) throw new Error('expected sendOffer to record an offer');
  return offer;
}

test('sendOffer sends the message onlyFor the member, records the offer, and saves', async () => {
  const { transport, store, family, member, ctx } = setup();
  const offer = await sendOffer(family, 'share', member, 'm1', () => ({ text: 'Shall I send this?' }), ctx);
  expect(offer).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), kind: 'share', to: '42', messageId: 'sent-1', at: 1_000_000, ref: 'm1' });
  expect(transport.sent).toEqual([{ chatId: '-100', messageId: 'sent-1', message: { text: 'Shall I send this?', onlyFor: '42' } }]);
  expect(family.offers).toEqual([offer]);
  expect(store.family('-100')?.offers).toEqual([offer]);
});

test('sendOffer builds the id before the send, so a button in the message can carry it', async () => {
  const { transport, family, member, ctx } = setup();
  const offer = await send(
    family,
    'share',
    member,
    'm1',
    (id) => ({ text: 'Shall I send this?', buttons: [{ label: 'Yes, send it', data: `shr:${id}:yes` }] }),
    ctx,
  );
  expect(transport.sent[0].message.buttons).toEqual([{ label: 'Yes, send it', data: `shr:${offer.id}:yes` }]);
});

test('a failed send logs and records nothing', async () => {
  const { transport, family, member, ctx } = setup();
  vi.spyOn(transport, 'send').mockRejectedValue(new Error('down'));
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const offer = await sendOffer(family, 'reminder', member, 'r1', () => ({ text: 'Shall I remind you?' }), ctx);
  expect(offer).toBeUndefined();
  expect(family.offers).toEqual([]);
  expect(warn).toHaveBeenCalled();
});

test('findOffer finds an offer by id, and returns undefined otherwise', async () => {
  const { family, member, ctx } = setup();
  const offer = await send(family, 'share', member, 'm1', () => ({ text: 'hi' }), ctx);
  expect(findOffer(family, offer.id)).toBe(offer);
  expect(findOffer(family, 'missing')).toBeUndefined();
});

test('closeOffer edits the offer onlyFor the member when given a change, and drops the record', async () => {
  const { transport, family, member, ctx } = setup();
  const offer = await send(family, 'share', member, 'm1', () => ({ text: 'hi' }), ctx);
  await closeOffer(family, offer, ctx, { text: 'Sent 💛' });
  expect(transport.edits).toEqual([{ chatId: '-100', messageId: 'sent-1', change: { text: 'Sent 💛', onlyFor: '42' } }]);
  expect(family.offers).toEqual([]);
});

test('closeOffer removes the offer onlyFor the member with no change, and drops the record', async () => {
  const { transport, family, member, ctx } = setup();
  const offer = await send(family, 'share', member, 'm1', () => ({ text: 'hi' }), ctx);
  await closeOffer(family, offer, ctx);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: 'sent-1', onlyFor: '42' }]);
  expect(family.offers).toEqual([]);
});

test('closeOffer still drops the record when the edit or the remove fails', async () => {
  const { transport, family, member, ctx } = setup();
  const offer = await send(family, 'share', member, 'm1', () => ({ text: 'hi' }), ctx);
  vi.spyOn(transport, 'remove').mockRejectedValue(new Error('gone'));
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  await closeOffer(family, offer, ctx);
  expect(family.offers).toEqual([]);
  expect(warn).toHaveBeenCalled();
});

test('fadeOffers removes every offer of the kind that is at least FADE_MS old, saves once, and returns the faded offers', async () => {
  const { transport, family, member, ctx, at } = setup();
  const stale = await send(family, 'share', member, 'm2', () => ({ text: 'stale' }), ctx);
  const otherKind = await send(family, 'reminder', member, 'r1', () => ({ text: 'reminder' }), ctx);
  at(1_000_000 + FADE_MS - 1000);
  const fresh = await send(family, 'share', member, 'm1', () => ({ text: 'fresh' }), ctx);

  const faded = await fadeOffers(family, 'share', 1_000_000 + FADE_MS, ctx);
  expect(faded).toEqual([stale]);
  expect(transport.removed).toEqual([{ chatId: '-100', messageId: stale.messageId, onlyFor: '42' }]);
  expect(family.offers).toEqual([otherKind, fresh]);
});

test('fadeOffers removes an offer from a jumped day after /fastforward now, because it would never reach FADE_MS', async () => {
  const { family, member, ctx, at } = setup();
  at(1_000_000 + 3 * 86_400_000);
  const future = await send(family, 'share', member, 'm1', () => ({ text: 'from a jumped day' }), ctx);
  expect(await fadeOffers(family, 'share', 1_000_000, ctx)).toEqual([future]);
});

test('fadeOffers does nothing, and saves nothing extra, when no offer of the kind has faded', async () => {
  const { family, member, ctx } = setup();
  await sendOffer(family, 'share', member, 'm1', () => ({ text: 'fresh' }), ctx);
  const faded = await fadeOffers(family, 'share', 1_000_000, ctx);
  expect(faded).toEqual([]);
  expect(family.offers).toHaveLength(1);
});

test('closing an offer that already faded leaves every other offer alone', async () => {
  const { family, member, ctx, at } = setup();
  const faded = await send(family, 'share', member, 'm1', () => ({ text: 'Shall I send this?' }), ctx);
  at(1_000_000 + FADE_MS);
  const reminder = await send(family, 'reminder', member, 'r1', () => ({ text: 'Shall I remind you?' }), ctx);
  await fadeOffers(family, 'share', 1_000_000 + FADE_MS, ctx);
  await closeOffer(family, faded, ctx, { text: 'Sent' });
  expect(family.offers).toEqual([reminder]);
});

test('an offer that closes while its fade awaits the transport leaves every other offer alone', async () => {
  const { transport, family, member, ctx, at } = setup();
  const faded = await send(family, 'share', member, 'm1', () => ({ text: 'Shall I send this?' }), ctx);
  at(1_000_000 + FADE_MS);
  const reminder = await send(family, 'reminder', member, 'r1', () => ({ text: 'Shall I remind you?' }), ctx);
  vi.spyOn(transport, 'remove').mockImplementationOnce(() => closeOffer(family, faded, ctx, { text: 'Sent' }));
  await fadeOffers(family, 'share', 1_000_000 + FADE_MS, ctx);
  expect(family.offers).toEqual([reminder]);
});
