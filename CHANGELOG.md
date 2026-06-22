# Changelog

## 0.3.3 - 2026-06-22

This release removes the last settings-tab compatibility issue reported by automated review.

- Replaced the remaining settings-tab `Setting` row usage with plain DOM-based controls to avoid unsupported API detection
- Kept the same settings behavior while simplifying the compatibility surface

## 0.3.2 - 2026-06-22

This release closes out the remaining automated review findings after 0.3.1.

- Reworked the settings tab implementation to avoid the remaining Obsidian API compatibility warnings
- Removed the remaining unsafe type-handling warnings in location and frontmatter parsing
- Kept the updated release workflow and attestation setup from 0.3.1 in place for future releases

## 0.3.1 - 2026-06-22

This release focuses on packaging, compatibility, and repository readiness for review.

- Updated the plugin description to match current functionality and marketplace requirements
- Raised the declared minimum app version to match the Obsidian APIs used by the plugin
- Reworked scan-flagged UI styling to use CSS classes instead of direct style assignment
- Hardened settings, frontmatter, and remote JSON parsing to remove unsafe access warnings
- Reduced vault-wide enumeration by preferring folder-scoped traversal for places and timeline files
- Replaced the deprecated `builtin-modules` package with Node's built-in module list
- Added a GitHub Actions release workflow with build provenance attestations for release assets

## 0.3.0 - 2026-06-22

This release adds a second wave of workflow polish on top of the 0.2.0 rebuild.

- Added historical lookup from `Active places` with `Check past time...`, reconstructing active places from timeline entries
- Enabled inline logging by default for new installs
- Improved login flow so detected places and drafted new places expose inline behavior directly in the selection list
- Added support for creating a new place from the login modal and deciding immediately whether to log in there
- Improved login, logout, and active-place modals with clearer place rows, inline toggles, and direct file links
- Changed timeline entries to use daily-note links with hidden folder paths and aliased place links
- Improved place-note logs to show the daily-note link first
- Added manual saved-place selection during login and a dedicated `Create place note manually` command
- Added configurable daily note filename format for generated daily-note links
- Polished inline log placement and heading behavior
- Expanded tests for timeline parsing and note insertion behavior

## 0.2.0 - 2026-06-21

This release rebuilds MyLoc around file-backed places, active sessions, and timeline logging.

- Replaced settings-backed saved places with markdown place notes under a configurable places folder
- Added multi-place active sessions with dedicated `Log in`, `Log out`, and `Active places` commands
- Added automatic place-note logging and monthly global timeline logging
- Added optional inline login/logout insertion with configurable templates
- Added `Insert current location` prompt flow for nearby unlogged places
- Added support for place-specific `inline_text` when inserting a location
- Added daily-note links in place logs and timeline entries
- Added configurable daily note filename format for generated daily-note links
- Added optional inline log heading with fallback to the current cursor line
- Added manual selection of saved places during login
- Added `Create place note manually` for preparing place files ahead of time
- Added separate deploy scripts for prod and test vaults
- Simplified plugin settings and updated documentation for the new model
