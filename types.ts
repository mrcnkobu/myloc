export type TempUnit = "celsius" | "fahrenheit";

export interface PlaceFrontmatter {
	["myloc-type"]: "place";
	name: string;
	inline_name?: string;
	inline_text?: string;
	location: [number, number];
	radius: number;
	tags?: string[];
}

export interface PlaceRecord {
	path: string;
	name: string;
	inlineName: string;
	inlineText: string;
	latitude: number;
	longitude: number;
	radius: number;
	tags: string[];
}

export interface ActivePlaceSession {
	id: string;
	placePath: string;
	placeName: string;
	inlineName: string;
	startedAt: number;
	startedLatitude: number;
	startedLongitude: number;
}

export interface InlineTemplateContext {
	place: string;
	placeName: string;
	inlineName: string;
	placeLink: string;
	date: string;
	time: string;
	datetime: string;
	duration: string;
}

export interface PrivacySettings {
	allowReverseGeocoding: boolean;
	allowIpFallback: boolean;
}

export interface MyLocSettings {
	placesRoot: string;
	timelineFolderName: string;
	defaultRadius: number;
	inlineLoggingDefault: boolean;
	inlineLogHeading: string;
	inlineLoginTemplate: string;
	inlineLogoutTemplate: string;
	dailyNoteFormat: string;
	language: string;
	timezone: string;
	mapProvider: "osm" | "google";
	tempUnit: TempUnit;
	privacy: PrivacySettings;
}

export const DEFAULT_SETTINGS: MyLocSettings = {
	placesRoot: "Places",
	timelineFolderName: "_timeline",
	defaultRadius: 200,
	inlineLoggingDefault: false,
	inlineLogHeading: "",
	inlineLoginTemplate: "📍 Logged in: {place} · {time}",
	inlineLogoutTemplate: "📍 Logged out: {place} · {time} · {duration}",
	dailyNoteFormat: "YYYY-MM-DD",
	language: "",
	timezone: "",
	mapProvider: "osm",
	tempUnit: "celsius",
	privacy: {
		allowReverseGeocoding: true,
		allowIpFallback: false,
	},
};

export interface LocationResult {
	latitude: number;
	longitude: number;
	accuracy: number;
	isApproximate: boolean;
}

export interface AddressResult {
	display: string;
	city?: string;
	country?: string;
}

export interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface PlaceMatch {
	place: PlaceRecord;
	distance: number;
}

export interface MyLocPluginUiApi {
	settings: MyLocSettings;
	activeSessions: ActivePlaceSession[];
	saveSettings(): Promise<void>;
	formatDateTime(date: Date): { date: string; time: string; datetime: string; iso: string };
}

export const TIMEZONES: string[] = [
	"Africa/Cairo",
	"Africa/Johannesburg",
	"Africa/Lagos",
	"America/Anchorage",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/New_York",
	"America/Sao_Paulo",
	"America/Toronto",
	"Asia/Bangkok",
	"Asia/Dubai",
	"Asia/Hong_Kong",
	"Asia/Kolkata",
	"Asia/Seoul",
	"Asia/Shanghai",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Australia/Melbourne",
	"Australia/Sydney",
	"Europe/Amsterdam",
	"Europe/Berlin",
	"Europe/Istanbul",
	"Europe/London",
	"Europe/Madrid",
	"Europe/Moscow",
	"Europe/Paris",
	"Europe/Rome",
	"Europe/Warsaw",
	"Pacific/Auckland",
	"Pacific/Honolulu",
];
