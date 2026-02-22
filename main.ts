import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, requestUrl } from "obsidian";

type MapProvider = "osm" | "google";
type TempUnit = "celsius" | "fahrenheit";

interface NamedTemplate {
	id: string;
	name: string;
	template: string;
}

interface SavedPlace {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	radius: number;
	template: string;
}

interface LocationNote {
	id: string;
	name: string;
	directory: string;
	filenameTemplate: string;
	templatePath: string;
	linkTemplate: string;
}

interface FrontmatterFields {
	location: boolean;
	address: boolean;
	datetime: boolean;
	weather: boolean;
}

interface MyLocSettings {
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
}

const DEFAULT_SETTINGS: MyLocSettings = {
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
};

interface LocationResult {
	latitude: number;
	longitude: number;
	accuracy: number;
	isApproximate: boolean;
}

interface AddressResult {
	display: string;
	city?: string;
	country?: string;
}

interface WeatherResult {
	temperature: number;
	unit: string;
	description: string;
}

const TIMEZONES: string[] = [
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

function getSystemTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371000;
	const toRad = (deg: number) => deg * Math.PI / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const WEATHER_CODES: Record<number, string> = {
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

function formatDatePattern(date: Date, pattern: string, timezone: string): string {
	const parts: Record<string, string> = {};
	const get = (opts: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(date);

	const year = get({ year: "numeric" });
	const month = get({ month: "2-digit" });
	const day = get({ day: "2-digit" });
	const hour = get({ hour: "2-digit", hour12: false });
	const minute = get({ minute: "2-digit" });
	const second = get({ second: "2-digit" });

	parts["yyyy"] = year;
	parts["yy"] = year.slice(-2);
	parts["MM"] = month;
	parts["M"] = String(parseInt(month));
	parts["dd"] = day;
	parts["d"] = String(parseInt(day));
	parts["HH"] = hour.padStart(2, "0");
	parts["H"] = String(parseInt(hour));
	parts["mm"] = minute.padStart(2, "0");
	parts["m"] = String(parseInt(minute));
	parts["ss"] = second.padStart(2, "0");
	parts["s"] = String(parseInt(second));

	// Replace longest tokens first to avoid partial matches
	let result = pattern;
	for (const token of ["yyyy", "yy", "MM", "M", "dd", "d", "HH", "H", "mm", "m", "ss", "s"]) {
		result = result.split(token).join(parts[token]);
	}
	return result;
}

function sanitizeFilename(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "");
}

function generateId(): string {
	try {
		return crypto.randomUUID().slice(0, 8);
	} catch {
		return Date.now().toString(36);
	}
}

interface FormatOption {
	id: string;
	name: string;
	description: string;
}

const BUILTIN_FORMATS: FormatOption[] = [
	{ id: "full", name: "Full", description: "Address, coordinates, map link" },
	{ id: "compact", name: "Compact", description: "Address with coordinates" },
	{ id: "coords", name: "Coordinates only", description: "GPS coordinates" },
];

export default class MyLocPlugin extends Plugin {
	settings: MyLocSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "insert-location",
			name: "Insert location",
			editorCallback: (editor: Editor) => {
				const notice = new Notice("Getting location...", 0);
				void (async () => {
					try {
						const location = await this.getLocation();
						const place = await this.resolvePlace(location);
						notice.hide();
						if (place) {
							const text = await this.formatLocation(location, place);
							editor.replaceSelection(text);
							new Notice("Location inserted");
						} else {
							new FormatPickerModal(this.app, this.settings.customTemplates, (formatId) => {
								void this.formatLocation(location, formatId).then((text) => {
									editor.replaceSelection(text);
									new Notice("Location inserted");
								});
							}).open();
						}
					} catch {
						notice.hide();
						new Notice("Failed to get location");
					}
				})();
			},
		});

		this.addCommand({
			id: "insert-location-frontmatter",
			name: "Insert location as frontmatter",
			editorCallback: () => {
				void this.insertFrontmatter(false);
			},
		});

		this.addCommand({
			id: "update-location-frontmatter",
			name: "Update note location",
			editorCallback: () => {
				void this.insertFrontmatter(true);
			},
		});

		this.addCommand({
			id: "insert-location-note",
			name: "Insert location as new note",
			callback: () => {
				void this.createLocationNote();
			},
		});

		this.addCommand({
			id: "save-current-location",
			name: "Save current location as place",
			callback: () => {
				const notice = new Notice("Getting location...", 0);
				void (async () => {
					try {
						const location = await this.getLocation();
						notice.hide();
						new SavePlaceModal(this.app, (name) => {
							const place: SavedPlace = {
								id: generateId(),
								name,
								latitude: location.latitude,
								longitude: location.longitude,
								radius: 200,
								template: "{place}\n{coords}",
							};
							this.settings.savedPlaces.push(place);
							void this.saveSettings().then(() => {
								new Notice("Place saved \u2014 customize in settings");
							});
						}).open();
					} catch {
						notice.hide();
						new Notice("Failed to get location");
					}
				})();
			},
		});

		this.addRibbonIcon("map-pin", "Insert location", async () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note to insert location");
				return;
			}
			const notice = new Notice("Getting location...", 0);
			try {
				const location = await this.getLocation();
				const place = await this.resolvePlace(location);
				notice.hide();
				if (place) {
					const text = await this.formatLocation(location, place);
					view.editor.replaceSelection(text);
					new Notice("Location inserted");
				} else {
					const text = await this.formatLocation(location, this.settings.format);
					view.editor.replaceSelection(text);
					new Notice("Location inserted");
				}
			} catch {
				notice.hide();
				new Notice("Failed to get location");
			}
		});

		this.addSettingTab(new MyLocSettingTab(this.app, this));
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.frontmatterFields = Object.assign(
			{},
			DEFAULT_SETTINGS.frontmatterFields,
			loaded?.frontmatterFields
		);

		// Migrate old customTemplate to customTemplates array
		if (loaded && "customTemplate" in loaded && !Array.isArray(loaded.customTemplates)) {
			const oldTemplate = loaded.customTemplate as string;
			if (oldTemplate) {
				const id = generateId();
				this.settings.customTemplates = [{ id, name: "Custom", template: oldTemplate }];
				if (this.settings.format === "custom") {
					this.settings.format = id;
				}
			} else {
				this.settings.customTemplates = [];
			}
			if (this.settings.format === "custom") {
				this.settings.format = "full";
			}
			delete (this.settings as Record<string, unknown>)["customTemplate"];
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async insertFrontmatter(update: boolean) {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}

		const notice = new Notice("Getting location...", 0);

		try {
			const location = await this.getLocation();
			const place = await this.resolvePlace(location);
			const fields = this.settings.frontmatterFields;

			let address: AddressResult | null = null;
			let weather: WeatherResult | null = null;

			if (fields.address) {
				if (place) {
					address = { display: place.name };
				} else {
					try {
						address = await this.reverseGeocode(location.latitude, location.longitude);
					} catch {
						// Geocoding may fail due to network or rate limits
					}
				}
			}

			if (fields.weather) {
				try {
					weather = await this.getWeather(location.latitude, location.longitude);
				} catch {
					// Weather fetch may fail due to network issues
				}
			}

			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (!update && frontmatter.location) {
					notice.hide();
					new Notice("Location already exists. Use 'Update note location' to replace.");
					return;
				}

				if (fields.location) {
					frontmatter.location = [
						parseFloat(location.latitude.toFixed(6)),
						parseFloat(location.longitude.toFixed(6)),
					];
				}

				if (fields.address && address) {
					frontmatter.address = address.display;
				}

				if (fields.datetime) {
					frontmatter.datetime = this.formatDateTime(new Date()).iso;
				}

				if (fields.weather && weather) {
					frontmatter.weather = `${weather.temperature}${weather.unit}, ${weather.description}`;
				}
			});

			notice.hide();
			new Notice(update ? "Location updated" : "Location added to frontmatter");
		} catch {
			notice.hide();
			new Notice("Failed to get location");
		}
	}

	getTimezone(): string {
		return this.settings.timezone || getSystemTimezone();
	}

	formatDateTime(date: Date): { date: string; time: string; datetime: string; iso: string } {
		const tz = this.getTimezone();
		const dateStr = date.toLocaleDateString(undefined, { timeZone: tz });
		const timeStr = date.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			timeZone: tz,
		});
		const isoStr = date.toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T");
		return {
			date: dateStr,
			time: timeStr,
			datetime: `${dateStr} ${timeStr}`,
			iso: isoStr,
		};
	}

	private async formatLocation(location: LocationResult, formatIdOrPlace?: string | SavedPlace): Promise<string> {
		const coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
		const approx = location.isApproximate ? " (approximate)" : "";
		const mapUrl = this.getMapUrl(location.latitude, location.longitude);
		const { date, time, datetime } = this.formatDateTime(new Date());

		// If a SavedPlace is passed, use its template with the place name as address
		if (formatIdOrPlace && typeof formatIdOrPlace !== "string") {
			const place = formatIdOrPlace;
			let weather: WeatherResult | null = null;
			if (/\{(weather|temp)\}/.test(place.template)) {
				try {
					weather = await this.getWeather(location.latitude, location.longitude);
				} catch {
					// Weather fetch may fail due to network issues
				}
			}
			const weatherStr = weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : "";
			const tempStr = weather ? `${weather.temperature}${weather.unit}` : "";
			return this.applyTemplate(place.template, {
				lat: location.latitude.toFixed(6),
				lon: location.longitude.toFixed(6),
				coords: coords + approx,
				address: place.name,
				place: place.name,
				city: "",
				country: "",
				mapUrl,
				mapLink: `[Open in Map](${mapUrl})`,
				date,
				time,
				datetime,
				weather: weatherStr,
				temp: tempStr,
			});
		}

		const id = (formatIdOrPlace as string) || this.settings.format;

		let address: AddressResult | null = null;
		let weather: WeatherResult | null = null;

		// Look up custom template if not a built-in format
		const customTemplate = !["full", "compact", "coords"].includes(id)
			? this.settings.customTemplates.find((t) => t.id === id)
			: null;

		if (id !== "coords") {
			try {
				address = await this.reverseGeocode(location.latitude, location.longitude);
			} catch {
				// Geocoding may fail due to network or rate limits
			}
		}

		const needsWeather = this.settings.includeWeather ||
			(customTemplate && /\{(weather|temp)\}/.test(customTemplate.template));
		if (needsWeather) {
			try {
				weather = await this.getWeather(location.latitude, location.longitude);
			} catch {
				// Weather fetch may fail due to network issues
			}
		}

		const weatherStr = weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : "";
		const tempStr = weather ? `${weather.temperature}${weather.unit}` : "";

		if (customTemplate) {
			return this.applyTemplate(customTemplate.template, {
				lat: location.latitude.toFixed(6),
				lon: location.longitude.toFixed(6),
				coords: coords + approx,
				address: address?.display || "",
				place: "",
				city: address?.city || "",
				country: address?.country || "",
				mapUrl,
				mapLink: `[Open in Map](${mapUrl})`,
				date,
				time,
				datetime,
				weather: weatherStr,
				temp: tempStr,
			});
		}

		if (id === "coords") {
			let result = coords + approx;
			if (this.settings.includeTimestamp) result += ` \u2014 ${datetime}`;
			if (weather) result += ` \u2014 ${weatherStr}`;
			return result;
		}

		if (id === "compact") {
			let result = address ? `${address.display} (${coords})${approx}` : coords + approx;
			if (this.settings.includeTimestamp) result += ` \u2014 ${datetime}`;
			if (weather) result += ` \u2014 ${weatherStr}`;
			return result;
		}

		// Full format (also fallback for unknown IDs)
		const lines: string[] = [];
		if (address) lines.push(address.display);
		lines.push(coords + approx);
		if (this.settings.includeTimestamp) lines.push(datetime);
		if (weather) lines.push(weatherStr);
		lines.push(`[Open in Map](${mapUrl})`);
		return lines.join("\n");
	}

	private applyTemplate(template: string, values: Record<string, string>): string {
		// First resolve {date:FORMAT} patterns
		const tz = this.getTimezone();
		let result = template.replace(/\{date:([^}]+)\}/g, (_, pattern) =>
			formatDatePattern(new Date(), pattern, tz)
		);
		// Then resolve simple {key} placeholders
		result = result.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
		return result;
	}

	private getMapUrl(lat: number, lon: number): string {
		if (this.settings.mapProvider === "google") {
			return `https://www.google.com/maps?q=${lat},${lon}`;
		}
		return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
	}

	private async getLocation(): Promise<LocationResult> {
		try {
			return await this.getGPSLocation();
		} catch {
			return await this.getIPLocation();
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
		const response = await requestUrl({
			url: "http://ip-api.com/json/?fields=lat,lon,status,message",
			method: "GET",
		});

		const data = response.json;

		if (data.status === "fail") {
			throw new Error(data.message || "IP geolocation failed");
		}

		return {
			latitude: data.lat,
			longitude: data.lon,
			accuracy: 5000,
			isApproximate: true,
		};
	}

	private async reverseGeocode(lat: number, lon: number): Promise<AddressResult> {
		const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

		const headers: Record<string, string> = {
			"User-Agent": "ObsidianMyLocPlugin/0.1.0",
		};

		if (this.settings.language) {
			headers["Accept-Language"] = this.settings.language;
		}

		const response = await requestUrl({ url, method: "GET", headers });
		const data = response.json;

		if (data.error) {
			throw new Error(data.error);
		}

		return {
			display: data.display_name,
			city: data.address?.city || data.address?.town || data.address?.village,
			country: data.address?.country,
		};
	}

	private async getWeather(lat: number, lon: number): Promise<WeatherResult> {
		const unit = this.settings.tempUnit === "fahrenheit" ? "fahrenheit" : "celsius";
		const response = await requestUrl({
			url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${unit}`,
			method: "GET",
		});

		const data = response.json;
		const current = data.current_weather;
		const symbol = this.settings.tempUnit === "fahrenheit" ? "\u00b0F" : "\u00b0C";

		return {
			temperature: Math.round(current.temperature),
			unit: symbol,
			description: WEATHER_CODES[current.weathercode] || "Unknown",
		};
	}

	private findMatchingPlaces(location: LocationResult): { place: SavedPlace; distance: number }[] {
		return this.settings.savedPlaces
			.map((place) => ({
				place,
				distance: haversineDistance(location.latitude, location.longitude, place.latitude, place.longitude),
			}))
			.filter((m) => m.distance <= m.place.radius)
			.sort((a, b) => a.distance - b.distance);
	}

	private async resolvePlace(location: LocationResult): Promise<SavedPlace | null> {
		const matches = this.findMatchingPlaces(location);
		if (matches.length === 0) return null;
		return new Promise((resolve) => {
			new SavedPlacePickerModal(this.app, matches, (place) => resolve(place)).open();
		});
	}

	private async uniquePath(dir: string, basename: string): Promise<string> {
		const path = `${dir}/${basename}.md`;
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${dir}/${basename} (${n}).md`)) {
			n++;
		}
		return `${dir}/${basename} (${n}).md`;
	}

	private async createLocationNote() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Open a note to insert a location note link");
			return;
		}

		if (this.settings.locationNotes.length === 0) {
			new Notice("No location notes configured. Add one in settings.");
			return;
		}

		const notice = new Notice("Getting location...", 0);
		let location: LocationResult;
		try {
			location = await this.getLocation();
		} catch {
			notice.hide();
			new Notice("Failed to get location");
			return;
		}

		const place = await this.resolvePlace(location);

		// Pick location note config (or use the only one)
		let noteConfig: LocationNote;
		if (this.settings.locationNotes.length === 1) {
			noteConfig = this.settings.locationNotes[0];
		} else {
			try {
				noteConfig = await new Promise<LocationNote>((resolve, reject) => {
					new LocationNotePickerModal(this.app, this.settings.locationNotes, (picked) => {
						if (picked) resolve(picked);
						else reject(new Error("cancelled"));
					}).open();
				});
			} catch {
				notice.hide();
				return; // User cancelled
			}
		}

		// Read template file
		const templateFile = this.app.vault.getAbstractFileByPath(noteConfig.templatePath);
		if (!templateFile || !("stat" in templateFile)) {
			notice.hide();
			new Notice(`Template file not found: ${noteConfig.templatePath}`);
			return;
		}
		const templateContent = await this.app.vault.read(templateFile as import("obsidian").TFile);

		// Gather data for placeholders
		const coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
		const approx = location.isApproximate ? " (approximate)" : "";
		const mapUrl = this.getMapUrl(location.latitude, location.longitude);
		const { date, time, datetime } = this.formatDateTime(new Date());

		let address: AddressResult | null = null;
		const allTemplates = [noteConfig.directory, noteConfig.filenameTemplate, templateContent, noteConfig.linkTemplate].join("\n");
		const needsAddress = /\{(address|city|country)\}/.test(allTemplates);
		const needsWeather = /\{(weather|temp)\}/.test(allTemplates);

		if (place) {
			address = { display: place.name, city: undefined, country: undefined };
		} else if (needsAddress) {
			try {
				address = await this.reverseGeocode(location.latitude, location.longitude);
			} catch {
				notice.hide();
				new Notice("Geocoding failed, cannot resolve address placeholders");
				return;
			}
		}

		let weather: WeatherResult | null = null;
		if (needsWeather) {
			try {
				weather = await this.getWeather(location.latitude, location.longitude);
			} catch {
				// Weather fetch may fail
			}
		}

		const weatherStr = weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : "";
		const tempStr = weather ? `${weather.temperature}${weather.unit}` : "";

		const placeholders: Record<string, string> = {
			lat: location.latitude.toFixed(6),
			lon: location.longitude.toFixed(6),
			coords: coords + approx,
			address: address?.display || "",
			place: place?.name || "",
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

		// Resolve directory and filename
		const dir = this.applyTemplate(noteConfig.directory, placeholders).replace(/\/+$/, "");
		const filename = sanitizeFilename(this.applyTemplate(noteConfig.filenameTemplate, placeholders));

		// Create directory if missing
		if (!this.app.vault.getAbstractFileByPath(dir)) {
			try {
				await this.app.vault.createFolder(dir);
			} catch {
				// Folder may already exist from race condition
			}
		}

		// Get unique path and create note
		const notePath = await this.uniquePath(dir, filename);
		const noteTitle = notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
		const notePathNoExt = notePath.replace(/\.md$/, "");

		// Add note-specific placeholders
		placeholders["notePath"] = notePathNoExt;
		placeholders["noteTitle"] = noteTitle;

		const content = this.applyTemplate(templateContent, placeholders);
		await this.app.vault.create(notePath, content);

		// Insert link at cursor
		const linkText = this.applyTemplate(noteConfig.linkTemplate, placeholders);
		view.editor.replaceSelection(linkText);

		notice.hide();
		new Notice("Location note created");
	}

	onunload() {
		// No cleanup needed
	}
}

interface PlacePickerOption {
	place: SavedPlace | null;
	name: string;
	description: string;
}

class SavedPlacePickerModal extends SuggestModal<PlacePickerOption> {
	private onChoose: (place: SavedPlace | null) => void;
	private options: PlacePickerOption[];

	constructor(
		app: App,
		matches: { place: SavedPlace; distance: number }[],
		onChoose: (place: SavedPlace | null) => void
	) {
		super(app);
		this.onChoose = onChoose;
		this.options = [
			...matches.map((m) => ({
				place: m.place,
				name: m.place.name,
				description: `${Math.round(m.distance)}m away`,
			})),
			{ place: null, name: "Use detected location", description: "Skip saved places" },
		];
	}

	getSuggestions(query: string): PlacePickerOption[] {
		const lower = query.toLowerCase();
		return this.options.filter(
			(o) => o.name.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(option: PlacePickerOption, el: HTMLElement): void {
		el.createEl("div", { text: option.name });
		el.createEl("small", { text: option.description, cls: "mod-muted" });
	}

	onChooseSuggestion(option: PlacePickerOption): void {
		this.onChoose(option.place);
	}
}

class SavePlaceModal extends Modal {
	private onSave: (name: string) => void;

	constructor(app: App, onSave: (name: string) => void) {
		super(app);
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Save place" });

		let name = "";
		new Setting(contentEl)
			.setName("Place name")
			.addText((text) =>
				text.setPlaceholder("e.g. Home, Work, Gym").onChange((value) => {
					name = value.trim();
				})
			);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Save").setCta().onClick(() => {
				if (name) {
					this.onSave(name);
					this.close();
				} else {
					new Notice("Enter a name for this place");
				}
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class FormatPickerModal extends SuggestModal<FormatOption> {
	private onChoose: (formatId: string) => void;
	private options: FormatOption[];

	constructor(app: App, customTemplates: NamedTemplate[], onChoose: (formatId: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.options = [
			...BUILTIN_FORMATS,
			...customTemplates.map((t) => ({
				id: t.id,
				name: t.name,
				description: t.template.length > 60 ? t.template.slice(0, 60) + "\u2026" : t.template,
			})),
		];
	}

	getSuggestions(query: string): FormatOption[] {
		const lower = query.toLowerCase();
		return this.options.filter(
			(o) => o.name.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(option: FormatOption, el: HTMLElement): void {
		el.createEl("div", { text: option.name });
		el.createEl("small", { text: option.description, cls: "mod-muted" });
	}

	onChooseSuggestion(option: FormatOption): void {
		this.onChoose(option.id);
	}
}

class LocationNotePickerModal extends SuggestModal<LocationNote> {
	private onChoose: (note: LocationNote | null) => void;
	private notes: LocationNote[];
	private picked = false;

	constructor(app: App, notes: LocationNote[], onChoose: (note: LocationNote | null) => void) {
		super(app);
		this.notes = notes;
		this.onChoose = onChoose;
	}

	onClose(): void {
		if (!this.picked) this.onChoose(null);
	}

	getSuggestions(query: string): LocationNote[] {
		const lower = query.toLowerCase();
		return this.notes.filter((n) => n.name.toLowerCase().includes(lower));
	}

	renderSuggestion(note: LocationNote, el: HTMLElement): void {
		el.createEl("div", { text: note.name });
		el.createEl("small", { text: `${note.directory}/${note.filenameTemplate}`, cls: "mod-muted" });
	}

	onChooseSuggestion(note: LocationNote): void {
		this.picked = true;
		this.onChoose(note);
	}
}

class MyLocSettingTab extends PluginSettingTab {
	plugin: MyLocPlugin;
	private timezonePreviewInterval: number | null = null;

	constructor(app: App, plugin: MyLocPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.timezonePreviewInterval) {
			window.clearInterval(this.timezonePreviewInterval);
			this.timezonePreviewInterval = null;
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		if (this.timezonePreviewInterval) {
			window.clearInterval(this.timezonePreviewInterval);
			this.timezonePreviewInterval = null;
		}

		// Output settings
		new Setting(containerEl).setName("Output").setHeading();

		new Setting(containerEl)
			.setName("Default format")
			.setDesc("Format used by the ribbon icon")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("full", "Full (address, coords, map link)")
					.addOption("compact", "Compact (address with coords)")
					.addOption("coords", "Coordinates only");
				for (const t of this.plugin.settings.customTemplates) {
					dropdown.addOption(t.id, t.name);
				}
				// If the current format ID no longer exists, fall back to "full"
				const validIds = ["full", "compact", "coords", ...this.plugin.settings.customTemplates.map((t) => t.id)];
				if (!validIds.includes(this.plugin.settings.format)) {
					this.plugin.settings.format = "full";
					void this.plugin.saveSettings();
				}
				dropdown
					.setValue(this.plugin.settings.format)
					.onChange(async (value) => {
						this.plugin.settings.format = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Include timestamp")
			.setDesc("Add date and time to output")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeTimestamp)
					.onChange(async (value) => {
						this.plugin.settings.includeTimestamp = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.includeTimestamp || this.plugin.settings.frontmatterFields.datetime) {
			const systemTz = getSystemTimezone();
			const timezoneSetting = new Setting(containerEl)
				.setName("Timezone")
				.setDesc(`Select timezone for timestamps.`)
				.addDropdown((dropdown) => {
					dropdown.addOption("", `Auto (${systemTz})`);
					for (const tz of TIMEZONES) {
						dropdown.addOption(tz, tz);
					}
					dropdown
						.setValue(this.plugin.settings.timezone)
						.onChange(async (value) => {
							this.plugin.settings.timezone = value;
							await this.plugin.saveSettings();
							updatePreview();
						});
				});

			const previewEl = timezoneSetting.descEl.createDiv({ cls: "myloc-timezone-preview" });

			const updatePreview = () => {
				try {
					const { datetime } = this.plugin.formatDateTime(new Date());
					previewEl.textContent = `Current time: ${datetime}`;
					previewEl.removeClass("myloc-error");
				} catch {
					previewEl.textContent = "Invalid timezone";
					previewEl.addClass("myloc-error");
				}
			};

			updatePreview();
			this.timezonePreviewInterval = window.setInterval(updatePreview, 1000);
		}

		new Setting(containerEl)
			.setName("Include weather")
			.setDesc("Add current weather from Open-Meteo")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeWeather)
					.onChange(async (value) => {
						this.plugin.settings.includeWeather = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Temperature unit")
			.setDesc("Unit for temperature display")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("celsius", "Celsius (\u00b0C)")
					.addOption("fahrenheit", "Fahrenheit (\u00b0F)")
					.setValue(this.plugin.settings.tempUnit)
					.onChange(async (value: TempUnit) => {
						this.plugin.settings.tempUnit = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Map provider")
			.setDesc("Which map service to link to")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("osm", "OpenStreetMap")
					.addOption("google", "Google Maps")
					.setValue(this.plugin.settings.mapProvider)
					.onChange(async (value: MapProvider) => {
						this.plugin.settings.mapProvider = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Address language")
			.setDesc("Language code for addresses (e.g., en, pl, de). Leave empty for default.")
			.addText((text) =>
				text
					.setPlaceholder("en")
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Custom templates
		new Setting(containerEl).setName("Custom templates").setHeading();

		const placeholderHelp = "Placeholders: {lat}, {lon}, {coords}, {address}, {place}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {weather}, {temp}";

		for (let i = 0; i < this.plugin.settings.customTemplates.length; i++) {
			const tmpl = this.plugin.settings.customTemplates[i];

			new Setting(containerEl)
				.setName("Template name")
				.addText((text) =>
					text.setValue(tmpl.name).onChange(async (value) => {
						tmpl.name = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Delete template").onClick(async () => {
						this.plugin.settings.customTemplates.splice(i, 1);
						if (this.plugin.settings.format === tmpl.id) {
							this.plugin.settings.format = "full";
						}
						await this.plugin.saveSettings();
						this.display();
					})
				);

			new Setting(containerEl)
				.setDesc(placeholderHelp)
				.addTextArea((text) => {
					text.setValue(tmpl.template).onChange(async (value) => {
						tmpl.template = value;
						await this.plugin.saveSettings();
					});
					text.inputEl.rows = 4;
					text.inputEl.addClass("myloc-template-textarea");
				});
		}

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add template").onClick(async () => {
				this.plugin.settings.customTemplates.push({
					id: generateId(),
					name: "New template",
					template: "{address}\n{coords}\n{mapLink}",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

		// Saved places
		new Setting(containerEl).setName("Saved places").setHeading();

		for (let i = 0; i < this.plugin.settings.savedPlaces.length; i++) {
			const place = this.plugin.settings.savedPlaces[i];

			new Setting(containerEl)
				.setName("Place name")
				.addText((text) =>
					text.setValue(place.name).onChange(async (value) => {
						place.name = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Delete place").onClick(async () => {
						this.plugin.settings.savedPlaces.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);

			new Setting(containerEl)
				.setName("Coordinates")
				.setDesc(`${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`)
				.addText((text) =>
					text
						.setPlaceholder("200")
						.setValue(String(place.radius))
						.onChange(async (value) => {
							const num = parseInt(value);
							if (!isNaN(num) && num > 0) {
								place.radius = num;
								await this.plugin.saveSettings();
							}
						})
				)
				.then((setting) => {
					setting.controlEl.querySelector("input")?.setAttribute("type", "number");
					setting.nameEl.appendText(" \u2014 Radius (m):");
				});

			new Setting(containerEl)
				.setDesc(placeholderHelp)
				.addTextArea((text) => {
					text.setValue(place.template).onChange(async (value) => {
						place.template = value;
						await this.plugin.saveSettings();
					});
					text.inputEl.rows = 4;
					text.inputEl.addClass("myloc-place-textarea");
				});
		}

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add place").onClick(async () => {
				this.plugin.settings.savedPlaces.push({
					id: generateId(),
					name: "New place",
					latitude: 0,
					longitude: 0,
					radius: 200,
					template: "{place}\n{coords}",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

		// Location notes
		new Setting(containerEl).setName("Location notes").setHeading();

		const noteHelp = "Placeholders: {lat}, {lon}, {coords}, {address}, {place}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {date:FORMAT}, {weather}, {temp}, {notePath}, {noteTitle}";

		for (let i = 0; i < this.plugin.settings.locationNotes.length; i++) {
			const note = this.plugin.settings.locationNotes[i];

			new Setting(containerEl)
				.setName("Name")
				.addText((text) =>
					text.setPlaceholder("Travel log").setValue(note.name).onChange(async (value) => {
						note.name = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Delete location note").onClick(async () => {
						this.plugin.settings.locationNotes.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);

			new Setting(containerEl)
				.setName("Directory")
				.addText((text) =>
					text.setPlaceholder("Locations/{date:yyyy/MM}").setValue(note.directory).onChange(async (value) => {
						note.directory = value;
						await this.plugin.saveSettings();
					})
				);

			new Setting(containerEl)
				.setName("Filename template")
				.addText((text) =>
					text.setPlaceholder("location_{date:yyyy-MM-dd}").setValue(note.filenameTemplate).onChange(async (value) => {
						note.filenameTemplate = value;
						await this.plugin.saveSettings();
					})
				);

			new Setting(containerEl)
				.setName("Template file")
				.setDesc("Vault path to template note")
				.addText((text) =>
					text.setPlaceholder("Templates/location.md").setValue(note.templatePath).onChange(async (value) => {
						note.templatePath = value;
						await this.plugin.saveSettings();
					})
				);

			new Setting(containerEl)
				.setName("Link template")
				.setDesc(noteHelp)
				.addText((text) =>
					text.setPlaceholder("[[{notePath}]]").setValue(note.linkTemplate).onChange(async (value) => {
						note.linkTemplate = value;
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add location note").onClick(async () => {
				this.plugin.settings.locationNotes.push({
					id: generateId(),
					name: "New location note",
					directory: "Locations/{date:yyyy/MM}",
					filenameTemplate: "location_{date:yyyy-MM-dd}",
					templatePath: "Templates/location.md",
					linkTemplate: "[[{notePath}]]",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

		// Frontmatter settings
		new Setting(containerEl).setName("Frontmatter").setHeading();

		new Setting(containerEl)
			.setName("Include location")
			.setDesc("Add coordinates as location: [lat, lon]")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.frontmatterFields.location)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterFields.location = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include address")
			.setDesc("Add full address string")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.frontmatterFields.address)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterFields.address = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include datetime")
			.setDesc("Add timestamp")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.frontmatterFields.datetime)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterFields.datetime = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Include weather")
			.setDesc("Add current weather")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.frontmatterFields.weather)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterFields.weather = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
