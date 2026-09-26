import type { State, Window } from './types';

export const WEEK_MS = 7 * 86_400_000;

export function demoNow({ clockStart, clockOffset }: Pick<State, 'clockStart' | 'clockOffset'>, daySeconds: number, realNow = Date.now()): number {
  return Math.round(clockStart + ((realNow - clockStart) * 86400) / daySeconds + clockOffset);
}

export function dayIndex(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/** The latest local `hour:00` in `(from, to]`, so back-to-back windows fire each slot once. */
export function slotIn(window: Window, hour: number): number | undefined {
  const slot = new Date(window.to);
  slot.setHours(hour, 0, 0, 0);
  if (slot.getTime() > window.to) slot.setDate(slot.getDate() - 1);
  return slot.getTime() > window.from ? slot.getTime() : undefined;
}
