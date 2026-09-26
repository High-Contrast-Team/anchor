import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Choices, Family, Member, State, Store } from './types';

const logger = new Logger('Store');

// v2, section 4.11: the choices of a new member
const DEFAULT_CHOICES: Choices = { moments: true, reminders: true, shares: true, voice: false, call: false };

// ponytail: each save rewrites the whole record; move to SQLite when a save gets slow or a second process writes
export function openStore(file: string, realNow = Date.now()): Store {
  const state = load(file) ?? { clockStart: realNow, clockOffset: 0, families: [] };
  const store: Store = {
    state,
    family: (id) => state.families.find((family) => family.id === id),
    addFamily(id, chatId) {
      const family: Family = { id, chatId, members: [], moments: [], offers: [], reminders: [], counters: {} };
      state.families.push(family);
      return family;
    },
    familyOfMember: (userId) =>
      state.families.find((family) => family.members.some((person) => person.id === userId)),
    joinMember(family, person) {
      const existing = family.members.find((member) => member.id === person.id);
      // a member can rename the account, and every line reads member.name
      if (existing && person.name && existing.name !== person.name) {
        existing.name = person.name;
        store.save();
      }
      if (existing) return existing;
      const member: Member = { id: person.id, name: person.name, started: false, choices: { ...DEFAULT_CHOICES } };
      family.members.push(member);
      return member;
    },
    save() {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(state));
      renameSync(`${file}.tmp`, file);
    },
  };
  if (!existsSync(file)) store.save();
  return store;
}

function load(file: string): State | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  try {
    const state = JSON.parse(text) as State;
    if (typeof state.clockStart === 'number' && Array.isArray(state.families)) {
      return { ...state, clockOffset: state.clockOffset ?? 0, families: state.families.map(withDefaults) };
    }
    throw new Error('not a State');
  } catch (error) {
    const aside = `${file}.corrupt-${Date.now()}`;
    renameSync(file, aside);
    logger.warn(`${file} is unreadable (${error}), moved it to ${aside} and started empty`);
    return undefined;
  }
}

// v2: an old file has storytellers instead of members, and no choices, offers, or reminders; this fills the v2 defaults, so no migration runs
function withDefaults(family: Family & { storytellers?: Member[] }): Family {
  const { storytellers, ...record } = family;
  const members = (record.members ?? storytellers ?? []).map((member) =>
    member.choices ? member : { ...member, choices: { ...DEFAULT_CHOICES, moments: member.started } },
  );
  return { ...record, members, offers: record.offers ?? [], reminders: record.reminders ?? [] };
}
