import { Logger } from '@nestjs/common';
import { WEEK_MS } from '../core/clock';
import { cut, dateOf, lines } from '../core/lines';
import type { Context, Family, Feature, Moment } from '../core/types';
import { ask, valid } from '../model/model';
import { pictureOf } from './capture/filter';

const logger = new Logger('Echoes');

type Answer = { momentId: string; earlier: string };

function thenNow(newMoment: Moment, matchMoment: Moment, earlier: string) {
  if (newMoment.eventDate && matchMoment.eventDate && newMoment.eventDate !== matchMoment.eventDate) {
    return newMoment.eventDate < matchMoment.eventDate ? [newMoment, matchMoment] : [matchMoment, newMoment];
  }
  return earlier === 'new' ? [newMoment, matchMoment] : [matchMoment, newMoment];
}

async function checkOne(family: Family, momentId: string, ctx: Context) {
  const moment = family.moments.find((item) => item.id === momentId);
  if (!moment || moment.sensitive || moment.echo) return;
  // ponytail: every older moment of another sender is a candidate; cap to recent ones when a record reaches thousands of moments
  // ponytail: the spike of 2026-09-26, decision 9, skips a candidate saved in the last 7 days, so two stage photos never post an unplanned album;
  // the model's eventDate would let an old photo echo a moment of the same week, at the cost of that stage safety
  const candidates = family.moments.filter((other) => other.savedAt <= moment.savedAt - WEEK_MS && other.by.id !== moment.by.id && !other.sensitive);
  if (!candidates.length) return;
  const candidateIds = candidates.map((candidate) => candidate.id);
  const prompt = [
    "Anchor keeps this family's shared record of moments. An echo is the same kind of life event across the family, " +
      'for example two first days at school or two weddings.',
    `New moment "${moment.title}": ${moment.text} — people: ${moment.people.join(', ') || 'none'} — ${dateOf(moment)}`,
    'Earlier moments in the record:',
    ...candidates.map((candidate) => {
      const people = candidate.people.join(', ') || 'none';
      return `${candidate.id}: "${candidate.title}" — by ${candidate.by.name} — people: ${people} — ${dateOf(candidate)}`;
    }),
    'Does the new moment echo one of the earlier moments, the same kind of life event? Answer momentId with its id, or "none". ' +
      'Answer earlier with which life event happened first, "new" or "match".',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      momentId: { type: 'string', enum: [...candidateIds, 'none'] },
      earlier: { type: 'string', enum: ['new', 'match'] },
    },
    required: ['momentId', 'earlier'],
  };
  let answer: Answer | null;
  try {
    answer = await ask<Answer | null>(prompt, schema);
  } catch (error) {
    logger.warn(`echo match failed: ${error}`);
    return;
  }
  const matchId = valid.oneOf(answer?.momentId, candidateIds);
  if (!matchId) return;
  const earlier = valid.oneOf(answer?.earlier, ['new', 'match']) ?? 'match';

  const newMoment = family.moments.find((item) => item.id === momentId);
  const matchMoment = family.moments.find((item) => item.id === matchId);
  if (!newMoment || newMoment.sensitive || newMoment.echo) return;
  if (!matchMoment || matchMoment.sensitive) return;

  newMoment.echo = matchMoment.id;
  ctx.store.save();

  const [then, now] = thenNow(newMoment, matchMoment, earlier);
  const caption = cut(lines.echoCaption(then, now), 1024);
  const pictures = [pictureOf(then), pictureOf(now)].filter((picture) => picture !== undefined);
  const message =
    pictures.length === 2
      ? { album: pictures, text: caption }
      : pictures.length === 1
        ? { ...pictures[0], text: caption }
        : { text: caption };
  const sent = await ctx.transport(family.id).send(family.chatId, message);
  newMoment.echoPostIds = sent.messageIds ?? [sent.messageId];
  ctx.store.save();
}

export const echoes: Feature = {
  name: 'echoes',
  async tick(family, window, ctx) {
    const news = family.moments
      .filter((moment) => moment.savedAt > window.from && moment.savedAt <= window.to && !moment.sensitive && !moment.echo)
      .sort((a, b) => a.savedAt - b.savedAt)
      .map((moment) => moment.id);
    for (const momentId of news) {
      try {
        await checkOne(family, momentId, ctx);
      } catch (error) {
        logger.warn(`echo check failed: ${error}`);
      }
    }
  },
};
