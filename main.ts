import { Editor, MarkdownView, Notice, Platform, Plugin, requestUrl } from "obsidian";
import {
	AddressResult,
	CheckInState,
	DEFAULT_SETTINGS,
	LocationNote,
	LocationResult,
	MyLocSettings,
	SavedPlace,
	WeatherResult,
} from "./types";
import { formatDuration, generateId, getSystemTimezone, sanitizeFilename } from "./utils";
import {
	FormatPickerModal,
	LocationNotePickerModal,
	MyLocSettingTab,
	SavePlaceModal,
	SavedPlacePickerModal,
} from "./ui";
import { LocationService } from "./location-service";
import { NoteService } from "./note-service";

export default class MyLocPlugin extends Plugin {
	settings: MyLocSettings;
	activeCheckIn: CheckInState | null = null;
	private locationService!: LocationService;
	private noteService!: NoteService;

	async onload() {
		await this.loadSettings();
		this.locationService = new LocationService(
			this.app,
			() => this.settings,
			(date) => this.formatDateTime(date),
			() => this.getTimezone(),
			{
				isMobile: Platform.isMobile,
				requestUrl,
				openSavedPlacePicker: (matches) =>
					new Promise((resolve) => {
						new SavedPlacePickerModal(this.app, matches, (place) => resolve(place)).open();
					}),
			}
		);
		this.noteService = new NoteService(this.app);

		this.addCommand({
			id: "insert-location",
			name: "Insert location (quick)",
			editorCallback: (editor: Editor) => {
				void this.insertLocation(editor, "quick");
			},
		});

		this.addCommand({
			id: "insert-location-choose-format",
			name: "Insert location (choose format)",
			editorCallback: (editor: Editor) => {
				void this.insertLocation(editor, "choose");
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
						const location = await this.locationService.getLocation();
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

		this.addCommand({
			id: "check-in",
			name: "Check in",
			callback: () => {
				void this.checkIn();
			},
		});

		this.addCommand({
			id: "check-out",
			name: "Check out",
			callback: () => {
				void this.checkOut();
			},
		});

		this.addCommand({
			id: "clear-active-check-in",
			name: "Clear active check-in",
			callback: () => {
				void this.clearActiveCheckIn();
			},
		});

		this.addRibbonIcon("map-pin", "Insert location", async () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note to insert location");
				return;
			}
			await this.insertLocation(view.editor, "quick");
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
		this.settings.checkin = Object.assign(
			{},
			DEFAULT_SETTINGS.checkin,
			loaded?.checkin
		);
		this.settings.privacy = Object.assign(
			{},
			DEFAULT_SETTINGS.privacy,
			loaded?.privacy
		);
		this.activeCheckIn = loaded?.activeCheckIn || null;

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
				delete (this.settings as MyLocSettings & { customTemplate?: string }).customTemplate;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData({ ...this.settings, activeCheckIn: this.activeCheckIn });
	}

	private async insertLocation(editor: Editor, mode: "quick" | "choose") {
		const notice = new Notice("Getting location...", 0);
		try {
			const location = await this.locationService.getLocation();
			const place = await this.locationService.resolvePlace(location);
			notice.hide();

			if (place) {
				const text = await this.formatLocation(location, place);
				editor.replaceSelection(text);
				new Notice("Location inserted");
				return;
			}

			if (mode === "quick") {
				const text = await this.formatLocation(location, this.settings.format);
				editor.replaceSelection(text);
				new Notice("Location inserted");
				return;
			}

			new FormatPickerModal(this.app, this.settings.customTemplates, (formatId) => {
				void this.formatLocation(location, formatId).then((text) => {
					editor.replaceSelection(text);
					new Notice("Location inserted");
				}).catch(() => {
					new Notice("Failed to format location");
				});
			}).open();
		} catch (error) {
			notice.hide();
			new Notice(error instanceof Error ? error.message : "Failed to get location");
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
			const location = await this.locationService.getLocation();
			const place = await this.locationService.resolvePlace(location);
			const fields = this.settings.frontmatterFields;

			let address: AddressResult | null = null;
			let weather: WeatherResult | null = null;

			if (fields.address) {
				if (place) {
					address = { display: place.name };
				} else {
					try {
						address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
					} catch {
						// Geocoding may fail due to network or rate limits
					}
				}
			}

			if (fields.weather) {
				try {
						weather = await this.locationService.getWeather(location.latitude, location.longitude);
				} catch {
					// Weather fetch may fail due to network issues
				}
			}

			const status = await this.noteService.upsertFrontmatterLocation(file, {
				update,
				location,
				fields,
				address: address?.display || null,
				datetime: fields.datetime ? this.formatDateTime(new Date()).iso : undefined,
				weather: fields.weather && weather ? `${weather.temperature}${weather.unit}, ${weather.description}` : null,
			});

			if (status === "exists") {
				notice.hide();
				new Notice("Location already exists. Use 'update note location' to replace.");
				return;
			}

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
		// If a SavedPlace is passed, use its template with the place name as address
		if (formatIdOrPlace && typeof formatIdOrPlace !== "string") {
			const place = formatIdOrPlace;
			const weather = await this.locationService.maybeGetWeatherForTemplate(location, place.template);
			return this.locationService.applyTemplate(place.template, this.locationService.buildTemplateContext(location, {
				placeName: place.name,
				weather,
			}));
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
				address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
			} catch {
				// Geocoding may fail due to network or rate limits
			}
		}

		const needsWeather = this.settings.includeWeather ||
			(customTemplate && /\{(weather|temp)\}/.test(customTemplate.template));
		if (needsWeather) {
			try {
				weather = await this.locationService.getWeather(location.latitude, location.longitude);
			} catch {
				// Weather fetch may fail due to network issues
			}
		}

		const context = this.locationService.buildTemplateContext(location, { address, weather });

		if (customTemplate) {
			return this.locationService.applyTemplate(customTemplate.template, context);
		}

		if (id === "coords") {
			let result = context.coords;
			if (this.settings.includeTimestamp) result += ` \u2014 ${context.datetime}`;
			if (weather) result += ` \u2014 ${context.weather}`;
			return result;
		}

		if (id === "compact") {
			const exactCoords = this.locationService.getCoordsString(location, false);
			let result = address ? `${address.display} (${exactCoords})${location.isApproximate ? " (approximate)" : ""}` : context.coords;
			if (this.settings.includeTimestamp) result += ` \u2014 ${context.datetime}`;
			if (weather) result += ` \u2014 ${context.weather}`;
			return result;
		}

		// Full format (also fallback for unknown IDs)
		const lines: string[] = [];
		if (address) lines.push(address.display);
		lines.push(context.coords);
		if (this.settings.includeTimestamp) lines.push(context.datetime);
		if (weather) lines.push(context.weather);
		lines.push(context.mapLink);
		return lines.join("\n");
	}

	async clearActiveCheckIn(noticeText = "Active check-in cleared") {
		if (!this.activeCheckIn) {
			new Notice("No active check-in");
			return;
		}

		this.activeCheckIn = null;
		await this.saveSettings();
		new Notice(noticeText);
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
			location = await this.locationService.getLocation();
		} catch {
			notice.hide();
			new Notice("Failed to get location");
			return;
		}

		const place = await this.locationService.resolvePlace(location);

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

		let address: AddressResult | null = null;
		const allTemplates = [noteConfig.directory, noteConfig.filenameTemplate, templateContent, noteConfig.linkTemplate].join("\n");
		const needsAddress = /\{(address|city|country)\}/.test(allTemplates);
		const needsWeather = /\{(weather|temp)\}/.test(allTemplates);

		if (place) {
			address = { display: place.name, city: undefined, country: undefined };
		} else if (needsAddress) {
			try {
				address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
			} catch {
				notice.hide();
				new Notice("Geocoding failed, cannot resolve address placeholders");
				return;
			}
		}

		let weather: WeatherResult | null = null;
		if (needsWeather) {
			try {
				weather = await this.locationService.getWeather(location.latitude, location.longitude);
			} catch {
				// Weather fetch may fail
			}
		}

		const placeholders: Record<string, string> = this.locationService.buildTemplateContext(location, {
			address,
			placeName: place?.name,
			weather,
		});

		// Resolve directory and filename
		let dir: string;
		let filename: string;
		try {
			dir = this.locationService.normalizeVaultPath(this.locationService.applyTemplate(noteConfig.directory, placeholders));
			filename = sanitizeFilename(this.locationService.applyTemplate(noteConfig.filenameTemplate, placeholders).trim());
			if (!filename) {
				throw new Error("Location note filename cannot be empty");
			}
		} catch (error) {
			notice.hide();
			new Notice(error instanceof Error ? error.message : "Invalid location note path");
			return;
		}

		try {
			await this.locationService.ensureFolderExists(dir);
		} catch (error) {
			notice.hide();
			new Notice(error instanceof Error ? error.message : "Failed to create location note directory");
			return;
		}

		// Get unique path and create note
		const notePath = this.noteService.uniquePath(dir, filename);
		const noteTitle = notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
		const notePathNoExt = notePath.replace(/\.md$/, "");

		// Add note-specific placeholders
		placeholders["notePath"] = notePathNoExt;
		placeholders["noteTitle"] = noteTitle;

		const content = this.locationService.applyTemplate(templateContent, placeholders);
		await this.app.vault.create(notePath, content);

		// Insert link at cursor
		const linkText = this.locationService.applyTemplate(noteConfig.linkTemplate, placeholders);
		view.editor.replaceSelection(linkText);

		notice.hide();
		new Notice("Location note created");
	}

	private async checkIn() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Open a note to check in");
			return;
		}

		if (this.activeCheckIn) {
			new Notice("Already checked in. Check out first.");
			return;
		}

		const notice = new Notice("Getting location...", 0);
		let location: LocationResult;
		try {
			location = await this.locationService.getLocation();
		} catch {
			notice.hide();
			new Notice("Failed to get location");
			return;
		}

		const place = await this.locationService.resolvePlace(location);

		let address: AddressResult | null = null;
		if (place) {
			address = { display: place.name, city: undefined, country: undefined };
		} else {
			try {
				address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
			} catch {
				// Geocoding may fail
			}
		}

		const file = view.file;
		if (!file) {
			notice.hide();
			new Notice("No active file");
			return;
		}

		this.activeCheckIn = {
			timestamp: Date.now(),
			latitude: location.latitude,
			longitude: location.longitude,
			address: address?.display,
			city: address?.city,
			country: address?.country,
			place: place?.name,
			placeId: place?.id,
			notePath: file.path,
		};
		await this.saveSettings();

		// Use place's check-in template if defined, then place template, then global
		const template = (place?.checkinTemplate) || (place?.template) || this.settings.checkin.checkinTemplate;
		const weather = await this.locationService.maybeGetWeatherForTemplate(location, template);
		const text = this.locationService.applyTemplate(template, this.locationService.buildTemplateContext(location, {
			address,
			placeName: place?.name,
			weather,
			includeApproximate: false,
		}));

		await this.noteService.appendUnderHeading(file, this.settings.checkin.heading, text);
		notice.hide();
		new Notice("Checked in");
	}

	private async checkOut() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			new Notice("Open a note to check out");
			return;
		}

		if (!this.activeCheckIn) {
			new Notice("Not checked in. Check in first.");
			return;
		}

		const checkIn = this.activeCheckIn;
		const file = view.file;
		const sameNote = file.path === checkIn.notePath;
		const duration = Date.now() - checkIn.timestamp;
		const durationStr = formatDuration(duration, this.settings.checkin.durationFormat);

		const notice = new Notice("Checking out...", 0);
		const currentDetails = await this.locationService.resolveCurrentLocationDetails(checkIn);

		// Pick template: per-place checkout > same/different note global > fallback
		const checkinPlace = checkIn.placeId
			? this.settings.savedPlaces.find((p) => p.id === checkIn.placeId)
			: null;
		let template: string;
		if (checkinPlace?.checkoutTemplate) {
			template = checkinPlace.checkoutTemplate;
		} else if (sameNote) {
			template = this.settings.checkin.checkoutTemplate;
		} else {
			template = this.settings.checkin.checkoutTemplateOther;
		}

		// Check-in context placeholders
		const checkinDate = this.formatDateTime(new Date(checkIn.timestamp));
		const checkinNotePath = checkIn.notePath?.replace(/\.md$/, "") || "";
		const checkinNoteTitle = checkinNotePath.slice(checkinNotePath.lastIndexOf("/") + 1);

		const weather = await this.locationService.maybeGetWeatherForTemplate(currentDetails.location, template);
		const text = this.locationService.applyTemplate(template, {
			...this.locationService.buildTemplateContext(currentDetails.location, {
				address: currentDetails.address
					? { display: currentDetails.address, city: currentDetails.city, country: currentDetails.country }
					: null,
				placeName: currentDetails.placeName,
				weather,
				includeApproximate: false,
			}),
			duration: durationStr,
			checkinTime: checkinDate.time,
			checkinDate: checkinDate.date,
			checkinDatetime: checkinDate.datetime,
			checkinAddress: checkIn.address || "",
			checkinPlace: checkIn.place || "",
			checkinNote: checkinNotePath ? `[[${checkinNotePath}|${checkinNoteTitle}]]` : "",
		});

		await this.noteService.appendUnderHeading(file, this.settings.checkin.heading, text);

		this.activeCheckIn = null;
		await this.saveSettings();

		notice.hide();
		new Notice(`Checked out (${durationStr})`);
	}

	onunload() {
		// No cleanup needed
	}
}
