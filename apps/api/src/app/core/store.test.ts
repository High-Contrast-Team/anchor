import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openStore } from './store';
import type { Choices } from './types';

const stateFile = () => join(mkdtempSync(join(tmpdir(), 'anchor-store-')), 'state.json');
const DEFAULT_CHOICES: Choices = { moments: true, reminders: true, shares: true, voice: false, call: false };

test('the first boot sets clockStart once, and a restart keeps it', () => {
  const file = stateFile();
  expect(openStore(file, 1000).state).toEqual({ clockStart: 1000, clockOffset: 0, families: [] });
  expect(openStore(file, 5000).state.clockStart).toBe(1000);
});

test('a saved family survives a restart', () => {
  const file = stateFile();
  const store = openStore(file, 1000);
  const family = store.addFamily('-100', '-100');
  store.joinMember(family, { id: '42', name: 'Nikos' }).started = true;
  family.counters.rules = 2;
  store.save();

  const reopened = openStore(file, 5000);
  expect(reopened.family('-100')).toEqual({
    id: '-100',
    chatId: '-100',
    members: [{ id: '42', name: 'Nikos', started: true, choices: DEFAULT_CHOICES }],
    moments: [],
    offers: [],
    reminders: [],
    counters: { rules: 2 },
  });
  expect(reopened.familyOfMember('42')?.id).toBe('-100');
  expect(reopened.familyOfMember('7')).toBeUndefined();
  expect(reopened.family('-200')).toBeUndefined();
});

test('joinMember adds a member with the default choices, and returns the existing member on a second join', () => {
  const store = openStore(stateFile(), 1000);
  const family = store.addFamily('-100', '-100');
  const member = store.joinMember(family, { id: '42', name: 'Nikos' });
  expect(member).toEqual({ id: '42', name: 'Nikos', started: false, choices: DEFAULT_CHOICES });
  expect(family.members).toEqual([member]);

  const again = store.joinMember(family, { id: '42', name: 'Nikos' });
  expect(again).toBe(member);
  expect(family.members).toHaveLength(1);
});

test('joinMember takes the new name of a member who renamed the account, and saves it', () => {
  const file = stateFile();
  const store = openStore(file, 1000);
  const family = store.addFamily('-100', '-100');
  const member = store.joinMember(family, { id: '42', name: 'Nikos' });
  store.save();
  expect(store.joinMember(family, { id: '42', name: 'Sofia' })).toBe(member);
  expect(member.name).toBe('Sofia');
  expect(openStore(file, 1000).family('-100')?.members[0].name).toBe('Sofia');
});

test('a v1-shaped file loads with the v2 defaults, and no migration runs', () => {
  const file = stateFile();
  writeFileSync(
    file,
    JSON.stringify({
      clockStart: 1000,
      clockOffset: 0,
      families: [
        {
          id: '-100',
          chatId: '-100',
          storytellers: [
            { id: '42', name: 'Nikos', started: true },
            { id: '43', name: 'Eleni', started: false },
          ],
          moments: [],
          counters: {},
        },
      ],
    }),
  );

  const store = openStore(file, 5000);
  expect(store.family('-100')).toEqual({
    id: '-100',
    chatId: '-100',
    members: [
      { id: '42', name: 'Nikos', started: true, choices: { ...DEFAULT_CHOICES, moments: true } },
      { id: '43', name: 'Eleni', started: false, choices: { ...DEFAULT_CHOICES, moments: false } },
    ],
    moments: [],
    offers: [],
    reminders: [],
    counters: {},
  });
});

test('a file that does not parse moves aside and the store starts empty', () => {
  const file = stateFile();
  writeFileSync(file, '{"clockStart": 1000, "fami');

  expect(openStore(file, 5000).state).toEqual({ clockStart: 5000, clockOffset: 0, families: [] });
  const corrupt = readdirSync(join(file, '..')).filter((name) => name.startsWith('state.json.corrupt-'));
  expect(corrupt).toHaveLength(1);
  expect(readFileSync(join(file, '..', corrupt[0]), 'utf8')).toBe('{"clockStart": 1000, "fami');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ clockStart: 5000, clockOffset: 0, families: [] });
});

test('a state file from before the fast-forward offset loads with an offset of 0', () => {
  const file = stateFile();
  writeFileSync(file, JSON.stringify({ clockStart: 1000, families: [] }));
  expect(openStore(file, 5000).state).toEqual({ clockStart: 1000, clockOffset: 0, families: [] });
});

test('a state file that cannot be read stays where it is, and the store throws', () => {
  const file = stateFile();
  mkdirSync(file);
  expect(() => openStore(file, 5000)).toThrow(/EISDIR/);
  expect(statSync(file).isDirectory()).toBe(true);
  expect(readdirSync(join(file, '..'))).toEqual(['state.json']);
});

test('a file with the wrong shape counts as corrupt', () => {
  const file = stateFile();
  writeFileSync(file, 'null');
  expect(openStore(file, 5000).state).toEqual({ clockStart: 5000, clockOffset: 0, families: [] });
  expect(existsSync(file)).toBe(true);
});
