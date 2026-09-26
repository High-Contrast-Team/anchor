import type { Family, Incoming, Media, Moment, Person } from '../../core/types';

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

export function wordCount(text: string | undefined): number {
  return (text ?? '').replace(LINK, ' ').split(/\s+/).filter(Boolean).length;
}

export const BUNDLE_GAP_MS = 5 * 60_000;
export const ALBUM_GRACE_MS = 3000; // Telegram delivers album items one update apart, and `at` has 1 s resolution

export type Bundle = {
  family: Family; // a reference, so the bundle still matches after a migration changes family.id
  sender: Person;
  events: Incoming[];
  closing?: Promise<void>; // the classification runs
  sensitive?: boolean; // a keep-quiet arrived before the bundle closed (R5)
  sealed?: boolean; // a newer picture from the sender started its own bundle
};

export const hasPicture = (event: Incoming) => Boolean(event.photo || event.video);

// "Anchor, ..." or a mention of the live or the dev bot, such as "@anchor_family_bot , ..."
export const ADDRESS = /^(?:anchor|@anchor\w*)\b\s*[,:]?\s+/i;

// v2: these phrases decide an intent in code, before any model call, so the demo phrases never depend on the model
const FIXED = /^(?:(?:can|could|would|will) you |please )?(send me|another moment|my settings|settings|call me|what did i miss)\b/i;
const FIXED_INTENTS = {
  'send me': 'sendMe',
  'another moment': 'sendMe',
  'my settings': 'settings',
  settings: 'settings',
  'call me': 'callMe',
  'what did i miss': 'missed',
} as const;

export function fixedIntent(text: string | undefined): (typeof FIXED_INTENTS)[keyof typeof FIXED_INTENTS] | 'stop' | undefined {
  const phrase = text?.trim() ?? '';
  if (/^stop[.!]?$/i.test(phrase)) return 'stop';
  const match = FIXED.exec(phrase)?.[1].toLowerCase() as keyof typeof FIXED_INTENTS | undefined;
  return match ? FIXED_INTENTS[match] : undefined;
}

// in private, "birthdays" and "settings" anywhere in the text decide the intent in code, so neither a talk nor an open invitation swallows them
const BIRTHDAYS = /\bbirthdays\b/i;
const SETTINGS = /\b(?:settings|preferences|choices)\b/i;

export function privateIntent(text: string | undefined): ReturnType<typeof fixedIntent> | 'birthdays' {
  if (BIRTHDAYS.test(text ?? '')) return 'birthdays';
  if (SETTINGS.test(text ?? '')) return 'settings';
  return fixedIntent(text);
}

// "a memory of Lucy", "more photos?", or "remind me about my pills" asks Anchor for something, so an open invitation never reads it as a story
const REQUEST =
  /^(?:(?:can|could|would|will) you |please )?(?:(?:show|send|give) (?:me|us) )?(?:(?:a|an|another|some|more|other) )?(?:memor(?:y|ies)|photos?|pictures?|pics|moments?)(?:\s+(?:of|about|with|from)\b|[?.!]?$)|^(?:please )?remind me (?:to|about)\b/i;

export const asksAnchor = (text: string | undefined) => wordCount(text) <= 6 && REQUEST.test(text?.trim() ?? '');

export const isCommand = (text: string | undefined, command: string) => text === command || !!text?.startsWith(`${command} `);

export function pictureOf(moment: Moment): { photo: Media } | { video: Media } | undefined {
  return moment.video ? { video: moment.video } : moment.photo ? { photo: moment.photo } : undefined;
}

export function passesRules(event: Incoming): boolean {
  if (event.unsupported || event.forwarded) return false;
  if (event.button !== undefined || event.joined || event.migratedTo !== undefined) return false;
  if (event.text?.startsWith('/')) return false;
  return hasPicture(event) || Boolean(event.voice) || wordCount(event.text) > 0;
}

export function isClosed(bundle: Bundle, realNow: number): boolean {
  if (bundle.sealed) return true;
  const last = bundle.events[bundle.events.length - 1];
  if (realNow - last.at >= BUNDLE_GAP_MS) return true;
  if (last.albumId !== undefined && realNow - last.at < ALBUM_GRACE_MS) return false;
  // a voice note without a picture closes at once, so its ❤ lands within seconds; a later picture starts its own bundle
  if (bundle.events.some((event) => event.voice)) return true;
  return bundle.events.some(hasPicture) && bundle.events.some((event) => wordCount(event.text) > 0);
}

export function worthClassifying(bundle: Bundle): boolean {
  const hasVoice = bundle.events.some((event) => event.voice);
  const words = bundle.events.reduce((total, event) => total + wordCount(event.text), 0);
  if (!bundle.events.some(hasPicture) && !hasVoice && words < 3) return false;
  const showsPicture = bundle.events.some((event) => event.photo || (event.video && event.thumbnail));
  return showsPicture || hasVoice || words > 0;
}

export function typedText(bundle: Bundle): string {
  return bundle.events
    .map((event) => event.text)
    .filter((text): text is string => Boolean(text))
    .join('\n');
}
