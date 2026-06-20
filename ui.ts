import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	type ActivePlaceSession,
	type MyLocPluginUiApi,
	type PlaceMatch,
	type PlaceRecord,
	TIMEZONES,
} from "./types";
import { getSystemTimezone } from "./utils";

export interface CreatePlaceInput {
	path: string;
	latitude?: number;
	longitude?: number;
	radius: number;
	tags: string[];
	inlineName: string;
	inlineText: string;
}

export interface LoginModalResult {
	selectedPaths: string[];
	createPlace?: CreatePlaceInput;
	writeInline: boolean;
}

export interface LogoutModalResult {
	selectedSessionIds: string[];
	writeInline: boolean;
}

export interface InsertLocationPromptResult {
	action: "login-and-insert" | "insert-only" | "cancel";
	useInlineText: boolean;
}

export class ManualPlaceSelectionModal extends Modal {
	private selectedPaths: Set<string>;

	constructor(
		app: App,
		private places: PlaceRecord[],
		initialSelection: string[],
		private onCloseResult: (selectedPaths: string[] | null) => void
	) {
		super(app);
		this.selectedPaths = new Set(initialSelection);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Select saved places" });
		contentEl.createEl("p", {
			text: "Choose one or more saved places manually.",
			cls: "setting-item-description",
		});

		if (this.places.length === 0) {
			contentEl.createEl("p", {
				text: "No saved places were found in the configured places folder.",
				cls: "setting-item-description",
			});
		}

		for (const place of this.places) {
			const label = place.inlineName || place.name;
			new Setting(contentEl)
				.setName(place.name)
				.setDesc(`${place.path}${label !== place.name ? ` · inline: ${label}` : ""}`)
				.addToggle((toggle) =>
					toggle.setValue(this.selectedPaths.has(place.path)).onChange((value) => {
						if (value) this.selectedPaths.add(place.path);
						else this.selectedPaths.delete(place.path);
					})
				);
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Use selection").setCta().onClick(() => {
					this.close();
					this.onCloseResult(Array.from(this.selectedPaths));
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					this.onCloseResult(null);
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class CreatePlaceModal extends Modal {
	private result: CreatePlaceInput | null = null;

	constructor(
		app: App,
		private defaultRadius: number,
		private options: {
			title?: string;
			description?: string;
			includeCoordinates?: boolean;
			initialLatitude?: number;
			initialLongitude?: number;
			confirmLabel?: string;
		},
		private onCloseResult: (result: CreatePlaceInput | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.options.title || "Create place" });
		contentEl.createEl("p", {
			text: this.options.description || "Create a place note at the current location. Use a path like France/Paris/Pantheon to create folders automatically.",
			cls: "setting-item-description",
		});

		let path = "";
		let latitude = this.options.initialLatitude;
		let longitude = this.options.initialLongitude;
		let radius = this.defaultRadius;
		let tags = "";
		let inlineName = "";
		let inlineText = "";

		new Setting(contentEl)
			.setName("Place path")
			.setDesc("Example: France/Paris/Pantheon")
			.addText((text) =>
				text.setPlaceholder("France/Paris/Pantheon").onChange((value) => {
					path = value.trim();
				})
			);

		if (this.options.includeCoordinates) {
			new Setting(contentEl)
				.setName("Latitude")
				.addText((text) =>
					text
						.setPlaceholder("52.229700")
						.setValue(latitude !== undefined ? String(latitude) : "")
						.onChange((value) => {
							const parsed = Number(value);
							latitude = Number.isFinite(parsed) ? parsed : undefined;
						})
				);

			new Setting(contentEl)
				.setName("Longitude")
				.addText((text) =>
					text
						.setPlaceholder("21.012200")
						.setValue(longitude !== undefined ? String(longitude) : "")
						.onChange((value) => {
							const parsed = Number(value);
							longitude = Number.isFinite(parsed) ? parsed : undefined;
						})
				);
		}

		new Setting(contentEl)
			.setName("Radius (m)")
			.addText((text) =>
				text.setPlaceholder(String(this.defaultRadius)).setValue(String(this.defaultRadius)).onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!Number.isNaN(parsed) && parsed > 0) {
						radius = parsed;
					}
				})
			);

		new Setting(contentEl)
			.setName("Inline name")
			.setDesc("Optional label used by inline log text")
			.addText((text) =>
				text.setPlaceholder("Optional").onChange((value) => {
					inlineName = value.trim();
				})
			);

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated")
			.addText((text) =>
				text.setPlaceholder("travel, museum").onChange((value) => {
					tags = value;
				})
			);

		new Setting(contentEl)
			.setName("Inline text")
			.setDesc("Optional text used by insert current location")
			.addTextArea((text) => {
				text.setPlaceholder("Optional");
				text.onChange((value) => {
					inlineText = value;
				});
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(this.options.confirmLabel || "Create").setCta().onClick(() => {
					if (!path) {
						new Notice("Place path is required");
						return;
					}
					if (this.options.includeCoordinates && (latitude === undefined || longitude === undefined)) {
						new Notice("Latitude and longitude are required");
						return;
					}
					this.result = {
						path,
						latitude,
						longitude,
						radius,
						inlineName,
						inlineText,
						tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
					};
					this.close();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		this.contentEl.empty();
		this.onCloseResult(this.result);
	}
}

export class InsertLocationPromptModal extends Modal {
	private result: InsertLocationPromptResult = {
		action: "cancel",
		useInlineText: false,
	};

	constructor(
		app: App,
		private nearbyUnloggedCount: number,
		private hasInlineText: boolean,
		private onCloseResult: (result: InsertLocationPromptResult) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Insert current location" });

		if (this.nearbyUnloggedCount > 0) {
			contentEl.createEl("p", {
				text: `You are inside ${this.nearbyUnloggedCount} saved place${this.nearbyUnloggedCount === 1 ? "" : "s"} that ${this.nearbyUnloggedCount === 1 ? "is" : "are"} not active.`,
				cls: "setting-item-description",
			});
		} else {
			contentEl.createEl("p", {
				text: "Insert the current location without changing active places.",
				cls: "setting-item-description",
			});
		}

		let useInlineText = false;
		if (this.hasInlineText) {
			new Setting(contentEl)
				.setName("Use place inline text")
				.setDesc("Use the place note's custom insert text instead of the standard full location output")
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						useInlineText = value;
					})
				);
		}

		const actions = new Setting(contentEl);
		if (this.nearbyUnloggedCount > 0) {
			actions.addButton((btn) =>
				btn.setButtonText("Log in and insert").setCta().onClick(() => {
					this.result = { action: "login-and-insert", useInlineText };
					this.close();
				})
			);
		}
		actions.addButton((btn) =>
			btn.setButtonText("Insert only").onClick(() => {
				this.result = { action: "insert-only", useInlineText };
				this.close();
			})
		);
		actions.addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => {
				this.result = { action: "cancel", useInlineText: false };
				this.close();
			})
		);
	}

	onClose() {
		this.contentEl.empty();
		this.onCloseResult(this.result);
	}
}

export class LoginModal extends Modal {
	private result: LoginModalResult | null = null;
	private selectedPaths: Set<string>;
	private writeInline: boolean;
	private createPlace: CreatePlaceInput | undefined;

	constructor(
		app: App,
		private matches: PlaceMatch[],
		private allPlaces: PlaceRecord[],
		private activePaths: Set<string>,
		private inlineDefault: boolean,
		private defaultRadius: number,
		private onCloseResult: (result: LoginModalResult | null) => void
	) {
		super(app);
		this.selectedPaths = new Set(
			this.matches.filter((match) => !this.activePaths.has(match.place.path)).map((match) => match.place.path)
		);
		this.writeInline = this.inlineDefault;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Log in" });
		contentEl.createEl("p", {
			text: "Select one or more nearby places, or create a new one at the current location.",
			cls: "setting-item-description",
		});
		const createdPlaceSummary = contentEl.createDiv({ cls: "setting-item-description" });
		const manualPlaceSummary = contentEl.createDiv({ cls: "setting-item-description" });
		if (this.createPlace) {
			createdPlaceSummary.setText(`New place ready: ${this.createPlace.path} · ${this.createPlace.radius} m`);
		}
		if (this.selectedPaths.size > 0) {
			const manualOnlyCount = Array.from(this.selectedPaths).filter((path) =>
				!this.matches.some((match) => match.place.path === path)
			).length;
			if (manualOnlyCount > 0) {
				manualPlaceSummary.setText(
					`Manually selected: ${manualOnlyCount} place${manualOnlyCount === 1 ? "" : "s"}`
				);
			}
		}

		if (this.matches.length > 0) {
			contentEl.createEl("h4", { text: "Nearby places" });
			for (const match of this.matches) {
				const label = match.place.inlineName || match.place.name;
				const setting = new Setting(contentEl).setName(match.place.name).setDesc(
					`${Math.round(match.distance)} m away${label !== match.place.name ? ` · inline: ${label}` : ""}${this.activePaths.has(match.place.path) ? " · already active" : ""}`
				);
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.selectedPaths.has(match.place.path))
						.setDisabled(this.activePaths.has(match.place.path))
						.onChange((value) => {
							if (value) this.selectedPaths.add(match.place.path);
							else this.selectedPaths.delete(match.place.path);
						})
				);
			}
		} else {
			contentEl.createEl("p", { text: "No nearby saved places detected.", cls: "setting-item-description" });
		}

		new Setting(contentEl)
			.setName("Also append inline")
			.setDesc("Write the inline log text into the current note")
			.addToggle((toggle) =>
				toggle.setValue(this.writeInline).onChange((value) => {
					this.writeInline = value;
				})
			);

		new Setting(contentEl)
			.setName("Create new place here")
			.setDesc("Create a place file at the current location")
			.addButton((btn) =>
				btn.setButtonText("Create").onClick(() => {
					new CreatePlaceModal(this.app, this.defaultRadius, {}, (result) => {
						if (!result) return;
						this.createPlace = result;
						createdPlaceSummary.setText(`New place ready: ${result.path} · ${result.radius} m`);
					}).open();
				})
			);

		new Setting(contentEl)
			.setName("Select saved places manually")
			.setDesc("Use saved places from the places folder even if they are not detected nearby")
			.addButton((btn) =>
				btn.setButtonText("Choose").onClick(() => {
					new ManualPlaceSelectionModal(
						this.app,
						this.allPlaces.filter((place) => !this.activePaths.has(place.path)),
						Array.from(this.selectedPaths),
						(result) => {
							if (!result) return;
							this.selectedPaths.clear();
							for (const path of result) {
								this.selectedPaths.add(path);
							}
							manualPlaceSummary.setText(
								result.length > 0
									? `Manually selected: ${result.length} place${result.length === 1 ? "" : "s"}`
									: ""
							);
							this.onOpen();
						}
					).open();
				})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Log in").setCta().onClick(() => {
					if (this.selectedPaths.size === 0 && !this.createPlace) {
						new Notice("Select a nearby place or create a new one");
						return;
					}
					this.result = {
						selectedPaths: Array.from(this.selectedPaths),
						createPlace: this.createPlace,
						writeInline: this.writeInline,
					};
					this.close();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		this.contentEl.empty();
		this.onCloseResult(this.result);
	}
}

export class LogoutModal extends Modal {
	private result: LogoutModalResult | null = null;

	constructor(
		app: App,
		private sessions: ActivePlaceSession[],
		private currentMatches: Set<string>,
		private inlineDefault: boolean,
		private onCloseResult: (result: LogoutModalResult | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Log out" });
		contentEl.createEl("p", {
			text: "Select one or more active places to end. Nearby active places are preselected when possible.",
			cls: "setting-item-description",
		});

		const selectedSessionIds = new Set(
			this.sessions
				.filter((session) => this.currentMatches.has(session.placePath))
				.map((session) => session.id)
		);
		let writeInline = this.inlineDefault;

		if (selectedSessionIds.size === 0 && this.sessions.length > 0) {
			selectedSessionIds.add(this.sessions[0].id);
		}

		for (const session of this.sessions) {
			const label = session.inlineName || session.placeName;
			const startedAt = new Date(session.startedAt).toLocaleString();
			const setting = new Setting(contentEl).setName(label).setDesc(
				`${startedAt}${this.currentMatches.has(session.placePath) ? " · nearby" : ""}`
			);
			setting.addToggle((toggle) =>
				toggle.setValue(selectedSessionIds.has(session.id)).onChange((value) => {
					if (value) selectedSessionIds.add(session.id);
					else selectedSessionIds.delete(session.id);
				})
			);
		}

		new Setting(contentEl)
			.setName("Also append inline")
			.setDesc("Write the inline log text into the current note")
			.addToggle((toggle) =>
				toggle.setValue(writeInline).onChange((value) => {
					writeInline = value;
				})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Log out").setCta().onClick(() => {
					if (selectedSessionIds.size === 0) {
						new Notice("Select at least one active place");
						return;
					}
					this.result = {
						selectedSessionIds: Array.from(selectedSessionIds),
						writeInline,
					};
					this.close();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		this.contentEl.empty();
		this.onCloseResult(this.result);
	}
}

export class ActivePlacesModal extends Modal {
	constructor(
		app: App,
		private sessions: ActivePlaceSession[],
		private inlineDefault: boolean,
		private onLogout: (sessionIds: string[], writeInline: boolean) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Active places" });
		contentEl.createEl("p", {
			text: "Review currently active places and optionally log out from the selected ones.",
			cls: "setting-item-description",
		});

		if (this.sessions.length === 0) {
			contentEl.createEl("p", { text: "No active places.", cls: "setting-item-description" });
			return;
		}

		const selected = new Set<string>();
		let writeInline = this.inlineDefault;

		for (const session of this.sessions) {
			const label = session.inlineName || session.placeName;
			new Setting(contentEl)
				.setName(label)
				.setDesc(new Date(session.startedAt).toLocaleString())
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						if (value) selected.add(session.id);
						else selected.delete(session.id);
					})
				);
		}

		new Setting(contentEl)
			.setName("Also append inline")
			.setDesc("Write the inline log text into the current note")
			.addToggle((toggle) =>
				toggle.setValue(writeInline).onChange((value) => {
					writeInline = value;
				})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Log out selected").setCta().onClick(() => {
					if (selected.size === 0) {
						new Notice("Select at least one active place");
						return;
					}
					this.close();
					this.onLogout(Array.from(selected), writeInline);
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class MyLocSettingTab extends PluginSettingTab {
	plugin: Plugin & MyLocPluginUiApi;

	constructor(app: App, plugin: Plugin & MyLocPluginUiApi) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Places root folder")
			.setDesc("All place files and the timeline folder live here")
			.addText((text) =>
				text.setValue(this.plugin.settings.placesRoot).onChange(async (value) => {
					this.plugin.settings.placesRoot = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Timeline folder name")
			.setDesc("Created inside the places root folder")
			.addText((text) =>
				text.setValue(this.plugin.settings.timelineFolderName).onChange(async (value) => {
					this.plugin.settings.timelineFolderName = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Default radius")
			.setDesc("Used when creating a new place")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.defaultRadius)).onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (!Number.isNaN(parsed) && parsed > 0) {
						this.plugin.settings.defaultRadius = parsed;
						await this.plugin.saveSettings();
					}
				})
			);

		new Setting(containerEl).setName("Inline logging").setHeading();

		new Setting(containerEl)
			.setName("Inline logging enabled by default")
			.setDesc("Commands can still override this per action")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.inlineLoggingDefault).onChange(async (value) => {
					this.plugin.settings.inlineLoggingDefault = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Inline log heading")
			.setDesc("Append inline logs under this exact heading when it exists. Leave empty to append at the current cursor line.")
			.addText((text) =>
				text.setValue(this.plugin.settings.inlineLogHeading).onChange(async (value) => {
					this.plugin.settings.inlineLogHeading = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Daily note filename format")
			.setDesc("Used for daily-note links written into place logs. Uses Moment.js tokens, for example YYYY-MM-DD or YYYY-MM-DD_ddd.")
			.addText((text) =>
				text.setValue(this.plugin.settings.dailyNoteFormat).onChange(async (value) => {
					this.plugin.settings.dailyNoteFormat = value.trim() || "YYYY-MM-DD";
					await this.plugin.saveSettings();
				})
			);

		const placeholderDesc = "Placeholders: {place}, {placeName}, {inlineName}, {placeLink}, {date}, {time}, {datetime}, {duration}. {place} is a wikilink with a readable alias.";

		new Setting(containerEl)
			.setName("Inline login text")
			.setDesc(placeholderDesc)
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.inlineLoginTemplate).onChange(async (value) => {
					this.plugin.settings.inlineLoginTemplate = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.rows = 2;
			});

		new Setting(containerEl)
			.setName("Inline logout text")
			.setDesc(placeholderDesc)
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.inlineLogoutTemplate).onChange(async (value) => {
					this.plugin.settings.inlineLogoutTemplate = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.rows = 2;
			});

		new Setting(containerEl).setName("Location").setHeading();

		new Setting(containerEl)
			.setName("Allow reverse geocoding")
			.setDesc("Use an external service to get human-readable addresses")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.privacy.allowReverseGeocoding).onChange(async (value) => {
					this.plugin.settings.privacy.allowReverseGeocoding = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Allow approximate IP fallback")
			.setDesc("Use IP-based location when device geolocation is unavailable")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.privacy.allowIpFallback).onChange(async (value) => {
					this.plugin.settings.privacy.allowIpFallback = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Address language")
			.setDesc("Language code for reverse geocoding, for example en or pl")
			.addText((text) =>
				text.setValue(this.plugin.settings.language).onChange(async (value) => {
					this.plugin.settings.language = value.trim();
					await this.plugin.saveSettings();
				})
			);

		const systemTz = getSystemTimezone();
		new Setting(containerEl)
			.setName("Timezone")
			.setDesc(`Auto uses the system timezone (${systemTz})`)
			.addDropdown((dropdown) => {
				dropdown.addOption("", `Auto (${systemTz})`);
				for (const tz of TIMEZONES) {
					dropdown.addOption(tz, tz);
				}
				dropdown.setValue(this.plugin.settings.timezone).onChange(async (value) => {
					this.plugin.settings.timezone = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
