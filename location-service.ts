import type { App, CachedMetadata, TAbstractFile, TFile } from "obsidian";
import {
	type AddressResult,
	type CacheEntry,
	type LocationResult,
	type MyLocSettings,
	type PlaceMatch,
	type PlaceFrontmatter,
	type PlaceRecord,
} from "./types";
import { formatDatePattern, haversineDistance, sanitizeFilename } from "./utils";

interface LocationServiceDeps {
	isMobile: boolean;
	version: string;
	requestUrl: typeof import("obsidian").requestUrl;
}

interface NominatimResponse {
	error?: string;
	display_name?: string;
	address?: {
		city?: string;
		town?: string;
		village?: string;
		country?: string;
	};
}

interface IpWhoIsResponse {
	success?: boolean;
	message?: string;
	latitude?: number;
	longitude?: number;
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
		return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
	}

	formatPathTemplate(template: string): string {
		const tz = this.getTimezone();
		return template.replace(/\{date:([^}]+)\}/g, (_: string, pattern: string) =>
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

	getVisitNotesFolder(): string {
		return this.normalizeVaultPath(`${this.getPlacesRoot()}/${this.getSettings().visitNotesFolderName}`);
	}

	getVisitNoteMonthFolder(date: Date): string {
		const month = formatDatePattern(date, "yyyy-MM", this.getTimezone());
		return `${this.getVisitNotesFolder()}/${month}`;
	}

	getVisitNoteBasename(date: Date, placeName: string): string {
		const stamp = formatDatePattern(date, "yyyyMMddHHmm", this.getTimezone());
		return `${stamp}_${placeName}`;
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
		return this.getMarkdownFilesInFolder(this.getPlacesRoot())
			.filter((file) => !file.path.startsWith(`${this.getTimelineFolder()}/`))
			.filter((file) => !file.path.startsWith(`${this.getVisitNotesFolder()}/`))
			.map((file) => this.parsePlaceFile(file))
			.filter((place): place is PlaceRecord => place !== null)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getTimelineFiles(): TFile[] {
		return this.getMarkdownFilesInFolder(this.getTimelineFolder()).sort((a, b) => a.path.localeCompare(b.path));
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
			"User-Agent": `ObsidianMyLocPlugin/${this.deps.version}`,
		};

		if (this.getSettings().language) {
			headers["Accept-Language"] = this.getSettings().language;
		}

		const response = await this.deps.requestUrl({
			url: `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
			method: "GET",
			headers,
		});
		const data = this.asNominatimResponse(response.json);

		if (data.error) {
			throw new Error(data.error);
		}

		return this.setCachedValue(this.reverseGeocodeCache, cacheKey, {
			display: data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
			city: data.address?.city || data.address?.town || data.address?.village,
			country: data.address?.country,
		}, LocationService.LOOKUP_CACHE_TTL_MS);
	}

	private placeFromFrontmatter(path: string, frontmatter?: CachedMetadata["frontmatter"]): PlaceRecord | null {
		const placeFrontmatter = this.asPlaceFrontmatter(frontmatter);
		if (!placeFrontmatter) {
			return null;
		}

		const latitude = Number(placeFrontmatter.location[0]);
		const longitude = Number(placeFrontmatter.location[1]);
		const numericRadius = Number(placeFrontmatter.radius);
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(numericRadius)) {
			return null;
		}

		return {
			path,
			name: placeFrontmatter.name,
			inlineName: placeFrontmatter.inline_name?.trim() || "",
			inlineText: placeFrontmatter.inline_text || "",
			latitude,
			longitude,
			radius: numericRadius,
			tags: placeFrontmatter.tags || [],
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

		const data = this.asIpWhoIsResponse(response.json);
		if (data.success === false) {
			throw new Error(data.message || "IP geolocation failed");
		}
		if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
			throw new Error("IP geolocation returned invalid coordinates");
		}

		return {
			latitude: data.latitude,
			longitude: data.longitude,
			accuracy: 5000,
			isApproximate: true,
		};
	}

	private getMarkdownFilesInFolder(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!this.isFolderLike(folder)) {
			return this.getVaultMarkdownFiles().filter((file) => file.path.startsWith(`${folderPath}/`));
		}

		const files: TFile[] = [];
		this.collectMarkdownFiles(folder, files);
		return files;
	}

	private collectMarkdownFiles(entry: TAbstractFile, files: TFile[]): void {
		if (this.isMarkdownFile(entry)) {
			files.push(entry);
			return;
		}
		if (this.isFolderLike(entry)) {
			for (const child of entry.children) {
				this.collectMarkdownFiles(child, files);
			}
		}
	}

	private isFolderLike(entry: unknown): entry is TAbstractFile & { children: TAbstractFile[] } {
		return Boolean(entry) && typeof entry === "object" && Array.isArray((entry as { children?: unknown }).children);
	}

	private isMarkdownFile(entry: unknown): entry is TFile {
		return Boolean(entry)
			&& typeof entry === "object"
			&& typeof (entry as { path?: unknown }).path === "string"
			&& (entry as { extension?: unknown }).extension === "md"
			&& !Array.isArray((entry as { children?: unknown }).children);
	}

	private asPlaceFrontmatter(frontmatter?: CachedMetadata["frontmatter"]): PlaceFrontmatter | null {
		const record = this.asRecord(frontmatter);
		if (!record) {
			return null;
		}

		const type = record["myloc-type"];
		const name = record["name"];
		const location = record["location"];
		const radius = record["radius"];
		const inlineName = record["inline_name"];
		const inlineText = record["inline_text"];
		const tags = record["tags"];

		if (
			type !== "place" ||
			typeof name !== "string" ||
			!Array.isArray(location) ||
			location.length < 2 ||
			(typeof inlineName !== "string" && inlineName !== undefined) ||
			(typeof inlineText !== "string" && inlineText !== undefined) ||
			(typeof radius !== "number" && typeof radius !== "string")
		) {
			return null;
		}

		return {
			"myloc-type": "place",
			name,
			inline_name: inlineName,
			inline_text: inlineText,
			location: [Number(location[0]), Number(location[1])],
			radius: Number(radius),
			tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
		};
	}

	private getVaultMarkdownFiles(): TFile[] {
		const vaultWithMarkdownFiles = this.app.vault as typeof this.app.vault & {
			getMarkdownFiles?: () => TFile[];
		};
		return typeof vaultWithMarkdownFiles.getMarkdownFiles === "function"
			? vaultWithMarkdownFiles.getMarkdownFiles()
			: [];
	}

	private asRecord(value: unknown): Record<string, unknown> | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return null;
		}
		return value as Record<string, unknown>;
	}

	private asNominatimResponse(data: unknown): NominatimResponse {
		const value = this.asRecord(data);
		if (!value) {
			return {};
		}
		const address = value["address"];
		const addressRecord = this.asRecord(address) || undefined;
		return {
			error: typeof value["error"] === "string" ? value["error"] : undefined,
			display_name: typeof value["display_name"] === "string" ? value["display_name"] : undefined,
			address: addressRecord ? {
				city: typeof addressRecord["city"] === "string" ? addressRecord["city"] : undefined,
				town: typeof addressRecord["town"] === "string" ? addressRecord["town"] : undefined,
				village: typeof addressRecord["village"] === "string" ? addressRecord["village"] : undefined,
				country: typeof addressRecord["country"] === "string" ? addressRecord["country"] : undefined,
			} : undefined,
		};
	}

	private asIpWhoIsResponse(data: unknown): IpWhoIsResponse {
		const value = this.asRecord(data);
		if (!value) {
			return {};
		}
		return {
			success: typeof value["success"] === "boolean" ? value["success"] : undefined,
			message: typeof value["message"] === "string" ? value["message"] : undefined,
			latitude: typeof value["latitude"] === "number" ? value["latitude"] : undefined,
			longitude: typeof value["longitude"] === "number" ? value["longitude"] : undefined,
		};
	}
}

export { LocationService };
export default LocationService;
