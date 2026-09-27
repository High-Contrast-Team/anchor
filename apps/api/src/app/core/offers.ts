import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Button, Context, Family, Member, Offer, Outgoing } from './types';

const logger = new Logger('Offers');

// v2, sections 4.12 and 4.13: an unanswered offer fades after this long
export const FADE_MS = 10 * 60_000;

// 8 characters, so the id fits in button data and a start payload
export const shortId = () => randomUUID().replace(/-/g, '').slice(0, 8);

export async function sendOffer(
  family: Family,
  kind: Offer['kind'],
  to: Member,
  ref: string,
  message: (id: string) => Outgoing,
  ctx: Context,
): Promise<Offer | undefined> {
  const id = shortId();
  try {
    const sent = await ctx.transport(family.id).send(family.chatId, { ...message(id), onlyFor: to.id });
    const offer: Offer = { id, kind, to: to.id, messageId: sent.messageId, at: ctx.now(), ref };
    family.offers.push(offer);
    ctx.store.save();
    return offer;
  } catch (error) {
    logger.warn(`The ${kind} offer to ${to.id} failed: ${error}`);
    return undefined;
  }
}

// a close and a fade can race over one offer, and a splice at index -1 would drop the last offer instead
function drop(family: Family, offer: Offer) {
  const index = family.offers.indexOf(offer);
  if (index >= 0) family.offers.splice(index, 1);
}

export function findOffer(family: Family, id: string): Offer | undefined {
  return family.offers.find((offer) => offer.id === id);
}

// keeps the record, so the offer can still fade
export async function editOffer(family: Family, offer: Offer, change: { text?: string; buttons?: Button[] }, ctx: Context): Promise<void> {
  try {
    await ctx.transport(family.id).edit(family.chatId, offer.messageId, { ...change, onlyFor: offer.to });
  } catch (error) {
    logger.warn(`Editing the ${offer.kind} offer ${offer.id} failed: ${error}`);
  }
}

export async function closeOffer(family: Family, offer: Offer, ctx: Context, change?: { text?: string; buttons?: Button[] }): Promise<void> {
  if (change) {
    await editOffer(family, offer, change, ctx);
  } else {
    try {
      await ctx.transport(family.id).remove(family.chatId, offer.messageId, offer.to);
    } catch (error) {
      logger.warn(`Closing the ${offer.kind} offer ${offer.id} failed: ${error}`);
    }
  }
  drop(family, offer);
  ctx.store.save();
}

export async function fadeOffers(family: Family, kind: Offer['kind'], now: number, ctx: Context): Promise<Offer[]> {
  // an offer from a day that /fastforward now undid lies in the future, so it fades at once instead of never
  const faded = family.offers.filter((offer) => offer.kind === kind && (now - offer.at >= FADE_MS || offer.at > now));
  if (!faded.length) return faded;
  const transport = ctx.transport(family.id);
  for (const offer of faded) {
    try {
      await transport.remove(family.chatId, offer.messageId, offer.to);
    } catch (error) {
      logger.warn(`Fading the ${kind} offer ${offer.id} failed: ${error}`);
    }
    drop(family, offer);
  }
  ctx.store.save();
  return faded;
}
