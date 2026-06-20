import type { App, CachedMetadata, TFile } from "obsidian";
import {
	type AddressResult,
	type CacheEntry,
	type LocationResult,
	type MyLocSettings,
	type PlaceMatch,
	type PlaceRecord,
} from "./types";
import { formatDatePattern, haversineDistance, sanitizeFilename } from "./utils";

interface LocationServiceDeps {
	isMobile: boolean;
	requestUrl: typeof import("obsidian").requestUrl;
}

class LocationService {
	private locationCache: CacheEntry<LocationResult> | null = null;
	private reverseGeocodeCache = new Map<string, CacheEntry<AddressResult>>();
	private static readonly LOCATION_CACHE_TTL_MS = 30000;
	private static readonly LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

	constructor(
		private app: App,
		private getSettings: () => MyLocSettings,
		private formatDateTime: (date: Date) => { date: string; time: string; datetime: string; iso: string },
		private getTimezone: () => string,
		private deps: LocationServiceDeps
	) {}

	formatInlineTemplate(template: string, values: Record<string, string>): string {
		return template.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
	}

	formatPathTemplate(template: string): string {
		const tz = this.getTimezone();
		return template.replace(/\{date:([^}]+)\}/g, (_, pattern) =>
			formatDatePattern(new Date(), pattern, tz)
		);
	}

	getMapUrl(lat: number, lon: number): string {
		if (this.getSettings().mapProvider === "google") {
			return `https://www.google.com/maps?q=${lat},${lon}`;
		}
		return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
	}

	getCoordsString(location: LocationResult, includeApproximate = true): string {
		const coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
		return includeApproximate && location.isApproximate ? `${coords} (approximate)` : coords;
	}

	normalizeVaultPath(path: string): string {
		const normalized = path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
		if (!normalized) {
			throw new Error("Path cannot be empty");
		}

		const segments = normalized.split("/").map((segment) => segment.trim());
		if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
			throw new Error("Path contains invalid segments");
		}

		return segments.join("/");
	}

	async ensureFolderExists(path: string) {
		const segments = this.normalizeVaultPath(path).split("/");
		let currentPath = "";

		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	getPlacesRoot(): string {
		return this.normalizeVaultPath(this.getSettings().placesRoot);
	}

	getTimelineFolder(): string {
		return this.normalizeVaultPath(`${this.getPlacesRoot()}/${this.getSettings().timelineFolderName}`);
	}

	getTimelineFilePath(date: Date): string {
		const month = formatDatePattern(date, "yyyy-MM", this.getTimezone());
		return `${this.getTimelineFolder()}/${month}.md`;
	}

	getPlaceFilePath(relativePath: string): string {
		const normalized = this.normalizeVaultPath(relativePath);
		const segments = normalized.split("/").map((segment) => sanitizeFilename(segment));
		if (segments.some((segment) => !segment)) {
			throw new Error("Place path contains an empty file or folder name");
		}

		const fullPath = `${this.getPlacesRoot()}/${segments.join("/")}`;
		return fullPath.endsWith(".md") ? fullPath : `${fullPath}.md`;
	}

	parsePlaceFile(file: TFile): PlaceRecord | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		return this.placeFromFrontmatter(file.path, frontmatter);
	}

	getAllPlaces(): PlaceRecord[] {
		const root = `${this.getPlacesRoot()}/`;
		const timelineFolder = `${this.getTimelineFolder()}/`;
		return this.app.vault.getMarkdownFiles()
			.filter((file) => file.path.startsWith(root) && !file.path.startsWith(timelineFolder))
			.map((file) => this.parsePlaceFile(file))
			.filter((place): place is PlaceRecord => place !== null)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	findMatchingPlaces(location: LocationResult, places = this.getAllPlaces()): PlaceMatch[] {
		return places
			.map((place) => ({
				place,
				distance: haversineDistance(location.latitude, location.longitude, place.latitude, place.longitude),
			}))
			.filter((match) => match.distance <= match.place.radius)
			.sort((a, b) => a.distance - b.distance);
	}

	async getLocation(): Promise<LocationResult> {
		const cachedLocation = this.getCachedValue(this.locationCache);
		if (cachedLocation) {
			return cachedLocation;
		}

		const permissionState = await this.getGeolocationPermissionState();
		const shouldPreferGps = this.deps.isMobile || permissionState !== "denied";

		if (shouldPreferGps) {
			try {
				const location = await this.getGPSLocation();
				this.locationCache = {
					value: location,
					expiresAt: Date.now() + LocationService.LOCATION_CACHE_TTL_MS,
				};
				return location;
			} catch {
				// Fall through
			}
		}

		if (this.getSettings().privacy.allowIpFallback) {
			const location = await this.getIPLocation();
			this.locationCache = {
				value: location,
				expiresAt: Date.now() + LocationService.LOCATION_CACHE_TTL_MS,
			};
			return location;
		}

		throw new Error("Unable to get device location. Enable approximate IP fallback in settings to allow desktop lookup.");
	}

	async reverseGeocode(lat: number, lon: number): Promise<AddressResult> {
		if (!this.getSettings().privacy.allowReverseGeocoding) {
			throw new Error("Reverse geocoding is disabled in settings");
		}

		const cacheKey = this.getCacheKey(lat, lon);
		const cachedAddress = this.getCachedValue(this.reverseGeocodeCache.get(cacheKey));
		if (cachedAddress) {
			return cachedAddress;
		}

		const headers: Record<string, string> = {
			"User-Agent": "ObsidianMyLocPlugin/0.1.0",
		};

		if (this.getSettings().language) {
			headers["Accept-Language"] = this.getSettings().language;
		}

		const response = await this.deps.requestUrl({
			url: `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
			method: "GET",
			headers,
		});
		const data = response.json;

		if (data.error) {
			throw new Error(data.error);
		}

		return this.setCachedValue(this.reverseGeocodeCache, cacheKey, {
			display: data.display_name,
			city: data.address?.city || data.address?.town || data.address?.village,
			country: data.address?.country,
		}, LocationService.LOOKUP_CACHE_TTL_MS);
	}

	private placeFromFrontmatter(path: string, frontmatter?: CachedMetadata["frontmatter"]): PlaceRecord | null {
		const type = frontmatter?.["myloc-type"];
		const name = frontmatter?.name;
		const location = frontmatter?.location;
		const radius = frontmatter?.radius;

		if (type !== "place" || typeof name !== "string" || !Array.isArray(location) || location.length < 2) {
			return null;
		}

		const latitude = Number(location[0]);
		const longitude = Number(location[1]);
		const numericRadius = Number(radius);
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(numericRadius)) {
			return null;
		}

		const tags = Array.isArray(frontmatter?.tags)
			? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
			: [];

		return {
			path,
			name,
			inlineName: typeof frontmatter?.inline_name === "string" ? frontmatter.inline_name.trim() : "",
			inlineText: typeof frontmatter?.inline_text === "string" ? frontmatter.inline_text : "",
			latitude,
			longitude,
			radius: numericRadius,
			tags,
		};
	}

	private getCacheKey(lat: number, lon: number): string {
		return `${lat.toFixed(4)},${lon.toFixed(4)}`;
	}

	private getCachedValue<T>(entry: CacheEntry<T> | null | undefined): T | null {
		if (!entry || entry.expiresAt <= Date.now()) {
			return null;
		}
		return entry.value;
	}

	private setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
		cache.set(key, {
			value,
			expiresAt: Date.now() + ttlMs,
		});
		return value;
	}

	private async getGeolocationPermissionState(): Promise<PermissionState | "unknown"> {
		if (!navigator.permissions?.query) {
			return "unknown";
		}

		try {
			const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
			return status.state;
		} catch {
			return "unknown";
		}
	}

	private getGPSLocation(): Promise<LocationResult> {
		return new Promise((resolve, reject) => {
			if (!navigator.geolocation) {
				reject(new Error("Geolocation not supported"));
				return;
			}

			navigator.geolocation.getCurrentPosition(
				(position) => {
					resolve({
						latitude: position.coords.latitude,
						longitude: position.coords.longitude,
						accuracy: position.coords.accuracy,
						isApproximate: false,
					});
				},
				(positionError) => {
					reject(new Error(positionError.message));
				},
				{
					enableHighAccuracy: true,
					timeout: 10000,
					maximumAge: 0,
				}
			);
		});
	}

	private async getIPLocation(): Promise<LocationResult> {
		const response = await this.deps.requestUrl({
			url: "https://ipwho.is/",
			method: "GET",
		});

		const data = response.json;
		if (data.success === false) {
			throw new Error(data.message || "IP geolocation failed");
		}

		return {
			latitude: data.latitude,
			longitude: data.longitude,
			accuracy: 5000,
			isApproximate: true,
		};
	}
}

export { LocationService };
export default LocationService;
