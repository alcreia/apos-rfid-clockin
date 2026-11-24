# Typed card numbers are read as hex; reader bursts as decimal

An 8-digit string is simultaneously a legal hex UID and a legal reader decimal, and both cases occur in the real card table: `54828750` is a UID that happens to be all digits, and `42962693` is the reader decimal for `058F8F02`. Guessing in that overlap silently enrols or matches the wrong card, so the two entry points have different, fixed rules: `decode()` handles reader bursts and reads any digit string as decimal, because that is what the reader is documented to send; `decodeUid()` handles typed values and reads hex, refusing the ambiguous 8-digit case unless it carries a `hex:` or `dec:` prefix.

## Consequences

- One card in 42 needs a prefix in any hand-written list. The CSV export emits `hex:54828750` so the file round-trips through the importer.
- `data/cards.c` from the firmware stays the canonical source; `scripts/cards-from-c.ts` regenerates the roster and the decode test fixture from it, and refuses to emit anything if two cards share a UID.
- The 42 real cards are a permanent test (`test/cards.test.ts`): if the byte order, the radix, or the padding ever regresses, it fails there rather than at the door.
