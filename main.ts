import { Editor, MarkdownView, Notice, Platform, Plugin, TFile, moment, requestUrl } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type ActivePlaceSession,
	type AddressResult,
	type InlineTemplateContext,
	type LocationResult,
	type MyLocSettings,
	type PlaceRecord,
} from "./types";
import { formatDatePattern, formatDuration, generateId, getSystemTimezone, parseTimelineLine } from "./utils";
import {
	ActivePlacesModal,
	CreatePlaceModal,
	CreatePlaceInput,
	InsertLocationPromptModal,
	LoginModal,
	LogoutModal,
	PastTimeInputModal,
	PastTimeResultsModal,
	MyLocSettingTab,
} from "./ui";
import { LocationService } from "./location-service";
import { NoteService } from "./note-service";

interface PersistedPluginData {
	settings?: Partial<MyLocSettings> & {
		privacy?: Partial<MyLocSettings["privacy"]>;
	};
	activeSessions?: ActivePlaceSession[];
	privacy?: Partial<MyLocSettings["privacy"]>;
}

interface DailyNotesPluginOptions {
	format?: string;
	folder?: string;
}

export default class MyLocPlugin extends Plugin {
	settings: MyLocSettings;
	activeSessions: ActivePlaceSession[] = [];
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
				version: this.manifest.version,
				requestUrl,
			}
		);
		this.noteService = new NoteService(this.app);

		this.addCommand({
			id: "insert-location",
			name: "Insert current location",
			editorCallback: (editor: Editor) => {
				void this.insertLocation(editor);
			},
		});

		this.addCommand({
			id: "log-in",
			name: "Log in",
			callback: () => {
				void this.logIn();
			},
		});

		this.addCommand({
			id: "create-place-note-manually",
			name: "Create place note manually",
			callback: () => {
				void this.createPlaceManually();
			},
		});

		this.addCommand({
			id: "log-out",
			name: "Log out",
			callback: () => {
				void this.logOut();
			},
		});

		this.addCommand({
			id: "active-places",
			name: "Active places",
			callback: () => {
				void this.showActivePlaces();
			},
		});

		this.addRibbonIcon("map-pin", "Insert location", async () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note to insert location");
				return;
			}
			await this.insertLocation(view.editor);
		});

		this.addSettingTab(new MyLocSettingTab(this.app, this));
	}

	async loadSettings() {
		const loaded = this.asPersistedData(await this.loadData());
		const savedSettings = loaded.settings || loaded;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
		this.settings.privacy = Object.assign({}, DEFAULT_SETTINGS.privacy, savedSettings.privacy || loaded.privacy);
		this.activeSessions = Array.isArray(loaded.activeSessions) ? loaded.activeSessions : [];
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			activeSessions: this.activeSessions,
		});
	}

	getMyLocSettings(): MyLocSettings {
		return this.settings;
	}

	async updateMyLocSettings(update: (settings: MyLocSettings) => void): Promise<void> {
		update(this.settings);
		await this.saveSettings();
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

	private async insertLocation(editor: Editor) {
		const notice = new Notice("Getting location...", 0);
		try {
			const location = await this.locationService.getLocation();
			const nearby = this.locationService.findMatchingPlaces(location);
			const place = nearby[0]?.place || null;
			const activePaths = new Set(this.activeSessions.map((session) => session.placePath));
			const unloggedNearby = nearby.filter((match) => !activePaths.has(match.place.path));
			let address: AddressResult | null = null;
			if (!place) {
				try {
					address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
				} catch {
					// Leave address empty when geocoding fails.
				}
			}

			notice.hide();

			const hasInlineText = Boolean(place?.inlineText?.trim());
			const prompt = (unloggedNearby.length === 0 && !hasInlineText)
				? { action: "insert-only" as const, useInlineText: false }
				: await new Promise<{ action: "login-and-insert" | "insert-only" | "cancel"; useInlineText: boolean }>((resolve) => {
					new InsertLocationPromptModal(
						this.app,
						unloggedNearby.length,
						hasInlineText,
						resolve
					).open();
				});

			if (prompt.action === "cancel") {
				return;
			}

			if (prompt.action === "login-and-insert" && unloggedNearby.length > 0) {
				await this.logInWithLocation(location, nearby);
			}

			if (prompt.useInlineText && place?.inlineText.trim()) {
				editor.replaceSelection(this.renderPlaceInlineText(place, location));
				new Notice("Location inserted");
				return;
			}

			const lines: string[] = [];
			if (place) {
				lines.push(place.name);
			} else if (address) {
				lines.push(address.display);
			}
			lines.push(this.locationService.getCoordsString(location));
			lines.push(`[Open in Map](${this.locationService.getMapUrl(location.latitude, location.longitude)})`);
			editor.replaceSelection(lines.join("\n"));
			notice.hide();
			new Notice("Location inserted");
		} catch (error) {
			notice.hide();
			new Notice(error instanceof Error ? error.message : "Failed to get location");
		}
	}

	private async logIn() {
		const notice = new Notice("Getting location...", 0);
		try {
			const location = await this.locationService.getLocation();
			const matches = this.locationService.findMatchingPlaces(location);
			notice.hide();
			const loggedInCount = await this.logInWithLocation(location, matches);
			if (loggedInCount > 0) {
				new Notice(`Logged in to ${loggedInCount} place${loggedInCount === 1 ? "" : "s"}`);
			}
		} catch (error) {
			notice.hide();
			new Notice(error instanceof Error ? error.message : "Log in failed");
		}
	}

	private async logInWithLocation(location: LocationResult, matches?: { place: PlaceRecord; distance: number }[]) {
		const allPlaces = this.locationService.getAllPlaces();
		const result = await new Promise<{
			selectedPaths: string[];
			inlinePaths: string[];
			visitPaths: string[];
			createPlace?: CreatePlaceInput;
			createPlaceSelected: boolean;
			createPlaceWriteInline: boolean;
			createPlaceWriteVisit: boolean;
		} | null>((resolve) => {
			new LoginModal(
				this.app,
				matches || this.locationService.findMatchingPlaces(location),
				allPlaces,
				new Set(this.activeSessions.map((session) => session.placePath)),
				this.settings.inlineLoggingDefault,
				this.settings.defaultRadius,
				resolve
			).open();
		});

		if (!result) return 0;

		const inlinePathSet = new Set(result.inlinePaths);
		const visitPathSet = new Set(result.visitPaths);
		const placesByPath = new Map(allPlaces.map((place) => [place.path, place]));
		const selectedPlaces: PlaceRecord[] = [];
		for (const path of result.selectedPaths) {
			const place = placesByPath.get(path);
			if (place) {
				selectedPlaces.push(place);
			}
		}

		if (result.createPlace) {
			const created = await this.createPlaceAtLocation(location, result.createPlace);
			if (result.createPlaceSelected) {
				selectedPlaces.push(created);
				if (result.createPlaceWriteInline) {
					inlinePathSet.add(created.path);
				}
				if (result.createPlaceWriteVisit) {
					visitPathSet.add(created.path);
				}
			}
		}

		if (selectedPlaces.length === 0) return 0;

		let loggedInCount = 0;
		const createdVisitNotePaths: string[] = [];
		for (const place of selectedPlaces) {
			if (this.activeSessions.some((session) => session.placePath === place.path)) {
				continue;
			}

			const session: ActivePlaceSession = {
				id: generateId(),
				placePath: place.path,
				placeName: place.name,
				inlineName: place.inlineName,
				startedAt: Date.now(),
				startedLatitude: location.latitude,
				startedLongitude: location.longitude,
			};
			this.activeSessions.push(session);

			let visitLink = "";
			if (visitPathSet.has(place.path)) {
				const visit = await this.createVisitNote(place, location, session.startedAt);
				visitLink = visit.link;
				createdVisitNotePaths.push(visit.path);
			}

			await this.appendPlaceLog(place, this.formatLoginEvent(session.startedAt, visitLink));
			await this.appendTimelineLog(this.formatTimelineLogin(place, session.startedAt));

			if (inlinePathSet.has(place.path)) {
				await this.appendInlineLog(this.settings.inlineLoginTemplate, place, session.startedAt, "", visitLink);
			}
			loggedInCount++;
		}

		await this.saveSettings();

		// Open created visit notes last so they don't steal the active editor
		// before inline logging has written to it.
		for (const path of createdVisitNotePaths) {
			await this.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", true);
		}

		return loggedInCount;
	}

	private async logOut(sessionIds?: string[], inlineSessionIds?: string[]) {
		if (this.activeSessions.length === 0) {
			new Notice("No active places");
			return;
		}

		let selectedIds = sessionIds;
		let inlineIds = inlineSessionIds ?? [];
		if (!selectedIds) {
			const currentMatchDistances = await this.getCurrentNearbyActiveDistances();
			const result = await new Promise<{ selectedSessionIds: string[]; inlineSessionIds: string[] } | null>((resolve) => {
				new LogoutModal(
					this.app,
					this.activeSessions,
					currentMatchDistances,
					this.settings.inlineLoggingDefault,
					resolve
				).open();
			});
			if (!result) return;
			selectedIds = result.selectedSessionIds;
			inlineIds = result.inlineSessionIds;
		}

		const sessionsToEnd = this.activeSessions.filter((session) => selectedIds.includes(session.id));
		if (sessionsToEnd.length === 0) {
			new Notice("No active places selected");
			return;
		}

		const placesByPath = new Map(this.locationService.getAllPlaces().map((place) => [place.path, place]));
		for (const session of sessionsToEnd) {
			const place = placesByPath.get(session.placePath);
			if (!place) {
				continue;
			}

			const endedAt = Date.now();
			const duration = formatDuration(endedAt - session.startedAt);
			await this.appendPlaceLog(place, this.formatLogoutEvent(endedAt, duration));
			await this.appendTimelineLog(this.formatTimelineLogout(place, endedAt, duration));

			if (inlineIds.includes(session.id)) {
				await this.appendInlineLog(this.settings.inlineLogoutTemplate, place, endedAt, duration);
			}
		}

		this.activeSessions = this.activeSessions.filter((session) => !selectedIds.includes(session.id));
		await this.saveSettings();
		new Notice(`Logged out from ${sessionsToEnd.length} place${sessionsToEnd.length === 1 ? "" : "s"}`);
	}

	private async showActivePlaces() {
		const currentMatchDistances = await this.getCurrentNearbyActiveDistances();
		new ActivePlacesModal(
			this.app,
			this.activeSessions,
			currentMatchDistances,
			this.settings.inlineLoggingDefault,
			(sessionIds, inlineSessionIds) => {
				void this.logOut(sessionIds, inlineSessionIds);
			},
			() => {
				void this.checkPastTime();
			}
		).open();
	}

	private async checkPastTime() {
		const now = moment();
		const input = await new Promise<{ date: string; time: string } | null>((resolve) => {
			new PastTimeInputModal(
				this.app,
				now.format("YYYY-MM-DD"),
				now.format("HH:mm"),
				resolve
			).open();
		});
		if (!input) {
			return;
		}

		const targetMoment = moment(`${input.date} ${input.time}`, "YYYY-MM-DD HH:mm", true);
		if (!targetMoment.isValid()) {
			new Notice("Invalid date or time");
			return;
		}

		const result = await this.findPlacesActiveAt(targetMoment);
		new PastTimeResultsModal(
			this.app,
			targetMoment.format("YYYY-MM-DD HH:mm"),
			result.matches,
			result.before,
			result.after,
		).open();
	}

	private async getCurrentNearbyActiveDistances(): Promise<Map<string, number>> {
		try {
			const location = await this.locationService.getLocation();
			const matches = this.locationService.findMatchingPlaces(location);
			const activePaths = new Set(this.activeSessions.map((session) => session.placePath));
			return new Map(
				matches
					.filter((match) => activePaths.has(match.place.path))
					.map((match) => [match.place.path, match.distance])
			);
		} catch {
			return new Map<string, number>();
		}
	}

	private async createPlaceAtLocation(location: LocationResult, input: CreatePlaceInput): Promise<PlaceRecord> {
		const path = this.locationService.getPlaceFilePath(input.path);
		if (this.app.vault.getAbstractFileByPath(path)) {
			throw new Error(`Place file already exists: ${path}`);
		}

		const lastSlash = path.lastIndexOf("/");
		const dir = path.slice(0, lastSlash);
		await this.locationService.ensureFolderExists(dir);

		const addressNotice = new Notice("Looking up address...", 0);
		let address: AddressResult | null = null;
		try {
			address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
		} catch {
			// Place creation still works without a resolved address.
		} finally {
			addressNotice.hide();
		}

		const pathParts = path.replace(/\.md$/, "").split("/");
		const placeName = pathParts[pathParts.length - 1];
		const place: PlaceRecord = {
			path,
			name: placeName,
			inlineName: input.inlineName,
			inlineText: input.inlineText,
			latitude: location.latitude,
			longitude: location.longitude,
			radius: input.radius,
			tags: input.tags,
		};

		const content = this.noteService.buildPlaceNoteContent(place, {
			address: address?.display || null,
			mapUrl: this.locationService.getMapUrl(location.latitude, location.longitude),
		});
		await this.app.vault.create(path, content);
		return place;
	}

	private async createVisitNote(
		place: PlaceRecord,
		location: LocationResult,
		timestamp: number
	): Promise<{ path: string; link: string }> {
		const date = new Date(timestamp);
		const tz = this.getTimezone();
		const monthFolder = this.locationService.getVisitNoteMonthFolder(date);
		await this.locationService.ensureFolderExists(monthFolder);

		const placeBaseName = place.path.replace(/\.md$/, "").split("/").pop() || place.name;
		const basename = this.locationService.getVisitNoteBasename(date, placeBaseName);
		const path = this.noteService.uniquePath(monthFolder, basename);

		let address: AddressResult | null = null;
		try {
			address = await this.locationService.reverseGeocode(location.latitude, location.longitude);
		} catch {
			// Visit note is still created without a resolved address.
		}

		const createdDate = formatDatePattern(date, "yyyy-MM-dd", tz);
		const createdTime = formatDatePattern(date, "HH:mm", tz);
		const content = this.noteService.buildVisitNoteContent(place, {
			latitude: location.latitude,
			longitude: location.longitude,
			address: address?.display || null,
			mapUrl: this.locationService.getMapUrl(location.latitude, location.longitude),
			placeLink: this.getAliasedPlaceLink(place),
			createdDate,
			createdTime,
			createdDateTime: `${createdDate} ${createdTime}`,
		});
		await this.app.vault.create(path, content);

		return {
			path,
			link: `[[${path.replace(/\.md$/, "")}|Visit note]]`,
		};
	}

	private async createPlaceManually() {
		const result = await new Promise<CreatePlaceInput | null>((resolve) => {
			new CreatePlaceModal(
				this.app,
				this.settings.defaultRadius,
				{
					title: "Create place note manually",
					description: "Create a place note without using the current device location.",
					includeCoordinates: true,
					confirmLabel: "Create place note",
				},
				resolve
			).open();
		});

		if (!result || result.latitude === undefined || result.longitude === undefined) {
			return;
		}

		const location: LocationResult = {
			latitude: result.latitude,
			longitude: result.longitude,
			accuracy: 0,
			isApproximate: false,
		};

		await this.createPlaceAtLocation(location, result);
		new Notice("Place note created");
	}

	private async appendPlaceLog(place: PlaceRecord, line: string) {
		const file = this.app.vault.getAbstractFileByPath(place.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Place file not found: ${place.path}`);
		}
		await this.noteService.appendUnderHeading(file, "Log", line);
	}

	private async appendTimelineLog(line: string) {
		const folder = this.locationService.getTimelineFolder();
		await this.locationService.ensureFolderExists(folder);
		const path = this.locationService.getTimelineFilePath(new Date());
		const file = await this.noteService.ensureFile(path, "");
		await this.noteService.appendUnderHeading(file, "", line);
	}

	private async appendInlineLog(
		template: string,
		place: PlaceRecord,
		timestamp: number,
		duration = "",
		visitLink = ""
	) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			new Notice("No active note for inline logging");
			return;
		}

		const values = this.buildInlineContext(place, timestamp, duration);
		const rendered = this.locationService.formatInlineTemplate(template, values);
		const text = visitLink ? `${rendered} · ${visitLink}` : rendered;
		await this.noteService.appendUnderHeadingOrAtCursorLine(
			view.editor,
			view.file,
			this.settings.inlineLogHeading,
			text
		);
	}

	private buildInlineContext(place: PlaceRecord, timestamp: number, duration: string): InlineTemplateContext {
		const effectivePlace = this.getAliasedPlaceLink(place);
		const formatted = this.formatDateTime(new Date(timestamp));
		return {
			place: effectivePlace,
			placeName: place.name,
			inlineName: place.inlineName,
			placeLink: this.getPlaceLink(place),
			date: formatted.date,
			time: formatted.time,
			datetime: formatted.datetime,
			duration,
		};
	}

	private renderPlaceInlineText(place: PlaceRecord, location: LocationResult): string {
		const values = {
			place: this.getAliasedPlaceLink(place),
			placeName: place.name,
			inlineName: place.inlineName,
			placeLink: this.getPlaceLink(place),
			lat: location.latitude.toFixed(6),
			lon: location.longitude.toFixed(6),
			coords: this.locationService.getCoordsString(location),
			mapUrl: this.locationService.getMapUrl(location.latitude, location.longitude),
		};
		return this.locationService.formatInlineTemplate(place.inlineText, values);
	}

	private formatLoginEvent(timestamp: number, visitLink = ""): string {
		const base = `- ${this.getDailyNoteLink(timestamp)} ${this.formatDateTime(new Date(timestamp)).time} logged in`;
		return visitLink ? `${base} · ${visitLink}` : base;
	}

	private formatLogoutEvent(timestamp: number, duration: string): string {
		return `- ${this.getDailyNoteLink(timestamp)} ${this.formatDateTime(new Date(timestamp)).time} logged out · ${duration}`;
	}

	private formatTimelineLogin(place: PlaceRecord, timestamp: number): string {
		return `- ${this.getDailyNoteLink(timestamp)} ${this.formatDateTime(new Date(timestamp)).time} logged in ${this.getAliasedPlaceLink(place)}`;
	}

	private formatTimelineLogout(place: PlaceRecord, timestamp: number, duration: string): string {
		return `- ${this.getDailyNoteLink(timestamp)} ${this.formatDateTime(new Date(timestamp)).time} logged out ${this.getAliasedPlaceLink(place)} · ${duration}`;
	}

	private getPlaceLink(place: PlaceRecord): string {
		return `[[${place.path.replace(/\.md$/, "")}]]`;
	}

	private getDailyNoteLink(timestamp: number): string {
		const settings = this.getDailyNotesSettings();
		const target = moment(new Date(timestamp)).format(this.settings.dailyNoteFormat || settings.format);
		const path = settings.folder ? `${settings.folder}/${target}` : target;
		return `[[${path}|${target}]]`;
	}

	private getAliasedPlaceLink(place: PlaceRecord): string {
		const display = place.inlineName || place.name;
		return `[[${place.path.replace(/\.md$/, "")}|${display}]]`;
	}

	private getDailyNotesSettings(): { format: string; folder: string } {
		const internalPlugins = (this.app as unknown as {
			internalPlugins?: {
				plugins?: Record<string, { instance?: { options?: DailyNotesPluginOptions } }>;
			};
		}).internalPlugins;
		const options = internalPlugins?.plugins?.["daily-notes"]?.instance?.options;
		const format = typeof options?.format === "string" && options.format.trim()
			? options.format
			: "YYYY-MM-DD";
		const folder = typeof options?.folder === "string" ? options.folder.trim().replace(/\/+$/g, "") : "";
		return { format, folder };
	}

	private async findPlacesActiveAt(targetMoment: moment.Moment): Promise<{
		matches: Array<{ placePath: string; placeLabel: string; startedAtLabel: string }>;
		before?: { placePath: string; placeLabel: string; eventLabel: string; action: "in" | "out" };
		after?: { placePath: string; placeLabel: string; eventLabel: string; action: "in" | "out" };
	}> {
		const files = this.locationService.getTimelineFiles();
		const activeByPlace = new Map<string, { placeLabel: string; startedAtLabel: string; startedAt: moment.Moment }>();
		const dailyFormat = this.settings.dailyNoteFormat || this.getDailyNotesSettings().format;
		let lastEventBefore: { placePath: string; placeLabel: string; eventLabel: string; action: "in" | "out" } | undefined;
		let firstEventAfter: { placePath: string; placeLabel: string; eventLabel: string; action: "in" | "out" } | undefined;

		for (const file of files) {
			const content = await this.app.vault.read(file);
			for (const line of content.split("\n")) {
				const parsed = parseTimelineLine(line);
				if (!parsed) {
					continue;
				}

				const eventMoment = moment(`${parsed.dailyNoteLabel} ${parsed.time}`, `${dailyFormat} HH:mm`, true);
				if (!eventMoment.isValid()) {
					continue;
				}

				const eventContext = {
					placePath: parsed.placePath,
					placeLabel: parsed.placeLabel,
					eventLabel: `${parsed.dailyNoteLabel} ${parsed.time}`,
					action: parsed.action,
				};

				if (eventMoment.isAfter(targetMoment)) {
					if (!firstEventAfter) firstEventAfter = eventContext;
					continue;
				}

				lastEventBefore = eventContext;
				if (parsed.action === "in") {
					activeByPlace.set(parsed.placePath, {
						placeLabel: parsed.placeLabel,
						startedAtLabel: `${parsed.dailyNoteLabel} ${parsed.time}`,
						startedAt: eventMoment,
					});
				} else {
					activeByPlace.delete(parsed.placePath);
				}
			}
		}

		const matches = Array.from(activeByPlace.entries())
			.map(([placePath, value]) => ({
				placePath,
				placeLabel: value.placeLabel,
				startedAtLabel: value.startedAtLabel,
				startedAt: value.startedAt,
			}))
			.sort((a, b) => a.startedAt.valueOf() - b.startedAt.valueOf())
			.map((item) => ({
				placePath: item.placePath,
				placeLabel: item.placeLabel,
				startedAtLabel: item.startedAtLabel,
			}));

		return {
			matches,
			before: matches.length === 0 ? lastEventBefore : undefined,
			after: matches.length === 0 ? firstEventAfter : undefined,
		};
	}

	private asPersistedData(data: unknown): PersistedPluginData {
		if (!data || typeof data !== "object") {
			return {};
		}
		return data as PersistedPluginData;
	}
}
