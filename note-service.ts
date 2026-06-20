import type { App, TFile } from "obsidian";
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

	async ensureFile(path: string, content: string): Promise<TFile> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing && "path" in existing && "stat" in existing) {
			return existing;
		}
		return await this.app.vault.create(path, content);
	}

	buildPlaceNoteContent(place: PlaceRecord, details: { address?: string | null; mapUrl: string }): string {
		const tagsBlock = place.tags.length > 0
			? `tags:\n${place.tags.map((tag) => `  - ${tag}`).join("\n")}\n`
			: "tags: []\n";
		const inlineName = place.inlineName ? place.inlineName.replace(/"/g, '\\"') : "";
		const inlineText = place.inlineText ? place.inlineText.replace(/"/g, '\\"') : "";
		return `---\nmyloc-type: place\nname: "${place.name.replace(/"/g, '\\"')}"\ninline_name: "${inlineName}"\ninline_text: "${inlineText}"\nlocation: [${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}]\nradius: ${place.radius}\n${tagsBlock}---\n\n# ${place.name}\n\n## Details\n- Address: ${details.address || "Unknown"}\n- Coordinates: ${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}\n- Radius: ${place.radius} m\n- Map: [Open in Map](${details.mapUrl})\n\n## Log\n`;
	}
}

export { NoteService };
export default NoteService;
