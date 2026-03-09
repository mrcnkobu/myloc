import type { App } from "obsidian";
import {
	AddressResult,
	CacheEntry,
	CheckInState,
	LocationResult,
	MyLocSettings,
	ResolvedLocationDetails,
	SavedPlace,
	TemplateContext,
	WEATHER_CODES,
	WeatherResult,
} from "./types";
import { formatDatePattern, haversineDistance } from "./utils";

interface LocationServiceDeps {
	isMobile: boolean;
	requestUrl: typeof import("obsidian").requestUrl;
	openSavedPlacePicker: (matches: { place: SavedPlace; distance: number }[]) => Promise<SavedPlace | null>;
}

export class LocationService {
	private locationCache: CacheEntry<LocationResult> | null = null;
	private reverseGeocodeCache = new Map<string, CacheEntry<AddressResult>>();
	private weatherCache = new Map<string, CacheEntry<WeatherResult>>();
	private static readonly LOCATION_CACHE_TTL_MS = 30000;
	private static readonly LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

	constructor(
		private app: App,
		private getSettings: () => MyLocSettings,
		private formatDateTime: (date: Date) => { date: string; time: string; datetime: string; iso: string },
		private getTimezone: () => string,
		private deps: LocationServiceDeps
	) {}

	applyTemplate(template: string, values: Record<string, string>): string {
		const tz = this.getTimezone();
		let result = template.replace(/\{date:([^}]+)\}/g, (_, pattern) =>
			formatDatePattern(new Date(), pattern, tz)
		);
		result = result.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
		return result;
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

	async maybeGetWeatherForTemplate(location: LocationResult, template: string): Promise<WeatherResult | null> {
		if (!/\{(weather|temp)\}/.test(template)) {
			return null;
		}

		try {
			return await this.getWeather(location.latitude, location.longitude);
		} catch {
			return null;
		}
	}

	buildTemplateContext(
		location: LocationResult,
		options: {
			address?: AddressResult | null;
			placeName?: string;
			weather?: WeatherResult | null;
			includeApproximate?: boolean;
		} = {}
	): TemplateContext {
		const address = options.address;
		const placeName = options.placeName || "";
		const weather = options.weather || null;
		const mapUrl = this.getMapUrl(location.latitude, location.longitude);
		const { date, time, datetime } = this.formatDateTime(new Date());
		const weatherStr = weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : "";
		const tempStr = weather ? `${weather.temperature}${weather.unit}` : "";

		return {
			lat: location.latitude.toFixed(6),
			lon: location.longitude.toFixed(6),
			coords: this.getCoordsString(location, options.includeApproximate),
			address: address?.display || placeName,
			place: placeName,
			city: address?.city || "",
			country: address?.country || "",
			mapUrl,
			mapLink: `[Open in Map](${mapUrl})`,
			date,
			time,
			datetime,
			weather: weatherStr,
			temp: tempStr,
		};
	}

	async resolveCurrentLocationDetails(fallback: CheckInState): Promise<ResolvedLocationDetails> {
		const fallbackLocation: LocationResult = {
			latitude: fallback.latitude,
			longitude: fallback.longitude,
			accuracy: 0,
			isApproximate: false,
		};

		if (!this.getSettings().checkin.checkoutLocation) {
			return {
				location: fallbackLocation,
				address: fallback.address || "",
				city: fallback.city || "",
				country: fallback.country || "",
				placeName: fallback.place || "",
			};
		}

		try {
			const location = await this.getLocation();
			const place = await this.resolvePlace(location);
			if (place) {
				return {
					location,
					address: place.name,
					city: "",
					country: "",
					placeName: place.name,
				};
			}

			try {
				const addr = await this.reverseGeocode(location.latitude, location.longitude);
				return {
					location,
					address: addr.display,
					city: addr.city || "",
					country: addr.country || "",
					placeName: "",
				};
			} catch {
				return {
					location,
					address: "",
					city: "",
					country: "",
					placeName: "",
				};
			}
		} catch {
			return {
				location: fallbackLocation,
				address: fallback.address || "",
				city: fallback.city || "",
				country: fallback.country || "",
				placeName: fallback.place || "",
			};
		}
	}

	normalizeVaultPath(path: string): string {
		const normalized = path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
		if (!normalized) {
			throw new Error("Location note directory cannot be empty");
		}

		const segments = normalized.split("/").map((segment) => segment.trim());
		if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
			throw new Error("Location note directory contains invalid path segments");
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

		try {
			const location = await this.getGPSLocation();
			this.locationCache = {
				value: location,
				expiresAt: Date.now() + LocationService.LOCATION_CACHE_TTL_MS,
			};
			return location;
		} catch {
			throw new Error("Unable to get device location. Enable approximate IP fallback in settings to allow desktop lookup.");
		}
	}

	async reverseGeocode(lat: number, lon: number): Promise<AddressResult> {
		if (!this.getSettings().privacy.allowReverseGeocoding) {
			throw new Error("Reverse geocoding is disabled in privacy settings");
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

	async getWeather(lat: number, lon: number): Promise<WeatherResult> {
		if (!this.getSettings().privacy.allowWeather) {
			throw new Error("Weather lookup is disabled in privacy settings");
		}

		const settings = this.getSettings();
		const cacheKey = `${this.getCacheKey(lat, lon)}:${settings.tempUnit}`;
		const cachedWeather = this.getCachedValue(this.weatherCache.get(cacheKey));
		if (cachedWeather) {
			return cachedWeather;
		}

		const unit = settings.tempUnit === "fahrenheit" ? "fahrenheit" : "celsius";
		const response = await this.deps.requestUrl({
			url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${unit}`,
			method: "GET",
		});

		const data = response.json;
		const current = data.current_weather;
		const symbol = settings.tempUnit === "fahrenheit" ? "\u00b0F" : "\u00b0C";

		return this.setCachedValue(this.weatherCache, cacheKey, {
			temperature: Math.round(current.temperature),
			unit: symbol,
			description: WEATHER_CODES[current.weathercode] || "Unknown",
		}, LocationService.LOOKUP_CACHE_TTL_MS);
	}

	findMatchingPlaces(location: LocationResult): { place: SavedPlace; distance: number }[] {
		return this.getSettings().savedPlaces
			.map((place) => ({
				place,
				distance: haversineDistance(location.latitude, location.longitude, place.latitude, place.longitude),
			}))
			.filter((m) => m.distance <= m.place.radius)
			.sort((a, b) => a.distance - b.distance);
	}

	async resolvePlace(location: LocationResult): Promise<SavedPlace | null> {
		const matches = this.findMatchingPlaces(location);
		if (matches.length === 0) return null;
		if (matches.length === 1) return matches[0].place;
		return this.deps.openSavedPlacePicker(matches);
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
		if (!this.getSettings().privacy.allowIpFallback) {
			throw new Error("Approximate IP geolocation is disabled in privacy settings");
		}

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
