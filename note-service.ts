import type { App, Editor, TFile } from "obsidian";
import type { PlaceRecord } from "./types";
import { sanitizeFilename } from "./utils";

class NoteService {
	constructor(private app: App) {}

	uniquePath(dir: string, basename: string): string {
		const safeName = sanitizeFilename(basename);
		const path = `${dir}/${safeName}.md`;
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${dir}/${safeName} (${n}).md`)) {
			n++;
		}
		return `${dir}/${safeName} (${n}).md`;
	}

	async appendUnderHeading(file: TFile, heading: string, text: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		if (!heading) {
			const newContent = content.endsWith("\n") ? content + text + "\n" : content + "\n" + text + "\n";
			await this.app.vault.modify(file, newContent);
			return;
		}

		let headingIndex = -1;
		let headingLevel = 0;
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(#{1,6})\s+(.*)/);
			if (match && match[2].trim() === heading) {
				headingIndex = i;
				headingLevel = match[1].length;
				break;
			}
		}

		if (headingIndex === -1) {
			const block = `${content.endsWith("\n") ? "" : "\n"}## ${heading}\n${text}\n`;
			await this.app.vault.modify(file, content + block);
			return;
		}

		let insertIndex = lines.length;
		for (let i = headingIndex + 1; i < lines.length; i++) {
			const match = lines[i].match(/^(#{1,6})\s/);
			if (match && match[1].length <= headingLevel) {
				insertIndex = i;
				break;
			}
		}

		lines.splice(insertIndex, 0, text);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async appendUnderHeadingOrAtCursorLine(
		editor: Editor,
		file: TFile,
		heading: string,
		text: string
	): Promise<"heading" | "cursor-line"> {
		if (!heading) {
			this.appendAtCursorLine(editor, text);
			return "cursor-line";
		}

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(/^(#{1,6})\s+(.*)/);
			if (match && match[2].trim() === heading) {
				await this.appendUnderHeading(file, heading, text);
				return "heading";
			}
		}

		this.appendAtCursorLine(editor, text);
		return "cursor-line";
	}

	appendAtCursorLine(editor: Editor, text: string) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const insertion = lineText.trim().length > 0 ? ` ${text}` : text;
		editor.replaceRange(insertion, { line: cursor.line, ch: lineText.length });
	}

	async ensureFile(path: string, content: string): Promise<TFile> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (this.isFileLike(existing)) {
			return existing;
		}
		return await this.app.vault.create(path, content);
	}

	buildPlaceNoteContent(place: PlaceRecord, details: { address?: string | null; mapUrl: string }): string {
		return `---\nmyloc-type: place\nname: ${this.yamlString(place.name)}\ninline_name: ${this.yamlString(place.inlineName || "")}\ninline_text: ${this.yamlString(place.inlineText || "")}\nlocation: [${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}]\nradius: ${place.radius}\n${this.yamlTagsBlock(place.tags)}---\n\n# ${place.name}\n\n## Details\n- Address: ${details.address || "Unknown"}\n- Coordinates: ${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}\n- Radius: ${place.radius} m\n- Map: [Open in Map](${details.mapUrl})\n\n## Log\n`;
	}

	buildVisitNoteContent(place: PlaceRecord, details: {
		latitude: number;
		longitude: number;
		address?: string | null;
		mapUrl: string;
		placeLink: string;
		createdDate: string;
		createdTime: string;
		createdDateTime: string;
	}): string {
		const lat = details.latitude.toFixed(6);
		const lon = details.longitude.toFixed(6);
		return `---\nmyloc-type: visit\nname: ${this.yamlString(place.name)}\nlocation: [${lat}, ${lon}]\n${this.yamlTagsBlock(place.tags)}created_date: ${details.createdDate}\ncreated_time: ${details.createdTime}\n---\n\n# ${place.name} — ${details.createdDateTime}\n\n- Place: ${details.placeLink}\n- Coordinates: ${lat}, ${lon}\n- Map: [Open in Map](${details.mapUrl})\n- Address: ${details.address || "Unknown"}\n\n## Notes\n\n`;
	}

	private yamlString(value: string): string {
		// JSON strings are valid YAML double-quoted scalars, so this safely
		// escapes quotes, backslashes, and newlines that would break frontmatter.
		return JSON.stringify(value ?? "");
	}

	private yamlTagsBlock(tags: string[]): string {
		return tags.length > 0
			? `tags:\n${tags.map((tag) => `  - ${this.yamlString(tag)}`).join("\n")}\n`
			: "tags: []\n";
	}

	private isFileLike(value: unknown): value is TFile {
		return Boolean(value)
			&& typeof value === "object"
			&& typeof (value as { path?: unknown }).path === "string"
			&& !Array.isArray((value as { children?: unknown }).children);
	}
}

export { NoteService };
export default NoteService;
