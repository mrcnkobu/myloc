import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";

type OutputFormat = "full" | "compact" | "coords" | "custom";
type MapProvider = "osm" | "google";
type TempUnit = "celsius" | "fahrenheit";

interface FrontmatterFields {
	location: boolean;
	address: boolean;
	datetime: boolean;
	weather: boolean;
}

interface MyLocSettings {
	format: OutputFormat;
	customTemplate: string;
	mapProvider: MapProvider;
	language: string;
	timezone: string;
	tempUnit: TempUnit;
	includeTimestamp: boolean;
	includeWeather: boolean;
	frontmatterFields: FrontmatterFields;
}

const DEFAULT_SETTINGS: MyLocSettings = {
	format: "full",
	customTemplate: "{address}\n{coords}\n{mapLink}",
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

export default class MyLocPlugin extends Plugin {
	settings: MyLocSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "insert-location",
			name: "Insert location",
			editorCallback: (editor: Editor) => {
				this.insertLocation(editor);
			},
		});

		this.addCommand({
			id: "insert-location-frontmatter",
			name: "Insert location as frontmatter",
			editorCallback: async () => {
				await this.insertFrontmatter(false);
			},
		});

		this.addCommand({
			id: "update-location-frontmatter",
			name: "Update note location",
			editorCallback: async () => {
				await this.insertFrontmatter(true);
			},
		});

		this.addRibbonIcon("map-pin", "Insert location", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				this.insertLocation(view.editor);
			} else {
				new Notice("Open a note to insert location");
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async insertLocation(editor: Editor) {
		const notice = new Notice("Getting location...", 0);

		try {
			const location = await this.getLocation();
			const text = await this.formatLocation(location);
			editor.replaceSelection(text);
			notice.hide();
			new Notice("Location inserted");
		} catch (error) {
			notice.hide();
			new Notice("Failed to get location");
		}
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
			const fields = this.settings.frontmatterFields;

			let address: AddressResult | null = null;
			let weather: WeatherResult | null = null;

			if (fields.address) {
				try {
					address = await this.reverseGeocode(location.latitude, location.longitude);
				} catch {}
			}

			if (fields.weather) {
				try {
					weather = await this.getWeather(location.latitude, location.longitude);
				} catch {}
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
		} catch (error) {
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

	private async formatLocation(location: LocationResult): Promise<string> {
		const coords = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
		const approx = location.isApproximate ? " (approximate)" : "";
		const mapUrl = this.getMapUrl(location.latitude, location.longitude);
		const { date, time, datetime } = this.formatDateTime(new Date());

		let address: AddressResult | null = null;
		let weather: WeatherResult | null = null;

		if (this.settings.format !== "coords") {
			try {
				address = await this.reverseGeocode(location.latitude, location.longitude);
			} catch {}
		}

		const needsWeather = this.settings.includeWeather ||
			(this.settings.format === "custom" && /\{(weather|temp)\}/.test(this.settings.customTemplate));
		if (needsWeather) {
			try {
				weather = await this.getWeather(location.latitude, location.longitude);
			} catch {}
		}

		const weatherStr = weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : "";
		const tempStr = weather ? `${weather.temperature}${weather.unit}` : "";

		if (this.settings.format === "custom") {
			return this.applyTemplate(this.settings.customTemplate, {
				lat: location.latitude.toFixed(6),
				lon: location.longitude.toFixed(6),
				coords: coords + approx,
				address: address?.display || "",
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

		if (this.settings.format === "coords") {
			let result = coords + approx;
			if (this.settings.includeTimestamp) result += ` — ${datetime}`;
			if (weather) result += ` — ${weatherStr}`;
			return result;
		}

		if (this.settings.format === "compact") {
			let result = address ? `${address.display} (${coords})${approx}` : coords + approx;
			if (this.settings.includeTimestamp) result += ` — ${datetime}`;
			if (weather) result += ` — ${weatherStr}`;
			return result;
		}

		// Full format
		const lines: string[] = [];
		if (address) lines.push(address.display);
		lines.push(coords + approx);
		if (this.settings.includeTimestamp) lines.push(datetime);
		if (weather) lines.push(weatherStr);
		lines.push(`[Open in Map](${mapUrl})`);
		return lines.join("\n");
	}

	private applyTemplate(template: string, values: Record<string, string>): string {
		return template.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
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
				(error) => {
					reject(error);
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
		const symbol = this.settings.tempUnit === "fahrenheit" ? "°F" : "°C";

		return {
			temperature: Math.round(current.temperature),
			unit: symbol,
			description: WEATHER_CODES[current.weathercode] || "Unknown",
		};
	}

	onunload() {}
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
		containerEl.createEl("h3", { text: "Output" });

		new Setting(containerEl)
			.setName("Format")
			.setDesc("How the location is formatted when inserted")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("full", "Full (address, coords, map link)")
					.addOption("compact", "Compact (address with coords)")
					.addOption("coords", "Coordinates only")
					.addOption("custom", "Custom template")
					.setValue(this.plugin.settings.format)
					.onChange(async (value: OutputFormat) => {
						this.plugin.settings.format = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.format === "custom") {
			new Setting(containerEl)
				.setName("Custom template")
				.setDesc("Placeholders: {lat}, {lon}, {coords}, {address}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {weather}, {temp}")
				.addTextArea((text) =>
					text
						.setValue(this.plugin.settings.customTemplate)
						.onChange(async (value) => {
							this.plugin.settings.customTemplate = value;
							await this.plugin.saveSettings();
						})
				);
		}

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
			previewEl.style.marginTop = "8px";
			previewEl.style.fontFamily = "monospace";
			previewEl.style.opacity = "0.8";

			const updatePreview = () => {
				try {
					const { datetime } = this.plugin.formatDateTime(new Date());
					previewEl.textContent = `Current time: ${datetime}`;
					previewEl.style.color = "";
				} catch {
					previewEl.textContent = "Invalid timezone";
					previewEl.style.color = "var(--text-error)";
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
					.addOption("celsius", "Celsius (°C)")
					.addOption("fahrenheit", "Fahrenheit (°F)")
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

		// Frontmatter settings
		containerEl.createEl("h3", { text: "Frontmatter" });

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
