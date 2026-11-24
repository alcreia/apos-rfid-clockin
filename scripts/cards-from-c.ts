/**
 * Firmware card table -> importable roster.
 *
 * The firmware stores each UID as four decimal bytes, MSB first:
 *   {{139,23,227,80}, "Example Employee"}   ->   8B 17 E3 50   ->   8B17E350
 *
 * The reader emits the same four bytes in decimal *reversed* (1357059979 for that
 * card), so this table is the canonical source and the reader is the thing that
 * needs converting — which is what src/core/uid.ts does at tap time.
 *
 *   tsx scripts/cards-from-c.ts data/cards.c
 *
 * Writes:
 *   data/roster-import.csv            the paste for /dev bulk enrolment
 *   test/fixtures/reader-decimals.json  uid/decimal pairs, for the decode test
 *
 * Exits non-zero on a duplicate card, so a copy-paste slip in the firmware table
 * cannot quietly collapse two people into one identity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rosterToCsv } from '../src/core/import.js';
import type { Employee } from '../src/core/roster.js';

const srcPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'data/cards.c';
const excludePrefix = process.argv
  .slice(2)
  .find((a) => a.startsWith('--exclude='))
  ?.split('=')[1];
const source = fs.readFileSync(srcPath, 'utf8');

const ENTRY = /\{\s*\{\s*([\d\s,]+?)\s*\}\s*,\s*"([^"]*)"\s*\}/g;

type Card = { hex: string; decimal: string; name: string };
const cards: Card[] = [];
const problems: string[] = [];

for (const match of source.matchAll(ENTRY)) {
  const bytes = match[1]!.split(',').map((b) => Number(b.trim()));
  const name = match[2]!.trim();

  if (bytes.length !== 4 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    problems.push(`bad byte array for "${name}": ${match[1]}`);
    continue;
  }

  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  // Reader order: the same four bytes, reversed, read as one decimal integer.
  const decimal = String(parseInt([...bytes].reverse().map((b) => b.toString(16).padStart(2, '0')).join(''), 16));
  cards.push({ hex, decimal, name });
}

if (cards.length === 0) {
  console.error(`no card entries found in ${srcPath}`);
  process.exit(1);
}

const seen = new Map<string, string>();
for (const card of cards) {
  const clash = seen.get(card.hex);
  if (clash) problems.push(`duplicate UID ${card.hex}: "${clash}" and "${card.name}"`);
  else seen.set(card.hex, card.name);
}

if (problems.length > 0) {
  console.error('refusing to emit a roster:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const roster: Record<string, Employee> = {};
for (const card of cards) roster[card.hex] = { name: card.name };

const csv = rosterToCsv(roster);
fs.writeFileSync('data/roster-import.csv', csv);

// The table carries everyone, including people who have left; the live roster must not.
if (excludePrefix) {
  const activeRoster: Record<string, Employee> = {};
  for (const card of cards) {
    if (!card.name.startsWith(excludePrefix)) activeRoster[card.hex] = { name: card.name };
  }
  fs.writeFileSync('data/roster-active.csv', rosterToCsv(activeRoster));
  console.log(
    `${Object.keys(activeRoster).length} of ${cards.length} kept (dropping names starting with "${excludePrefix}") -> data/roster-active.csv`,
  );
}
fs.mkdirSync('test/fixtures', { recursive: true });
fs.writeFileSync(
  'test/fixtures/reader-decimals.json',
  `${JSON.stringify(
    cards.map((c) => ({ hex: c.hex, decimal: c.decimal })),
    null,
    2,
  )}\n`,
);

const shortNames = cards.filter((c) => c.name.startsWith('_'));
console.log(`${cards.length} cards -> data/roster-import.csv`);
console.log(`${shortNames.length} names start with "_" (shown on the kiosk as-is)`);
console.log('\nfirst five:');
for (const c of cards.slice(0, 5)) console.log(`  ${c.hex}  ${c.decimal.padStart(10)}  ${c.name}`);
const adrian = cards.find((c) => c.hex === '8B17E350');
console.log(`\nspot check 8B17E350 -> ${adrian ? `${adrian.name} (reader sends ${adrian.decimal})` : 'MISSING'}`);
if (!adrian) process.exit(1);
