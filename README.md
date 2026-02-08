# MyLoc

Insert your current location into Obsidian notes. GPS coordinates, addresses, weather, and more.

## Features

- **One-tap location insertion** via ribbon icon or command palette
- **Reverse geocoding** via OpenStreetMap Nominatim — get human-readable addresses
- **Weather integration** via Open-Meteo — current temperature and conditions
- **Frontmatter support** — compatible with Map View plugin for plotting notes on a map
- **Saved places** — define places (home, work, gym) with GPS radius; nearby matches use the place name as address
- **Multiple output formats** — full, compact, coordinates only, or custom template
- **Timezone support** — auto-detects system timezone or manual selection
- **Works on mobile** — designed primarily for Android with GPS
- **Desktop fallback** — uses IP-based geolocation when GPS unavailable

## Installation

### Manual Installation

1. Download `main.js` and `manifest.json` from the latest release
2. Create folder `<vault>/.obsidian/plugins/myloc/`
3. Copy the files into the folder
4. Enable the plugin in Settings → Community Plugins

## Usage

### Commands

- **Insert location** — inserts formatted location at cursor (also available via ribbon icon)
- **Insert location as frontmatter** — adds location to note's YAML frontmatter
- **Update note location** — updates existing frontmatter location
- **Save current location as place** — saves your current GPS position as a named place

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
- `{date}`, `{time}`, `{datetime}` — timestamp
- `{weather}`, `{temp}` — weather info

### Saved Places

Define named places with GPS coordinates and a detection radius. When any command detects you're near a saved place, a picker appears letting you choose the place or use the raw detected location.

- **Place name** is used as the address in both inline output and frontmatter (skips reverse geocoding)
- **Each place has its own template** using the same placeholder system as custom templates
- **Add places** via the "Save current location as place" command (captures GPS automatically) or manually in settings
- **`{place}`** placeholder resolves to the place name when a saved place is active, empty string otherwise

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

## Settings

| Setting | Description |
|---------|-------------|
| Format | Output format (full/compact/coords/custom) |
| Custom templates | Templates with placeholders |
| Saved places | Named locations with radius detection and per-place templates |
| Include timestamp | Add date/time to output |
| Include weather | Add weather from Open-Meteo |
| Temperature unit | Celsius or Fahrenheit |
| Timezone | Auto-detect or manual selection |
| Map provider | OpenStreetMap or Google Maps |
| Address language | Language code for addresses (en, pl, de, etc.) |
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
| `npm run deploy` | Build and copy to vault(s) |

### Testing

1. Run `npm run deploy`
2. Open Obsidian and enable the plugin in Settings → Community Plugins
3. Reload the plugin after changes: `Ctrl+P` → "Reload app without saving"

For mobile testing via Syncthing or similar, `npm run deploy` copies actual files (symlinks don't sync).

### Project Structure

```
myloc/
├── main.ts           # Plugin source
├── manifest.json     # Plugin metadata
├── package.json      # Dependencies & scripts
├── esbuild.config.mjs # Build configuration
├── .env.example      # Environment template
└── .env              # Local config (gitignored)
```

## Privacy

- Location data is only sent to OpenStreetMap (for addresses) and Open-Meteo (for weather)
- No data is stored externally — everything stays in your vault
- IP-based geolocation (desktop fallback) uses ip-api.com

## Credits

- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) — reverse geocoding
- [Open-Meteo](https://open-meteo.com/) — weather data
- [ip-api.com](http://ip-api.com/) — IP geolocation fallback

## License

MIT
