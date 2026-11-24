# A USB HID keyboard-wedge reader, not PC/SC or WebUSB

The reader enumerates as a keyboard and types the card UID followed by Enter into whatever input has focus. This needs no driver, no native module, and no browser permission, and it keeps the frontend ignorant of the hardware.

## Considered Options

- **PC/SC reader (ACR122U and similar)** via `node-pcsclite`: native module needing Visual Studio build tools on Windows, plus a bridge process, because a browser cannot open a PC/SC context.
- **WebUSB / Web Serial**: Chromium-only, needs localhost or HTTPS, and a per-device permission prompt that cannot be granted unattended at a kiosk.
- **ESP32 + RC522 firmware**: full control of feedback and buffering, at the cost of owning firmware as well as an app.

## Consequences

- The reader must be configured to **eight uppercase hex characters, MSB-first, no prefix or suffix, Enter as terminator**, matching the existing Log entries (`8B17E350`). A decimal-configured reader emits `2333598544` for the same card, and a byte-reversed one emits `50E3178B`.
- The app cannot distinguish two readers, and cannot detect a misread: it receives text or nothing. UID normalization is therefore `uppercase → strip non-alphanumerics → left-pad to eight`, and the raw string is kept alongside the normalized one.
- MIFARE Classic UIDs are clonable. Acceptable for attendance; these cards must not be reused for door access.
