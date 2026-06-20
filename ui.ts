import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	type ActivePlaceSession,
	type MyLocPluginUiApi,
	type PlaceMatch,
	TIMEZONES,
} from "./types";
import { getSystemTimezone } from "./utils";

export interface CreatePlaceInput {
	path: string;
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

export class CreatePlaceModal extends Modal {
	private result: CreatePlaceInput | null = null;

	constructor(
		app: App,
		private defaultRadius: number,
		private onCloseResult: (result: CreatePlaceInput | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Create place" });

		let path = "";
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

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Create").setCta().onClick(() => {
				if (!path) {
					new Notice("Place path is required");
					return;
				}
				this.result = {
					path,
					radius,
					inlineName,
					inlineText,
					tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
				};
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
		}

		let useInlineText = false;
		if (this.hasInlineText) {
			new Setting(contentEl)
				.setName("Use place inline text")
				.setDesc("Otherwise the standard full location output will be inserted")
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						useInlineText = value;
					})
				);
		}

		if (this.nearbyUnloggedCount > 0) {
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText("Log in and insert").setCta().onClick(() => {
					this.result = { action: "login-and-insert", useInlineText };
					this.close();
				})
			);
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Insert only").onClick(() => {
				this.result = { action: "insert-only", useInlineText };
				this.close();
			})
		);

		new Setting(contentEl).addButton((btn) =>
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

	constructor(
		app: App,
		private matches: PlaceMatch[],
		private activePaths: Set<string>,
		private inlineDefault: boolean,
		private defaultRadius: number,
		private onCloseResult: (result: LoginModalResult | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Log in" });

		const selectedPaths = new Set(
			this.matches.filter((match) => !this.activePaths.has(match.place.path)).map((match) => match.place.path)
		);
		let writeInline = this.inlineDefault;
		let createPlace: CreatePlaceInput | undefined;

		if (this.matches.length > 0) {
			contentEl.createEl("p", { text: "Nearby places", cls: "setting-item-description" });
			for (const match of this.matches) {
				const setting = new Setting(contentEl).setName(match.place.name).setDesc(
					`${Math.round(match.distance)} m away${this.activePaths.has(match.place.path) ? " · already active" : ""}`
				);
				setting.addToggle((toggle) =>
					toggle
						.setValue(selectedPaths.has(match.place.path))
						.setDisabled(this.activePaths.has(match.place.path))
						.onChange((value) => {
							if (value) selectedPaths.add(match.place.path);
							else selectedPaths.delete(match.place.path);
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
				toggle.setValue(writeInline).onChange((value) => {
					writeInline = value;
				})
			);

		new Setting(contentEl)
			.setName("Create new place here")
			.setDesc("Create a place file at the current location")
			.addButton((btn) =>
				btn.setButtonText("Create").onClick(() => {
					new CreatePlaceModal(this.app, this.defaultRadius, (result) => {
						if (!result) return;
						createPlace = result;
						const label = contentEl.createDiv({ cls: "setting-item-description" });
						label.setText(`New place: ${result.path} · ${result.radius} m`);
					}).open();
				})
			);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Log in").setCta().onClick(() => {
				if (selectedPaths.size === 0 && !createPlace) {
					new Notice("Select a nearby place or create a new one");
					return;
				}
				this.result = {
					selectedPaths: Array.from(selectedPaths),
					createPlace,
					writeInline,
				};
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

		const selectedSessionIds = new Set(
			this.sessions
				.filter((session) => this.currentMatches.has(session.placePath))
				.map((session) => session.id)
		);
		let writeInline = this.inlineDefault;

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

		new Setting(contentEl).addButton((btn) =>
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

		if (this.sessions.length === 0) {
			contentEl.createEl("p", { text: "No active places.", cls: "setting-item-description" });
			return;
		}

		const selected = new Set<string>(this.sessions.map((session) => session.id));
		let writeInline = this.inlineDefault;

		for (const session of this.sessions) {
			const label = session.inlineName || session.placeName;
			new Setting(contentEl)
				.setName(label)
				.setDesc(new Date(session.startedAt).toLocaleString())
				.addToggle((toggle) =>
					toggle.setValue(true).onChange((value) => {
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

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Log out selected").setCta().onClick(() => {
				if (selected.size === 0) {
					new Notice("Select at least one active place");
					return;
				}
				this.close();
				this.onLogout(Array.from(selected), writeInline);
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

		const placeholderDesc = "Placeholders: {place}, {placeName}, {inlineName}, {date}, {time}, {datetime}, {duration}";

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
