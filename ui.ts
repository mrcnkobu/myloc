import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal } from "obsidian";
import {
	BUILTIN_FORMATS,
	CheckInState,
	DurationFormat,
	FormatOption,
	LocationNote,
	MapProvider,
	MyLocPluginUiApi,
	NamedTemplate,
	SavedPlace,
	TIMEZONES,
	TempUnit,
} from "./types";
import { generateId, getSystemTimezone } from "./utils";

interface PlacePickerOption {
	place: SavedPlace | null;
	name: string;
	description: string;
}

export class SavedPlacePickerModal extends SuggestModal<PlacePickerOption> {
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

export class SavePlaceModal extends Modal {
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
				text.setPlaceholder("Home, work, gym").onChange((value) => {
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

export class FormatPickerModal extends SuggestModal<FormatOption> {
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
				description: t.template.length > 60 ? t.template.slice(0, 60) + "…" : t.template,
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

export class LocationNotePickerModal extends SuggestModal<LocationNote> {
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

export class MyLocSettingTab extends PluginSettingTab {
	plugin: Plugin & MyLocPluginUiApi;
	private pendingSaveTimeout: number | null = null;

	constructor(app: App, plugin: Plugin & MyLocPluginUiApi) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.flushPendingSave();
	}

	private queueSettingsSave() {
		if (this.pendingSaveTimeout) {
			window.clearTimeout(this.pendingSaveTimeout);
		}

		this.pendingSaveTimeout = window.setTimeout(() => {
			this.pendingSaveTimeout = null;
			void this.plugin.saveSettings();
		}, 400);
	}

	private flushPendingSave() {
		if (this.pendingSaveTimeout) {
			window.clearTimeout(this.pendingSaveTimeout);
			this.pendingSaveTimeout = null;
		}
		void this.plugin.saveSettings();
	}

	private bindTextInput(
		text: import("obsidian").TextComponent,
		getValue: () => string,
		setValue: (value: string) => void
	) {
		text.setValue(getValue()).onChange((value) => {
			setValue(value);
			this.queueSettingsSave();
		});
		text.inputEl.addEventListener("blur", () => this.flushPendingSave());
	}

	private bindTextArea(
		text: import("obsidian").TextAreaComponent,
		getValue: () => string,
		setValue: (value: string) => void
	) {
		text.setValue(getValue()).onChange((value) => {
			setValue(value);
			this.queueSettingsSave();
		});
		text.inputEl.addEventListener("blur", () => this.flushPendingSave());
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Privacy").setHeading();
		containerEl.createEl("p", {
			text: "Control whether coordinates can be sent to external services for address lookup, weather, or approximate IP fallback.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Allow reverse geocoding")
			.setDesc("Send coordinates to resolve an address")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.privacy.allowReverseGeocoding)
					.onChange(async (value) => {
						this.plugin.settings.privacy.allowReverseGeocoding = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allow weather lookup")
			.setDesc("Send coordinates to fetch current weather")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.privacy.allowWeather)
					.onChange(async (value) => {
						this.plugin.settings.privacy.allowWeather = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allow approximate IP fallback")
			.setDesc("Use HTTPS IP geolocation when device geolocation is unavailable or denied")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.privacy.allowIpFallback)
					.onChange(async (value) => {
						this.plugin.settings.privacy.allowIpFallback = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Output").setHeading();
		containerEl.createEl("p", {
			text: "Configure how location data is formatted when inserted into notes.",
			cls: "setting-item-description",
		});

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
				.setDesc("Select timezone for timestamps.")
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
		}

		new Setting(containerEl)
			.setName("Include weather")
			.setDesc("Add current weather information")
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
					.addOption("celsius", "Celsius")
					.addOption("fahrenheit", "Fahrenheit")
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
					.addOption("osm", "Openstreetmap")
					.addOption("google", "Google maps")
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
				this.bindTextInput(text, () => this.plugin.settings.language, (value) => {
					this.plugin.settings.language = value.trim();
				})
			);

		new Setting(containerEl).setName("Custom templates").setHeading();
		containerEl.createEl("p", {
			text: "Define reusable templates with placeholders for location data. Available as output format options.",
			cls: "setting-item-description",
		});

		const placeholderHelp = "Placeholders: {lat}, {lon}, {coords}, {address}, {place}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {weather}, {temp}";

		for (let i = 0; i < this.plugin.settings.customTemplates.length; i++) {
			const tmpl = this.plugin.settings.customTemplates[i];

			new Setting(containerEl)
				.setName("Template name")
				.addText((text) =>
					this.bindTextInput(text, () => tmpl.name, (value) => {
						tmpl.name = value;
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
					this.bindTextArea(text, () => tmpl.template, (value) => {
						tmpl.template = value;
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

		new Setting(containerEl).setName("Saved places").setHeading();
		containerEl.createEl("p", {
			text: "Named locations with radius detection. When nearby, you can use the place name instead of a raw address. Each place can have its own insertion, check-in, and check-out templates.",
			cls: "setting-item-description",
		});

		for (let i = 0; i < this.plugin.settings.savedPlaces.length; i++) {
			const place = this.plugin.settings.savedPlaces[i];

			new Setting(containerEl)
				.setName("Place name")
				.addText((text) =>
					this.bindTextInput(text, () => place.name, (value) => {
						place.name = value;
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
				.addText((text) => {
					text.setPlaceholder("200");
					this.bindTextInput(text, () => String(place.radius), (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							place.radius = num;
						}
					});
				})
				.then((setting) => {
					setting.controlEl.querySelector("input")?.setAttribute("type", "number");
					setting.nameEl.appendText(" - Radius (m):");
				});

			new Setting(containerEl)
				.setDesc(placeholderHelp)
				.addTextArea((text) => {
					this.bindTextArea(text, () => place.template, (value) => {
						place.template = value;
					});
					text.inputEl.rows = 4;
					text.inputEl.addClass("myloc-place-textarea");
				});

			new Setting(containerEl)
				.setName("Check-in template")
				.setDesc("Leave empty to use the global check-in template")
				.addTextArea((text) => {
					text.setPlaceholder(this.plugin.settings.checkin.checkinTemplate);
					this.bindTextArea(text, () => place.checkinTemplate || "", (value) => {
						place.checkinTemplate = value || undefined;
					});
					text.inputEl.rows = 2;
					text.inputEl.addClass("myloc-place-textarea");
				});

			new Setting(containerEl)
				.setName("Check-out template")
				.setDesc("Leave empty to use the global check-out template. Supports {duration}.")
				.addTextArea((text) => {
					text.setPlaceholder(this.plugin.settings.checkin.checkoutTemplate);
					this.bindTextArea(text, () => place.checkoutTemplate || "", (value) => {
						place.checkoutTemplate = value || undefined;
					});
					text.inputEl.rows = 2;
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

		new Setting(containerEl).setName("Location notes").setHeading();
		containerEl.createEl("p", {
			text: "Create new notes from templates with location data filled in. A link to the new note is inserted at cursor.",
			cls: "setting-item-description",
		});

		const noteHelp = "Placeholders: {lat}, {lon}, {coords}, {address}, {place}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {date:FORMAT}, {weather}, {temp}, {notePath}, {noteTitle}";

		for (let i = 0; i < this.plugin.settings.locationNotes.length; i++) {
			const note = this.plugin.settings.locationNotes[i];

			new Setting(containerEl)
				.setName("Name")
				.addText((text) => {
					text.setPlaceholder("Travel log");
					this.bindTextInput(text, () => note.name, (value) => {
						note.name = value;
					});
				})
				.addExtraButton((btn) =>
					btn.setIcon("trash").setTooltip("Delete location note").onClick(async () => {
						this.plugin.settings.locationNotes.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);

			new Setting(containerEl)
				.setName("Directory")
				.addText((text) => {
					text.setPlaceholder("Locations/{date:yyyy/MM}");
					this.bindTextInput(text, () => note.directory, (value) => {
						note.directory = value;
					});
				});

			new Setting(containerEl)
				.setName("Filename template")
				.addText((text) => {
					text.setPlaceholder("location_{date:yyyy-MM-dd}");
					this.bindTextInput(text, () => note.filenameTemplate, (value) => {
						note.filenameTemplate = value;
					});
				});

			new Setting(containerEl)
				.setName("Template file")
				.setDesc("Vault path to template note")
				.addText((text) => {
					text.setPlaceholder("Templates/location.md");
					this.bindTextInput(text, () => note.templatePath, (value) => {
						note.templatePath = value;
					});
				});

			new Setting(containerEl)
				.setName("Link template")
				.setDesc(noteHelp)
				.addText((text) => {
					text.setPlaceholder("[[{notePath}]]");
					this.bindTextInput(text, () => note.linkTemplate, (value) => {
						note.linkTemplate = value;
					});
				});
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

		new Setting(containerEl).setName("Check-in / check-out").setHeading();
		containerEl.createEl("p", {
			text: "Track time at locations. Check in records arrival, check out records departure with duration. Check-out always writes to the active note — if it's the same note as check-in, the standard template is used; if it's a different note, the \"different note\" template is used so you can include check-in context.",
			cls: "setting-item-description",
		});

		const activeCheckIn = this.plugin.activeCheckIn;
		new Setting(containerEl)
			.setName("Current status")
			.setDesc(this.getCheckInStatusText(activeCheckIn))
			.addButton((btn) =>
				btn.setButtonText("Clear").setDisabled(!activeCheckIn).onClick(async () => {
					await this.plugin.clearActiveCheckIn();
					this.display();
				})
			);

		const checkinPlaceholderHelp = "Placeholders: {lat}, {lon}, {coords}, {address}, {place}, {city}, {country}, {mapUrl}, {mapLink}, {date}, {time}, {datetime}, {date:FORMAT}, {weather}, {temp}";
		const checkoutPlaceholderHelp = checkinPlaceholderHelp + ", {duration}";
		const checkoutOtherPlaceholderHelp = checkoutPlaceholderHelp + ", {checkinTime}, {checkinDate}, {checkinDatetime}, {checkinAddress}, {checkinPlace}, {checkinNote}";

		new Setting(containerEl)
			.setName("Check-in template")
			.setDesc(checkinPlaceholderHelp)
			.addTextArea((text) => {
				this.bindTextArea(text, () => this.plugin.settings.checkin.checkinTemplate, (value) => {
					this.plugin.settings.checkin.checkinTemplate = value;
				});
				text.inputEl.rows = 3;
				text.inputEl.addClass("myloc-template-textarea");
			});

		new Setting(containerEl)
			.setName("Check-out template")
			.setDesc("Used when checking out on the same note as check-in. " + checkoutPlaceholderHelp)
			.addTextArea((text) => {
				this.bindTextArea(text, () => this.plugin.settings.checkin.checkoutTemplate, (value) => {
					this.plugin.settings.checkin.checkoutTemplate = value;
				});
				text.inputEl.rows = 3;
				text.inputEl.addClass("myloc-template-textarea");
			});

		new Setting(containerEl)
			.setName("Check-out template (different note)")
			.setDesc("Used when checking out on a different note than check-in (e.g., daily notes). " + checkoutOtherPlaceholderHelp)
			.addTextArea((text) => {
				this.bindTextArea(text, () => this.plugin.settings.checkin.checkoutTemplateOther, (value) => {
					this.plugin.settings.checkin.checkoutTemplateOther = value;
				});
				text.inputEl.rows = 3;
				text.inputEl.addClass("myloc-template-textarea");
			});

		new Setting(containerEl)
			.setName("Section heading")
			.setDesc("Append under this heading. Leave empty to append at end of note.")
			.addText((text) => {
				text.setPlaceholder("Check-ins");
				this.bindTextInput(text, () => this.plugin.settings.checkin.heading, (value) => {
					this.plugin.settings.checkin.heading = value.trim();
				});
			});

		new Setting(containerEl)
			.setName("Duration format")
			.setDesc("How to display time spent")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("short", "Short (2h 15m)")
					.addOption("clock", "Clock (2:15)")
					.addOption("decimal", "Decimal (2.25h)")
					.setValue(this.plugin.settings.checkin.durationFormat)
					.onChange(async (value: DurationFormat) => {
						this.plugin.settings.checkin.durationFormat = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Get location on check-out")
			.setDesc("Fetch fresh location when checking out instead of using check-in location")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.checkin.checkoutLocation)
					.onChange(async (value) => {
						this.plugin.settings.checkin.checkoutLocation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Frontmatter").setHeading();
		containerEl.createEl("p", {
			text: "Choose which fields to include when inserting location as frontmatter. The location field uses [lat, lon].",
			cls: "setting-item-description",
		});

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

	private getCheckInStatusText(activeCheckIn: CheckInState | null): string {
		if (!activeCheckIn) {
			return "No active check-in";
		}

		const { datetime } = this.plugin.formatDateTime(new Date(activeCheckIn.timestamp));
		const locationLabel = activeCheckIn.place || activeCheckIn.address || "";
		const parts = [`Checked in at ${datetime}`];

		if (locationLabel) {
			parts.push(locationLabel);
		}

		if (activeCheckIn.notePath) {
			parts.push(activeCheckIn.notePath);
		}

		return parts.join(" · ");
	}
}
