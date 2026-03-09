import { App, TFile } from "obsidian";
import { LocationResult } from "./types";

export class NoteService {
	constructor(private app: App) {}

	async upsertFrontmatterLocation(
		file: TFile,
		options: {
			update: boolean;
			location: LocationResult;
			fields: {
				location: boolean;
				address: boolean;
				datetime: boolean;
				weather: boolean;
			};
			address?: string | null;
			datetime?: string;
			weather?: string | null;
		}
	): Promise<"inserted" | "updated" | "exists"> {
		let status: "inserted" | "updated" | "exists" = options.update ? "updated" : "inserted";

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (!options.update && frontmatter.location) {
				status = "exists";
				return;
			}

			if (options.fields.location) {
				frontmatter.location = [
					parseFloat(options.location.latitude.toFixed(6)),
					parseFloat(options.location.longitude.toFixed(6)),
				];
			}

			if (options.fields.address && options.address) {
				frontmatter.address = options.address;
			}

			if (options.fields.datetime && options.datetime) {
				frontmatter.datetime = options.datetime;
			}

			if (options.fields.weather && options.weather) {
				frontmatter.weather = options.weather;
			}
		});

		return status;
	}

	uniquePath(dir: string, basename: string): string {
		const path = `${dir}/${basename}.md`;
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(`${dir}/${basename} (${n}).md`)) {
			n++;
		}
		return `${dir}/${basename} (${n}).md`;
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
			const newContent = content.endsWith("\n") ? content + text + "\n" : content + "\n" + text + "\n";
			await this.app.vault.modify(file, newContent);
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
}
