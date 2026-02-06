# MyLoc

Insert your current location into Obsidian notes. GPS coordinates, addresses, weather, and more.

## Features

- **One-tap location insertion** via ribbon icon or command palette
- **Reverse geocoding** via OpenStreetMap Nominatim — get human-readable addresses
- **Weather integration** via Open-Meteo — current temperature and conditions
- **Frontmatter support** — compatible with Map View plugin for plotting notes on a map
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
- `{address}`, `{city}`, `{country}` — address parts
- `{mapUrl}`, `{mapLink}` — map links
- `{date}`, `{time}`, `{datetime}` — timestamp
- `{weather}`, `{temp}` — weather info

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
| Custom template | Template with placeholders |
| Include timestamp | Add date/time to output |
| Include weather | Add weather from Open-Meteo |
| Temperature unit | Celsius or Fahrenheit |
| Timezone | Auto-detect or manual selection |
| Map provider | OpenStreetMap or Google Maps |
| Address language | Language code for addresses (en, pl, de, etc.) |
| Frontmatter fields | Choose what to include in frontmatter |

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
