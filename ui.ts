import {
	App,
	type DropdownComponent,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	type TextAreaComponent,
	type TextComponent,
	ToggleComponent,
} from "obsidian";
import {
	type ActivePlaceSession,
	type MyLocPluginUiApi,
	type PlaceMatch,
	type PlaceRecord,
	TIMEZONES,
} from "./types";
import { formatDuration, getSystemTimezone } from "./utils";

function setInlineControlVisibility(element: HTMLElement, visible: boolean): void {
	element.classList.toggle("is-hidden", !visible);
}

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
	inlinePaths: string[];
	visitPaths: string[];
	createPlace?: CreatePlaceInput;
	createPlaceSelected: boolean;
	createPlaceWriteInline: boolean;
	createPlaceWriteVisit: boolean;
}

export interface LogoutModalResult {
	selectedSessionIds: string[];
	inlineSessionIds: string[];
}

export interface InsertLocationPromptResult {
	action: "login-and-insert" | "insert-only" | "cancel";
	useInlineText: boolean;
}

export interface PastTimeInputResult {
	date: string;
	time: string;
}

export interface PastTimeMatch {
	placePath: string;
	placeLabel: string;
	startedAtLabel: string;
}

export interface PastTimeContext {
	placePath: string;
	placeLabel: string;
	eventLabel: string;
	action: "in" | "out";
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
	private inlinePaths: Set<string>;
	private visitPaths = new Set<string>();
	private createPlace: CreatePlaceInput | undefined;
	private createPlaceSelected = true;
	private createPlaceInline = true;
	private createPlaceVisit = false;

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
		const unloggedPaths = this.matches
			.filter((match) => !this.activePaths.has(match.place.path))
			.map((match) => match.place.path);
		this.selectedPaths = new Set(unloggedPaths);
		// Nearby places selected for login should start with inline enabled.
		this.inlinePaths = new Set(unloggedPaths);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Log in" });
		contentEl.createEl("p", {
			text: "Select one or more nearby places, or create a new one at the current location.",
			cls: "setting-item-description",
		});

		const nearbyPaths = new Set(this.matches.map((match) => match.place.path));
		const manualSelectedPlaces = this.allPlaces.filter(
			(place) => this.selectedPaths.has(place.path) && !nearbyPaths.has(place.path)
		);

		if (this.matches.length > 0) {
			contentEl.createEl("h4", { text: "Nearby places" });
			for (const match of this.matches) {
				this.renderSelectablePlaceRow(contentEl, match.place, {
					distanceText: `${Math.round(match.distance)} m away`,
				});
			}
		} else {
			contentEl.createEl("p", { text: "No nearby saved places detected.", cls: "setting-item-description" });
		}

		if (manualSelectedPlaces.length > 0) {
			contentEl.createEl("h4", { text: "Manually selected places" });
			for (const place of manualSelectedPlaces) {
				this.renderSelectablePlaceRow(contentEl, place, {
					distanceText: "Selected manually",
				});
			}
		}

		contentEl.createDiv({ cls: "myloc-section-divider" });

		if (this.createPlace) {
			contentEl.createEl("h4", { text: "New place" });
			const setting = new Setting(contentEl).setName(this.createPlace.inlineName.trim() || this.getDraftPlaceName(this.createPlace)).setDesc("");
			setting.settingEl.addClass("myloc-place-item");
			setting.descEl.empty();
			setting.descEl.createEl("div", {
				cls: "myloc-place-link",
				text: this.createPlace.path,
			});
			setting.descEl.createEl("div", {
				cls: "myloc-distance-meta",
				text: `New place at current location · radius ${this.createPlace.radius} m`,
			});
			const visitControl = setting.controlEl.createDiv({ cls: "myloc-inline-control" });
			visitControl.createSpan({ cls: "myloc-control-label", text: "visit note" });
			const visitToggle = new ToggleComponent(visitControl);
			visitToggle.setValue(this.createPlaceVisit).onChange((value) => {
				this.createPlaceVisit = value;
			});
			setInlineControlVisibility(visitControl, this.createPlaceSelected);
			const inlineControl = setting.controlEl.createDiv({ cls: "myloc-inline-control" });
			inlineControl.createSpan({ cls: "myloc-control-label", text: "inline" });
			const inlineToggle = new ToggleComponent(inlineControl);
			inlineToggle.setValue(this.createPlaceInline).onChange((value) => {
				this.createPlaceInline = value;
			});
			setInlineControlVisibility(inlineControl, this.createPlaceSelected);
			setting.controlEl.createSpan({ cls: "myloc-control-label", text: "log in" });
			setting.addToggle((selectToggle) =>
				selectToggle.setValue(this.createPlaceSelected).onChange((value) => {
					this.createPlaceSelected = value;
					if (value) {
						this.createPlaceInline = true;
						inlineToggle.setValue(true);
						setInlineControlVisibility(inlineControl, true);
						setInlineControlVisibility(visitControl, true);
					} else {
						this.createPlaceInline = false;
						this.createPlaceVisit = false;
						inlineToggle.setValue(false);
						visitToggle.setValue(false);
						setInlineControlVisibility(inlineControl, false);
						setInlineControlVisibility(visitControl, false);
					}
				})
			);
		}

		new Setting(contentEl)
			.setName("Create new place here")
			.setDesc("Create a place file at the current location")
			.addButton((btn) =>
				btn.setButtonText("Create").onClick(() => {
					new CreatePlaceModal(this.app, this.defaultRadius, {}, (result) => {
						if (!result) return;
						this.createPlace = result;
						this.createPlaceSelected = true;
						this.createPlaceInline = true;
						this.onOpen();
					}).open();
				})
			);

		new Setting(contentEl)
			.setName("Select saved places manually")
			.setDesc("Use saved places from the places folder even if not detected nearby")
			.addButton((btn) =>
				btn.setButtonText("Choose").onClick(() => {
					new ManualPlaceSelectionModal(
						this.app,
						this.allPlaces.filter((place) => !this.activePaths.has(place.path)),
						Array.from(this.selectedPaths),
						(result) => {
							if (!result) return;
							this.selectedPaths.clear();
							this.inlinePaths.clear();
							for (const path of result) {
								this.selectedPaths.add(path);
								if (this.inlineDefault) {
									this.inlinePaths.add(path);
								}
							}
							this.onOpen();
						}
					).open();
				})
			);

		contentEl.createDiv({ cls: "myloc-section-divider" });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Log in").setCta().onClick(() => {
					if (this.selectedPaths.size === 0 && !this.createPlace) {
						new Notice("Select a nearby place or create a new one");
						return;
					}
					this.result = {
						selectedPaths: Array.from(this.selectedPaths),
						inlinePaths: Array.from(this.inlinePaths).filter((p) => this.selectedPaths.has(p)),
						visitPaths: Array.from(this.visitPaths).filter((p) => this.selectedPaths.has(p)),
						createPlace: this.createPlace,
						createPlaceSelected: this.createPlaceSelected,
						createPlaceWriteInline: this.createPlaceInline,
						createPlaceWriteVisit: this.createPlaceVisit,
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

	private getDraftPlaceName(place: CreatePlaceInput): string {
		return place.path.split("/").pop() || place.path;
	}

	private renderSelectablePlaceRow(
		contentEl: HTMLElement,
		place: PlaceRecord,
		options: {
			distanceText: string;
		}
	): void {
		const inlineLabel = place.inlineName.trim() || place.name;
		const isActive = this.activePaths.has(place.path);
		const setting = new Setting(contentEl).setName(inlineLabel).setDesc("");
		setting.settingEl.addClass("myloc-place-item");
		if (isActive) setting.settingEl.addClass("myloc-active-session");
		setting.descEl.empty();
		const link = setting.descEl.createEl("a", {
			text: "Open",
			cls: "myloc-place-link",
			href: "#",
		});
		link.addEventListener("click", (event) => {
			event.preventDefault();
			this.close();
			void this.app.workspace.openLinkText(place.path.replace(/\.md$/, ""), "", false);
		});
		setting.descEl.createEl("div", {
			cls: "myloc-distance-meta",
			text: `${options.distanceText}${isActive ? " · already active" : ""}`,
		});
		const visitControl = setting.controlEl.createDiv({ cls: "myloc-inline-control" });
		visitControl.createSpan({ cls: "myloc-control-label", text: "visit note" });
		const visitToggle = new ToggleComponent(visitControl);
		visitToggle.setValue(this.visitPaths.has(place.path)).onChange((value) => {
			if (value) this.visitPaths.add(place.path);
			else this.visitPaths.delete(place.path);
		});
		setInlineControlVisibility(visitControl, !isActive && this.selectedPaths.has(place.path));
		const inlineControl = setting.controlEl.createDiv({ cls: "myloc-inline-control" });
		inlineControl.createSpan({ cls: "myloc-control-label", text: "inline" });
		const inlineToggle = new ToggleComponent(inlineControl);
		inlineToggle.setValue(this.inlinePaths.has(place.path)).onChange((value) => {
			if (value) this.inlinePaths.add(place.path);
			else this.inlinePaths.delete(place.path);
		});
		setInlineControlVisibility(inlineControl, !isActive && this.selectedPaths.has(place.path));
		setting.controlEl.createSpan({ cls: "myloc-control-label", text: "log in" });
		setting.addToggle((selectToggle) =>
			selectToggle
				.setValue(!isActive && this.selectedPaths.has(place.path))
				.setDisabled(isActive)
				.onChange((value) => {
					if (value) {
						this.selectedPaths.add(place.path);
						if (this.inlineDefault) {
							this.inlinePaths.add(place.path);
						}
						setInlineControlVisibility(inlineControl, true);
						setInlineControlVisibility(visitControl, true);
					} else {
						this.selectedPaths.delete(place.path);
						this.inlinePaths.delete(place.path);
						this.visitPaths.delete(place.path);
						visitToggle.setValue(false);
						setInlineControlVisibility(inlineControl, false);
						setInlineControlVisibility(visitControl, false);
					}
				})
		);
	}
}

export class LogoutModal extends Modal {
	private result: LogoutModalResult | null = null;

	constructor(
		app: App,
		private sessions: ActivePlaceSession[],
		private currentMatchDistances: Map<string, number>,
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
				.filter((session) => this.currentMatchDistances.has(session.placePath))
				.map((session) => session.id)
		);
		const inlineSessionIds = new Set<string>(selectedSessionIds);

		if (selectedSessionIds.size === 0 && this.sessions.length > 0) {
			selectedSessionIds.add(this.sessions[0].id);
			inlineSessionIds.add(this.sessions[0].id);
		}

		for (const session of this.sessions) {
			const label = session.inlineName || session.placeName;
			const elapsed = formatDuration(Date.now() - session.startedAt);
			const startedAt = new Date(session.startedAt).toLocaleString();
			const distance = this.currentMatchDistances.get(session.placePath);
			const setting = new Setting(contentEl).setName(label).setDesc("");
			setting.settingEl.addClass("myloc-place-item");
			setting.descEl.empty();
			const link = setting.descEl.createEl("a", {
				text: "Open",
				cls: "myloc-place-link",
				href: "#",
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				this.close();
				void this.app.workspace.openLinkText(session.placePath.replace(/\.md$/, ""), "", false);
			});
			setting.descEl.createEl("div", {
				cls: "myloc-distance-meta",
				text: `${distance !== undefined ? `${Math.round(distance)} m away · ` : ""}since ${startedAt}`,
			});
			setting.descEl.createEl("div", {
				cls: "myloc-session-meta",
				text: `Active for ${elapsed}`,
			});
			const inlineControl = setting.controlEl.createDiv({ cls: "myloc-inline-control" });
			inlineControl.createSpan({ cls: "myloc-control-label", text: "inline" });
			const inlineToggle = new ToggleComponent(inlineControl);
			inlineToggle.setValue(inlineSessionIds.has(session.id)).onChange((value) => {
				if (value) inlineSessionIds.add(session.id);
				else inlineSessionIds.delete(session.id);
			});
			setInlineControlVisibility(inlineControl, selectedSessionIds.has(session.id));
			setting.controlEl.createSpan({ cls: "myloc-control-label", text: "log out" });
			setting.addToggle((selectToggle) =>
				selectToggle.setValue(selectedSessionIds.has(session.id)).onChange((value) => {
					if (value) {
						selectedSessionIds.add(session.id);
						if (this.inlineDefault) {
							inlineSessionIds.add(session.id);
						}
						setInlineControlVisibility(inlineControl, true);
					}
					else {
						selectedSessionIds.delete(session.id);
						inlineSessionIds.delete(session.id);
						setInlineControlVisibility(inlineControl, false);
					}
				})
			);
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Log out").setCta().onClick(() => {
					if (selectedSessionIds.size === 0) {
						new Notice("Select at least one active place");
						return;
					}
					this.result = {
						selectedSessionIds: Array.from(selectedSessionIds),
						inlineSessionIds: Array.from(inlineSessionIds).filter((id) => selectedSessionIds.has(id)),
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
		private currentMatchDistances: Map<string, number>,
		private inlineDefault: boolean,
		private onLogout: (sessionIds: string[], inlineSessionIds: string[]) => void,
		private onCheckPastTime: () => void
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
			new Setting(contentEl)
				.addButton((btn) =>
					btn.setButtonText("Where was I at…").setCta().onClick(() => {
						this.close();
						this.onCheckPastTime();
					})
				)
				.addButton((btn) =>
					btn.setButtonText("Close").onClick(() => {
						this.close();
					})
				);
			return;
		}

		const selected = new Set<string>();
		const inlineSelected = new Set<string>();

		for (const session of this.sessions) {
			const label = session.inlineName || session.placeName;
			const elapsed = formatDuration(Date.now() - session.startedAt);
			const startedAt = new Date(session.startedAt).toLocaleString();
			const distance = this.currentMatchDistances.get(session.placePath);
			const setting = new Setting(contentEl).setName(label).setDesc("");
			setting.settingEl.addClass("myloc-place-item");
			setting.descEl.empty();
			const link = setting.descEl.createEl("a", {
				text: "Open",
				cls: "myloc-place-link",
				href: "#",
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				this.close();
				void this.app.workspace.openLinkText(session.placePath.replace(/\.md$/, ""), "", false);
			});
			setting.descEl.createEl("div", {
				cls: "myloc-distance-meta",
				text: `${distance !== undefined ? `${Math.round(distance)} m away · ` : ""}since ${startedAt}`,
			});
			setting.descEl.createEl("div", {
				cls: "myloc-session-meta",
				text: `Active for ${elapsed}`,
			});
			const inlineControl = setting.controlEl.createDiv({ cls: "myloc-inline-control is-hidden" });
			inlineControl.createSpan({ cls: "myloc-control-label", text: "inline" });
			const inlineToggle = new ToggleComponent(inlineControl);
			inlineToggle.setValue(false).onChange((value) => {
				if (value) inlineSelected.add(session.id);
				else inlineSelected.delete(session.id);
			});
			setting.controlEl.createSpan({ cls: "myloc-control-label", text: "log out" });
			setting.addToggle((selectToggle) =>
				selectToggle.setValue(false).onChange((value) => {
					if (value) {
						selected.add(session.id);
						if (this.inlineDefault) {
							inlineSelected.add(session.id);
							inlineToggle.setValue(true);
						}
						setInlineControlVisibility(inlineControl, true);
					}
					else {
						selected.delete(session.id);
						inlineSelected.delete(session.id);
						inlineToggle.setValue(false);
						setInlineControlVisibility(inlineControl, false);
					}
				})
			);
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Where was I at…").onClick(() => {
					this.close();
					this.onCheckPastTime();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Log out selected").setCta().onClick(() => {
					if (selected.size === 0) {
						new Notice("Select at least one active place");
						return;
					}
					this.close();
					this.onLogout(
						Array.from(selected),
						Array.from(inlineSelected).filter((id) => selected.has(id))
					);
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

export class PastTimeInputModal extends Modal {
	private result: PastTimeInputResult | null = null;

	constructor(
		app: App,
		private initialDate: string,
		private initialTime: string,
		private onCloseResult: (result: PastTimeInputResult | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Where was I at?" });
		contentEl.createEl("p", {
			text: "Look up which places were active at a specific date and time.",
			cls: "setting-item-description",
		});

		let date = this.initialDate;
		let time = this.initialTime;

		new Setting(contentEl)
			.setName("Date")
			.addText((text) => {
				text.setValue(date).onChange((value) => {
					date = value.trim();
				});
				text.inputEl.type = "date";
			});

		new Setting(contentEl)
			.setName("Time")
			.addText((text) => {
				text.setValue(time).onChange((value) => {
					time = value.trim();
				});
				text.inputEl.type = "time";
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Check").setCta().onClick(() => {
					if (!date || !time) {
						new Notice("Date and time are required");
						return;
					}
					this.result = { date, time };
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

export class PastTimeResultsModal extends Modal {
	constructor(
		app: App,
		private targetLabel: string,
		private matches: PastTimeMatch[],
		private before?: PastTimeContext,
		private after?: PastTimeContext,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Past active places" });
		contentEl.createEl("p", {
			text: `Active places at ${this.targetLabel}`,
			cls: "setting-item-description",
		});

		if (this.matches.length === 0) {
			contentEl.createEl("p", {
				text: "No active places at this time.",
				cls: "setting-item-description",
			});
			if (this.before) {
				contentEl.createDiv({ cls: "myloc-section-divider" });
				contentEl.createEl("p", { text: "Before", cls: "myloc-section-label" });
				this.renderContextRow(contentEl, this.before);
			}
			if (this.after) {
				contentEl.createDiv({ cls: "myloc-section-divider" });
				contentEl.createEl("p", { text: "After", cls: "myloc-section-label" });
				this.renderContextRow(contentEl, this.after);
			}
			return;
		}

		for (const match of this.matches) {
			new Setting(contentEl)
				.setName(match.placeLabel)
				.setDesc(`Active since ${match.startedAtLabel}`)
				.addButton((btn) =>
					btn.setButtonText("Open note").onClick(() => {
						this.close();
						void this.app.workspace.openLinkText(match.placePath.replace(/\.md$/, ""), "");
					})
				);
		}
	}

	private renderContextRow(contentEl: HTMLElement, ctx: PastTimeContext) {
		new Setting(contentEl)
			.setName(ctx.placeLabel)
			.setDesc(`Logged ${ctx.action === "in" ? "in" : "out"} · ${ctx.eventLabel}`)
			.addButton((btn) =>
				btn.setButtonText("Open note").onClick(() => {
					this.close();
					void this.app.workspace.openLinkText(ctx.placePath.replace(/\.md$/, ""), "");
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

function buildPlaceholderDesc(el: HTMLElement): void {
	const placeholders = ["{place}", "{placeName}", "{inlineName}", "{placeLink}", "{date}", "{time}", "{datetime}", "{duration}"];
	el.append("Placeholders: ");
	for (const ph of placeholders) {
		el.createEl("code", { text: ph });
		el.append(" ");
	}
	el.createEl("br");
	el.append("{place} is a wikilink with a readable alias.");
}

export class MyLocSettingTab extends PluginSettingTab {
	private myLocPlugin: Plugin & MyLocPluginUiApi;

	constructor(app: App, plugin: Plugin & MyLocPluginUiApi) {
		super(app, plugin);
		this.myLocPlugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.myLocPlugin.getMyLocSettings();
		containerEl.empty();

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Places root folder")
			.setDesc("All place files and the timeline folder live here")
			.addText((text: TextComponent) => {
				text.setValue(settings.placesRoot);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.placesRoot = value.trim();
					});
				});
			});

		new Setting(containerEl)
			.setName("Timeline folder name")
			.setDesc("Created inside the places root folder")
			.addText((text: TextComponent) => {
				text.setValue(settings.timelineFolderName);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.timelineFolderName = value.trim();
					});
				});
			});

		new Setting(containerEl)
			.setName("Visit notes folder name")
			.setDesc("Created inside the places root folder. Visit notes are grouped by month inside it.")
			.addText((text: TextComponent) => {
				text.setValue(settings.visitNotesFolderName);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.visitNotesFolderName = value.trim() || "_visit-notes";
					});
				});
			});

		new Setting(containerEl)
			.setName("Default radius")
			.setDesc("Used when creating a new place")
			.addText((text: TextComponent) => {
				text.setValue(String(settings.defaultRadius));
				text.onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!Number.isNaN(parsed) && parsed > 0) {
						void this.myLocPlugin.updateMyLocSettings((current) => {
							current.defaultRadius = parsed;
						});
					}
				});
			});

		new Setting(containerEl).setName("Inline logging").setHeading();

		new Setting(containerEl)
			.setName("Inline logging enabled by default")
			.setDesc("Commands can still override this per action")
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(settings.inlineLoggingDefault);
				toggle.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.inlineLoggingDefault = value;
					});
				});
			});

		new Setting(containerEl)
			.setName("Inline log heading")
			.setDesc("Append inline logs under this exact heading when it exists. Leave empty to append at the current cursor line.")
			.addText((text: TextComponent) => {
				text.setValue(settings.inlineLogHeading);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.inlineLogHeading = value;
					});
				});
			});

		new Setting(containerEl)
			.setName("Daily note filename format")
			.setDesc("Used for daily-note links written into place logs. Uses Moment.js tokens, for example YYYY-MM-DD or YYYY-MM-DD_ddd.")
			.addText((text: TextComponent) => {
				text.setValue(settings.dailyNoteFormat);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.dailyNoteFormat = value.trim() || "YYYY-MM-DD";
					});
				});
			});

		const loginTemplateSetting = new Setting(containerEl)
			.setName("Inline login text")
			.addTextArea((text: TextAreaComponent) => {
				text.setValue(settings.inlineLoginTemplate);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.inlineLoginTemplate = value;
					});
				});
				text.inputEl.rows = 2;
			});
		buildPlaceholderDesc(loginTemplateSetting.descEl);

		const logoutTemplateSetting = new Setting(containerEl)
			.setName("Inline logout text")
			.addTextArea((text: TextAreaComponent) => {
				text.setValue(settings.inlineLogoutTemplate);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.inlineLogoutTemplate = value;
					});
				});
				text.inputEl.rows = 2;
			});
		buildPlaceholderDesc(logoutTemplateSetting.descEl);

		new Setting(containerEl).setName("Location").setHeading();

		new Setting(containerEl)
			.setName("Allow reverse geocoding")
			.setDesc("Use an external service to get human-readable addresses")
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(settings.privacy.allowReverseGeocoding);
				toggle.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.privacy.allowReverseGeocoding = value;
					});
				});
			});

		new Setting(containerEl)
			.setName("Allow approximate IP fallback")
			.setDesc("Use IP-based location when device geolocation is unavailable")
			.addToggle((toggle: ToggleComponent) => {
				toggle.setValue(settings.privacy.allowIpFallback);
				toggle.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.privacy.allowIpFallback = value;
					});
				});
			});

		new Setting(containerEl)
			.setName("Address language")
			.setDesc("Language code for reverse geocoding, for example en or pl")
			.addText((text: TextComponent) => {
				text.setValue(settings.language);
				text.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.language = value.trim();
					});
				});
			});

		const systemTz = getSystemTimezone();
		new Setting(containerEl)
			.setName("Timezone")
			.setDesc(`Auto uses the system timezone (${systemTz})`)
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", `Auto (${systemTz})`);
				for (const tz of TIMEZONES) {
					dropdown.addOption(tz, tz);
				}
				if (settings.timezone && !TIMEZONES.includes(settings.timezone)) {
					dropdown.addOption(settings.timezone, settings.timezone);
				}
				dropdown.setValue(settings.timezone);
				dropdown.onChange((value) => {
					void this.myLocPlugin.updateMyLocSettings((current) => {
						current.timezone = value;
					});
				});
			});
	}
}
