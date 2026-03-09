export type MapProvider = "osm" | "google";
export type TempUnit = "celsius" | "fahrenheit";
export type DurationFormat = "short" | "clock" | "decimal";

export interface NamedTemplate {
	id: string;
	name: string;
	template: string;
}

export interface SavedPlace {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	radius: number;
	template: string;
	checkinTemplate?: string;
	checkoutTemplate?: string;
}

export interface LocationNote {
	id: string;
	name: string;
	directory: string;
	filenameTemplate: string;
	templatePath: string;
	linkTemplate: string;
}

export interface CheckInState {
	timestamp: number;
	latitude: number;
	longitude: number;
	address?: string;
	city?: string;
	country?: string;
	place?: string;
	placeId?: string;
	notePath?: string;
}

export interface CheckInSettings {
	checkinTemplate: string;
	checkoutTemplate: string;
	checkoutTemplateOther: string;
	heading: string;
	durationFormat: DurationFormat;
	checkoutLocation: boolean;
}

export interface FrontmatterFields {
	location: boolean;
	address: boolean;
	datetime: boolean;
	weather: boolean;
}

export interface PrivacySettings {
	allowReverseGeocoding: boolean;
	allowWeather: boolean;
	allowIpFallback: boolean;
}

export interface MyLocSettings {
	format: string;
	customTemplates: NamedTemplate[];
	savedPlaces: SavedPlace[];
	mapProvider: MapProvider;
	language: string;
	timezone: string;
	tempUnit: TempUnit;
	includeTimestamp: boolean;
	includeWeather: boolean;
	locationNotes: LocationNote[];
	frontmatterFields: FrontmatterFields;
	checkin: CheckInSettings;
	privacy: PrivacySettings;
}

export const DEFAULT_SETTINGS: MyLocSettings = {
	format: "full",
	customTemplates: [],
	savedPlaces: [],
	locationNotes: [],
	mapProvider: "osm",
	language: "",
	timezone: "",
	tempUnit: "celsius",
	includeTimestamp: false,
	includeWeather: false,
	frontmatterFields: {
		location: true,
		address: false,
		datetime: false,
		weather: false,
	},
	checkin: {
		checkinTemplate: "📍 Checked in: {address} · {time}",
		checkoutTemplate: "📍 Checked out: {time} · {duration}",
		checkoutTemplateOther: "📍 Checked out: {time} · {duration} (checked in: {checkinAddress}, {checkinTime})",
		heading: "",
		durationFormat: "short",
		checkoutLocation: false,
	},
	privacy: {
		allowReverseGeocoding: true,
		allowWeather: true,
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

export interface WeatherResult {
	temperature: number;
	unit: string;
	description: string;
}

export interface FormatOption {
	id: string;
	name: string;
	description: string;
}

export interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export interface TemplateContext {
	[key: string]: string;
	lat: string;
	lon: string;
	coords: string;
	address: string;
	place: string;
	city: string;
	country: string;
	mapUrl: string;
	mapLink: string;
	date: string;
	time: string;
	datetime: string;
	weather: string;
	temp: string;
}

export interface ResolvedLocationDetails {
	location: LocationResult;
	address: string;
	city: string;
	country: string;
	placeName: string;
}

export interface MyLocPluginUiApi {
	settings: MyLocSettings;
	activeCheckIn: CheckInState | null;
	saveSettings(): Promise<void>;
	formatDateTime(date: Date): { date: string; time: string; datetime: string; iso: string };
	clearActiveCheckIn(noticeText?: string): Promise<void>;
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

export const WEATHER_CODES: Record<number, string> = {
	0: "Clear",
	1: "Mostly clear",
	2: "Partly cloudy",
	3: "Overcast",
	45: "Foggy",
	48: "Foggy",
	51: "Light drizzle",
	53: "Drizzle",
	55: "Dense drizzle",
	61: "Light rain",
	63: "Rain",
	65: "Heavy rain",
	71: "Light snow",
	73: "Snow",
	75: "Heavy snow",
	77: "Snow grains",
	80: "Light showers",
	81: "Showers",
	82: "Heavy showers",
	85: "Light snow showers",
	86: "Snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm with hail",
	99: "Thunderstorm with hail",
};

export const BUILTIN_FORMATS: FormatOption[] = [
	{ id: "full", name: "Full", description: "Address, coordinates, map link" },
	{ id: "compact", name: "Compact", description: "Address with coordinates" },
	{ id: "coords", name: "Coordinates only", description: "GPS coordinates" },
];
