# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-08

### Added

- Full Public Suffix List support for accurate registered-domain detection
  (`co.jp`, `co.uk`, public suffixes such as `github.io`, wildcard/exception rules).
- Rule metadata (`lib/rules.js`) with per-rule enable/disable in the options page.
- Settings normalization, validation, export/import, and reset.
- URL checker in the options page.
- Appearance settings (system/light/dark, accent color, per-level colors).
- Accessible popup, options page, and warning page; dark theme support.
- Warning payloads stored in `chrome.storage.session`, with automatic cleanup.
- “Back to safety” target tracking and an inline confirmation before bypassing a block.
- Dependency-free test suite (`node:test`), syntax checker, ZIP build script, and CI workflow.
- Documentation: architecture, permissions, privacy policy, store listing draft, security policy.

### Changed

- Analyzer rewritten with confidence tiers to reduce false positives:
  - typosquatting limited to one-character edits with a matching first character;
  - generic brand words (`apple`, `line`, `office`, `live`, …) are never dangerous on their own;
  - high-value brand typosquats are rated higher;
  - official brand domains are exempt from keyword penalties.
- HTTP alone is informational (score 0); HTTP plus login-related terms adds points.
- Danger findings with a score of 40+ force the total score to at least 70.
- Brand dictionary verified against current official domains and expanded.
- Popup, options, and warning UIs rebuilt with DOM-safe rendering.
- Manifest: `minimum_chrome_version` 110, `options_ui.open_in_tab`, `homepage_url`, `short_name`.

### Fixed

- Critical syntax error in `options/options.js` (`await` inside a non-async callback) that broke the entire options page.
- Brand domains that no longer exist or were incorrect.
- False positives on `github.io` and legitimate bank domains containing “bank”.
- Potential warning-page redirect loop; back navigation now returns to the previous safe URL.
- Punycode decoder overflow handling.
- Race conditions in navigation blocking and stale cache entries.

## [1.0.0] - 2026-10-21

### Added

- Initial release: heuristic fake-domain detection, popup, options page, warning page,
  whitelist, badges, notifications, and optional Google Safe Browsing.
