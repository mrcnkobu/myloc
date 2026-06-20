# MyLoc

MyLoc is an Obsidian plugin for location-aware note taking with two separate concerns:

- `presence logging`: log in to and log out from saved places
- `location insertion`: insert the current location into a note without changing presence state

The plugin is built around place notes stored in your vault, active sessions stored in plugin state, and a global monthly timeline written automatically.

## Core Model

### Places

Places are normal markdown files stored under a configured root folder such as `Places/`.

Each place note defines:

- where the place is
- how large its detection radius is
- optional alternate text for inline logging
- optional place-specific inline insert text

### Active sessions

When you log in to a place, the plugin creates an active session for that place. Multiple places can be active at the same time.

### Logs

Every login/logout event is always written to:

- the place note
- the monthly global timeline

Inline insertion into the current note is optional.

## Features

- Log in to one or more nearby places
- Log out from one or more active places
- Show all active places in a dedicated command
- Store places as editable markdown notes in your vault
- Create a new place from the current location
- Automatically append login/logout entries to place files
- Automatically append login/logout entries to a monthly global timeline
- Insert the current location into a note without changing session state
- Prompt to log in first when inserting inside unlogged nearby places
- Use place-specific `inline_text` for insert output when available

## Commands

### `Insert current location`

Gets the current location and inserts it into the current note.

Behavior:

- detects nearby saved places
- if there are nearby saved places that are not currently active, prompts:
  - `Log in and insert`
  - `Insert only`
  - `Cancel`
- if the detected place has `inline_text`, also offers:
  - standard full location output
  - place-specific inline text

This command does not log you in or out unless you explicitly choose `Log in and insert`.

Default full output:

```md
Pantheon
48.846222, 2.346414
[Open in Map](https://www.openstreetmap.org/?...)
```

### `Log in`

Starts one or more active place sessions.

Behavior:

- detects nearby places and preselects unlogged matches
- lets you select saved places manually from the full known-places list, even when they are not detected nearby
- lets you create a new place at the current location
- always writes login entries to:
  - the place note
  - the monthly timeline
- optionally appends inline login text to the current note

### `Log out`

Ends one or more active place sessions.

Behavior:

- shows all active places
- preselects places matching the current location when possible
- always writes logout entries to:
  - the place note
  - the monthly timeline
- optionally appends inline logout text to the current note

### `Active places`

Shows the current active sessions and lets you log out from selected places.

It also includes `Check past time...`, which lets you choose a date and time and see which places were active then based on the timeline.

### `Create place note manually`

Creates a place note without using the current device location.

Use this when you want to prepare known places in advance. The command asks for:

- place path
- latitude
- longitude
- radius
- optional `inline_name`
- optional `inline_text`
- optional tags

## Place Notes

Places are discovered from markdown files under the configured places root folder.

Recommended path example:

```text
Places/France/Paris/Pantheon.md
```

Required frontmatter:

```yaml
---
myloc-type: place
name: Pantheon
inline_name: ""
inline_text: ""
location: [48.846222, 2.346414]
radius: 120
tags:
  - paris
  - monument
---
```

Field meanings:

- `myloc-type`: must be `place`
- `name`: canonical place name
- `inline_name`: optional alternate label used by inline login/logout templates
- `inline_text`: optional place-specific text for `Insert current location`
- `location`: latitude/longitude pair
- `radius`: detection radius in meters
- `tags`: optional tags stored in frontmatter

When a new place is created by the plugin, the body is initialized like this:

```md
# Pantheon

## Details
- Address: Rue Soufflot, Paris, France
- Coordinates: 48.846222, 2.346414
- Radius: 120 m
- Map: [Open in Map](...)

## Log
```

The plugin appends login/logout entries under `## Log`, using `logged in` / `logged out` wording and a daily-note link for the event date.
The daily-note filename format is configurable in MyLoc settings. When available, the Daily Notes core plugin folder is still reused for the link path.

Example:

```md
- [[2026-06-20]] 14:22 logged in
- [[2026-06-20]] 16:05 logged out · 1h 43m
```

## Timeline

The plugin writes a monthly timeline file inside the timeline folder under your places root.

Example path:

```text
Places/_timeline/2026-06.md
```

Example content:

```md
- [[2026-06-20]] 14:22 logged in [[France/Paris/Pantheon|Pantheon]]
- [[2026-06-20]] 16:05 logged out [[France/Paris/Pantheon|Pantheon]] · 1h 43m
```

The daily-note link uses the configured daily note filename as its display text, so folder paths stay hidden in the timeline.

Timeline entries do not include the note from which the command was run.

## Inline Logging

Login/logout can optionally append text to the current note.

These templates are configured globally in settings:

- `Inline log heading`
- `Inline login text`
- `Inline logout text`

If `Inline log heading` is set, inline logs are appended under that exact heading when it exists in the current note.
If the heading is not found, the plugin falls back to appending the text at the end of the current cursor line.

Default values:

```text
📍 Logged in: {place} · {time}
📍 Logged out: {place} · {time} · {duration}
```

Supported placeholders:

- `{place}`: wikilink to the place note, displayed using `inline_name` if set, otherwise `name`
- `{placeName}`: canonical place `name`
- `{inlineName}`: raw `inline_name`
- `{placeLink}`: wikilink to the place note
- `{date}`
- `{time}`
- `{datetime}`
- `{duration}`: meaningful for logout templates

## Place-Specific Insert Text

`inline_text` is used only by `Insert current location`.

If the detected place has a non-empty `inline_text`, the insert prompt lets you choose it instead of the standard full output.
`{place}` in `inline_text` is also the aliased wikilink form.

Supported placeholders in `inline_text`:

- `{place}`
- `{placeName}`
- `{inlineName}`
- `{placeLink}`
- `{lat}`
- `{lon}`
- `{coords}`
- `{mapUrl}`

Example:

```yaml
inline_text: "At {place} ({coords}) · {placeLink}"
```

## Settings

The plugin settings are intentionally small.

### Storage

- `Places root folder`
- `Timeline folder name`
- `Default radius`

### Inline logging

- `Inline logging enabled by default`
- `Inline log heading`
- `Daily note filename format`
- `Inline login text`
- `Inline logout text`

### Location

- `Allow reverse geocoding`
- `Allow approximate IP fallback`
- `Address language`
- `Timezone`

## Usage Examples

### Create a place

1. Run `Log in`
2. Choose `Create new place here`
3. Enter a path such as `France/Paris/Pantheon`
4. Enter radius, optional `inline_name`, optional `inline_text`, and tags
5. Confirm

### Log in at a nearby place

1. Run `Log in`
2. Select one or more detected places
3. Optionally enable inline append
4. Confirm

Result:

- active session is created
- place note gets a login entry
- timeline gets a login entry
- current note gets inline text only if you chose that option

### Insert location without logging in

1. Run `Insert current location`
2. If prompted, choose `Insert only`
3. Choose standard output or place `inline_text` when available

## Development

### Commands

```bash
npm install
npm test
npm run lint
npm run build
npm run deploy:prod
npm run deploy:test
npm run deploy
```

### `.env` for vault deployment

Create a `.env` file in the project root:

```bash
OBSIDIAN_PLUGIN_PATH=/path/to/your/main/vault/.obsidian/plugins/myloc/
OBSIDIAN_TEST_PLUGIN_PATH=/path/to/your/test/vault/.obsidian/plugins/myloc/
```

Deployment scripts:

- `npm run deploy:prod`: build output must already exist or be built separately; copies `main.js`, `manifest.json`, and `styles.css` to the main vault
- `npm run deploy:test`: build output must already exist or be built separately; copies `main.js`, `manifest.json`, and `styles.css` to the test vault
- `npm run deploy`: runs `build`, then deploys to both prod and test vaults

### Current code layout

```text
myloc/
├── main.ts
├── location-service.ts
├── note-service.ts
├── ui.ts
├── types.ts
├── utils.ts
└── tests/
```
