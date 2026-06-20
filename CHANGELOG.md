# Changelog

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
