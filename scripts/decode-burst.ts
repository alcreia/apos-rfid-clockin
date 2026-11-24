import { decode, decodeUid, explain } from '../src/core/uid.js';
import { localDay, logTimestamp } from '../src/core/day.js';

const burst = process.argv[2] ?? '1357059979';

const decoded = decode(burst);
const hex = decoded?.uid ?? '';
const uidBytes = (hex.match(/../g) ?? []).join(' ');
const readerInt = /^\d+$/.test(burst) ? Number(burst) : null;

console.log(`burst from the reader : ${burst}`);
console.log(`its integer value     : ${readerInt === null ? '—' : `0x${readerInt.toString(16).toUpperCase().padStart(8, '0')}`}`);
console.log(`its bytes, in order   : ${uidBytes.split(' ').reverse().join(' ')}`);
console.log(`reverse the bytes     : ${uidBytes}`);
console.log(`canonical UID         : ${hex || 'undecodable'}   (via ${decoded?.via})`);
console.log(`typed-input reading   : ${JSON.stringify(decodeUid(burst))}`);
console.log(`/dev would also show  : ${JSON.stringify(explain(burst))}`);

if (!hex) {
  console.error("\nthis burst does not decode as a 4-byte UID — check the reader's output format");
  process.exit(1);
}

const now = new Date();
console.log(`\na tap right now would append: ${logTimestamp(now)} | ${''}${hex}   (Day ${localDay(now)})`);
