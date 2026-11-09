# Domain Guard — Fake Domain Detector

[![CI](https://github.com/akiy2009/domain-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/akiy2009/domain-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Chrome extension (Manifest V3) that detects fake, look-alike, and phishing domains in real time. It runs entirely on-device — no backend, no content scripts, no tracking.

The UI is primarily Japanese. This document describes the extension in English.

## Features

- Typosquatting, leetspeak, and homograph/IDN detection
- Correct registered-domain boundaries via the full Public Suffix List
- Embedded-brand and userinfo (`@`) tricks
- Risky TLDs, free hosting, URL shorteners, suspicious keywords, deep subdomains
- Risk score from 0 to 100 with human-readable reasons
- Warning page that blocks dangerous navigations (configurable)
- Whitelist, per-rule toggles, light/dark theme, export/import
- Optional Google Safe Browsing integration

> [!IMPORTANT]
> Detection is heuristic and provided for reference only. False positives and false negatives are possible. Always check the address bar before entering credentials.

## Install

### Development build

1. Clone the repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `domain-guard` directory.

Requires **Chrome 110+**.

## Usage

- Open any http/https page. The toolbar badge shows `OK`, `!`, `!!`, `!!!`, or `危`.
- Click the icon to see the score, registered domain, and findings.
- Use **Re-check** to bypass the 5-minute analysis cache.
- Use the settings page to adjust sensitivity, blocking, notifications, rules, appearance, and the whitelist.
- If blocking is enabled, a warning page appears for dangerous sites. Choosing **Open anyway** grants a 2-minute bypass for that registered domain.

## Score

Points from each rule are summed, multiplied by the sensitivity factor (loose 0.6 / normal 1.0 / strict 1.4), and clamped to 0–100. High-confidence impersonation findings have a floor of 70.

| Score | Level | Meaning |
|---:|---|---|
| 0 | Safe | No issues |
| 1–24 | Mostly safe | Minor signals |
| 25–44 | Caution | Review before use |
| 45–69 | Likely dangerous | Avoid entering personal data |
| 70–100 | Dangerous | Blocked by the warning page when enabled |

Whitelisted domains and their subdomains always resolve to **Safe**.

## Privacy

- No developer-operated server and no analytics.
- No content scripts; page content is never read.
- URLs are sent to Google only when Safe Browsing is explicitly enabled with an API key.
- Settings live in `chrome.storage.sync`; warning payloads and temporary bypasses live in `chrome.storage.session`.

See [PRIVACY.md](PRIVACY.md) and [docs/permissions.md](docs/permissions.md).

## Development

Node.js 20+ is required. There are **no runtime or development npm dependencies**.

```bash
npm test              # node:test unit tests
npm run lint:syntax   # syntax-check all JS/JSON as ESM
npm run check         # syntax + tests
npm run build         # create dist/ folder and store ZIP
npm run psl           # refresh the Public Suffix List data
npm run psl:check     # verify the committed PSL data (network required)
```

Architecture: [docs/architecture.md](docs/architecture.md). Store listing draft: [docs/store-listing.md](docs/store-listing.md).

## Limitations

- Heuristic detection cannot catch every phishing technique.
- Brand coverage focuses on major Japanese and global services; extend `lib/brands.js` as needed.
- Safe Browsing accuracy and availability depend on Google.
- Whitelisting disables all warnings for that domain and its subdomains.

## License

[MIT](LICENSE). The bundled Public Suffix List data is provided under MPL 2.0 by [publicsuffix.org](https://publicsuffix.org/).
