# MyLoc

Insert your current location into Obsidian notes. GPS coordinates, addresses, weather, and more.

## Features

- **One-tap location insertion** via ribbon icon or command palette
- **Reverse geocoding** via OpenStreetMap Nominatim — get human-readable addresses
- **Weather integration** via Open-Meteo — current temperature and conditions
- **Frontmatter support** — compatible with Map View plugin for plotting notes on a map
- **Saved places** — define places (home, work, gym) with GPS radius; nearby matches use the place name as address
- **Multiple output formats** — full, compact, coordinates only, or custom template
- **Location notes** — create new notes from templates with location data filled in, then insert a link at the cursor
- **Timezone support** — auto-detects system timezone or manual selection
- **Check-in / check-out** — track time spent at locations with configurable templates
- **Works on mobile** — designed primarily for Android with GPS
- **Desktop fallback** — uses IP-based geolocation when GPS unavailable

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create folder `<vault>/.obsidian/plugins/myloc/`
3. Copy the files into the folder
4. Enable the plugin in Settings → Community Plugins

## Usage

### Commands

- **Insert location (quick)** — inserts formatted location at cursor using the default format (also available via ribbon icon)
- **Insert location (choose format)** — gets the current location, then lets you choose the output format
- **Insert location as frontmatter** — adds location to note's YAML frontmatter
- **Update note location** — updates existing frontmatter location
- **Insert location as new note** — creates a note from a configured template and inserts a link to it
- **Save current location as place** — saves your current GPS position as a named place
- **Check in** — records arrival at current location with timestamp
- **Check out** — records departure with duration since check-in
- **Clear active check-in** — resets persisted check-in state without writing a check-out entry

### Output Formats

**Full** (default):
```
123 Main Street, City, Country
52.229700, 21.012200
[Open in Map](https://openstreetmap.org/...)
```

**Compact**:
```
123 Main Street, City, Country (52.229700, 21.012200)
```

**Coordinates only**:
```
52.229700, 21.012200
```

**Custom template** — use placeholders:
- `{lat}`, `{lon}`, `{coords}` — coordinates
- `{address}`, `{place}`, `{city}`, `{country}` — address parts
- `{mapUrl}`, `{mapLink}` — map links
- `{date}`, `{time}`, `{datetime}`, `{date:FORMAT}` — timestamp
- `{weather}`, `{temp}` — weather info

`{date:FORMAT}` supports `yyyy`, `yy`, `MM`, `M`, `dd`, `d`, `HH`, `H`, `mm`, `m`, `ss`, and `s`.

### Saved Places

Define named places with GPS coordinates and a detection radius. When any command detects you're near a saved place, a picker appears letting you choose the place or use the raw detected location.

- **Place name** is used as the address in both inline output and frontmatter (skips reverse geocoding)
- **Each place has its own template** using the same placeholder system as custom templates
- **Optional per-place check-in/check-out templates** — override the global check-in and check-out templates for specific places (e.g., `🏠 Home · {time}`)
- **Add places** via the "Save current location as place" command (captures GPS automatically) or manually in settings
- **`{place}`** placeholder resolves to the place name when a saved place is active, empty string otherwise

### Location Notes

Location notes create a new note from a vault template and insert a link to the created note at the cursor.

Configure one or more location note presets in settings:

- **Directory** — vault folder for created notes, with placeholders supported (for example `Locations/{date:yyyy/MM}`)
- **Filename template** — generated note filename before the `.md` extension (for example `location_{date:yyyy-MM-dd}`)
- **Template file** — vault path to the note template to read (for example `Templates/location.md`)
- **Link template** — text inserted in the active note after creation (for example `[[{notePath}]]`)

Location note templates support all standard placeholders plus:

- `{date:FORMAT}` — formatted date/time for directories, filenames, and content
- `{notePath}` — created note path without `.md`
- `{noteTitle}` — created note filename without `.md`

### Frontmatter

Writes location in Map View-compatible format:

```yaml
---
location: [52.229700, 21.012200]
address: "123 Main Street, City, Country"
datetime: 2026-02-06T14:30:00
weather: "12°C, Partly cloudy"
---
```

### Check-in / Check-out

Track time spent at locations. Two commands form a pair:

- **Check in** — gets your location, records the arrival time, and appends formatted text to the current note
- **Check out** — calculates the duration since check-in and appends departure text to the currently open note

Check-in state persists across plugin reloads and app restarts.

**Templates** use the same placeholders as custom templates. Saved places can define their own check-in and check-out templates — if set, they override the global defaults.

**Check-out auto-selects the template** based on context:
- **Same note** as check-in → uses the standard check-out template
- **Different note** (e.g., next day's daily note) → uses the "different note" template, which supports extra placeholders for check-in context: `{checkinTime}`, `{checkinDate}`, `{checkinDatetime}`, `{checkinAddress}`, `{checkinPlace}`, `{checkinNote}`

**Section heading** — if set, text is appended under a matching heading in the note. Leave empty to append at the end.

**Duration formats:**
- **Short** — `2h 15m`, `45m`, `3h`
- **Clock** — `2:15`
- **Decimal** — `2.25h`

## Settings

| Setting | Description |
|---------|-------------|
| Privacy settings | Control reverse geocoding, weather lookups, and approximate IP fallback |
| Format | Output format (full/compact/coords/custom) |
| Custom templates | Templates with placeholders |
| Saved places | Named locations with radius detection, per-place templates, and optional check-in/check-out templates |
| Location notes | Note creation presets with directory, filename, template file, and inserted link template |
| Include timestamp | Add date/time to output |
| Include weather | Add weather from Open-Meteo |
| Temperature unit | Celsius or Fahrenheit |
| Timezone | Auto-detect or manual selection |
| Map provider | OpenStreetMap or Google Maps |
| Address language | Language code for addresses (en, pl, de, etc.) |
| Check-in template | Template for check-in text |
| Check-out template | Template for check-out on the same note (supports `{duration}`) |
| Check-out template (different note) | Template for check-out on a different note, with check-in context placeholders |
| Section heading | Heading to append under (empty = end of note) |
| Duration format | Short, clock, or decimal |
| Get location on check-out | Fetch fresh location on check-out |
| Frontmatter fields | Choose what to include in frontmatter |

## Development

### Setup

```bash
git clone https://github.com/mrcnkobu/myloc.git
cd myloc
npm install
```

### Configuration

Copy the environment template and set your test vault path:

```bash
cp .env.example .env
```

Edit `.env`:
```bash
OBSIDIAN_PLUGIN_PATH=/path/to/your/vault/.obsidian/plugins/myloc/
OBSIDIAN_TEST_PLUGIN_PATH=/path/to/test/vault/.obsidian/plugins/myloc/  # optional
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development build with sourcemaps |
| `npm run build` | Production build (minified) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run unit tests |
| `npm run deploy` | Build and copy to vault(s) |

### Testing

1. Run `npm run lint` and `npm run test`
2. Run `npm run deploy`
3. Open Obsidian and enable the plugin in Settings → Community Plugins
4. Reload the plugin after changes: `Ctrl+P` → "Reload app without saving"

For mobile testing via Syncthing or similar, `npm run deploy` copies actual files (symlinks don't sync).

### Project Structure

```
myloc/
├── main.ts                    # Plugin entry point and command wiring
├── location-service.ts        # Location, geocoding, weather, places, and template helpers
├── note-service.ts            # Frontmatter, note path, and heading append helpers
├── ui.ts                      # Modals and settings tab
├── types.ts                   # Shared types and defaults
├── utils.ts                   # Date, duration, distance, and filename utilities
├── tests/                     # Unit tests
├── manifest.json              # Plugin metadata
├── package.json               # Dependencies and scripts
├── esbuild.config.mjs         # Build configuration
├── eslint.config.mjs          # ESLint configuration
├── styles.css                 # Plugin styles
├── .env.example               # Environment template
└── .env                       # Local config (gitignored)
```

## Privacy

- Reverse geocoding, weather, and approximate IP fallback can be enabled or disabled independently in plugin settings
- Location data is sent only to the services required for the features you enable
- No data is stored externally — everything stays in your vault
- IP-based geolocation (desktop fallback) uses `ipwho.is` over HTTPS when enabled

## Credits

- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) — reverse geocoding
- [Open-Meteo](https://open-meteo.com/) — weather data
- [ipwho.is](https://ipwho.is/) — IP geolocation fallback

## License

MIT
