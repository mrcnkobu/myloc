# MyLoc - Obsidian Location Plugin

## Project Overview
Obsidian plugin to insert GPS location, address, and weather into notes. Primarily designed for Android mobile use with desktop fallback.

## Design Principles
- **Simplicity** — one-tap action via ribbon icon
- **Usability** — sensible defaults, minimal configuration needed
- **Minimalism** — no feature bloat, each feature earns its place
- **Elegant, subtle, tech-like** — clean output formats

## Development Workflow

### Commands
```bash
npm run dev      # Development build with sourcemaps
npm run build    # Production build (minified)
npm run deploy   # Build + copy to test vault
```

### Test Vault Location
```
~/sync/sync-mkobu/sync-mkobu_LPT/projects/obsidian-test-env/.obsidian/plugins/myloc/
```

### Testing
1. Run `npm run deploy`
2. Reload plugin in Obsidian (Ctrl+P → "Reload app without saving")
3. Test on desktop first, then Syncthing syncs to Android

## Architecture

### APIs Used
- **GPS**: `navigator.geolocation.getCurrentPosition()` (Android)
- **IP fallback**: ip-api.com (desktop when GPS unavailable)
- **Reverse geocoding**: OpenStreetMap Nominatim
- **Weather**: Open-Meteo (free, no API key)

### Key Files
- `main.ts` — all plugin code in single file (~680 lines)
- `manifest.json` — plugin metadata
- `styles.css` — not used (no custom styling)

### Settings Structure
```typescript
{
  format: "full" | "compact" | "coords" | "custom",
  customTemplate: string,
  mapProvider: "osm" | "google",
  language: string,           // for address (e.g., "en", "pl")
  timezone: string,           // IANA timezone or empty for auto
  tempUnit: "celsius" | "fahrenheit",
  includeTimestamp: boolean,
  includeWeather: boolean,
  frontmatterFields: {
    location: boolean,        // [lat, lon] - Map View compatible
    address: boolean,
    datetime: boolean,
    weather: boolean,
  }
}
```

### Custom Template Placeholders
`{lat}`, `{lon}`, `{coords}`, `{address}`, `{city}`, `{country}`, `{mapUrl}`, `{mapLink}`, `{date}`, `{time}`, `{datetime}`, `{weather}`, `{temp}`

## Release Process

### Version Bump
1. Update version in `manifest.json` and `package.json`
2. Commit: `git commit -am "Bump version to X.Y.Z"`
3. Tag: `git tag X.Y.Z`
4. Push: `git push origin main --tags`
5. Create release: `gh release create X.Y.Z main.js manifest.json --title "X.Y.Z" --notes "Release notes"`

### Community Plugin Submission
- PR to obsidianmd/obsidian-releases
- Follow template in `.github/PULL_REQUEST_TEMPLATE/plugin.md`
- Ensure manifest.json description matches PR description exactly

## Gotchas & Lessons Learned

1. **Desktop GPS fails** — Google's network location needs API key. We use ip-api.com fallback.

2. **Custom template weather** — must check if template contains `{weather}` or `{temp}` to fetch weather data, not just `includeWeather` setting.

3. **Timezone consistency** — use same timezone for both display and ISO strings. Empty timezone = `Intl.DateTimeFormat().resolvedOptions().timeZone`.

4. **Frontmatter format** — `location: [lat, lon]` is Map View compatible. Don't change this format.

5. **Nominatim rate limit** — 1 request/second max. User-Agent header required.

6. **Symlinks don't sync** — for mobile testing via Syncthing, use `npm run deploy` to copy actual files.

## Future Ideas (Not Yet Implemented)
- Short address format (city + country only)
- Copy to clipboard command
- DMS coordinate format option
