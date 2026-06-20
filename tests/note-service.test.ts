import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import type { PlaceRecord } from "../types";

const require = createRequire(import.meta.url);
const { NoteService } = require("../note-service.ts") as typeof import("../note-service");

function createNoteServiceWithContent(content: string) {
	let currentContent = content;
	const files = new Map<string, { path: string; stat: object }>();
	const vault = {
		read: async () => currentContent,
		modify: async (_file: unknown, nextContent: string) => {
			currentContent = nextContent;
		},
		getAbstractFileByPath: (path: string): { path: string; stat: object } | null => {
			return files.get(path) || null;
		},
		create: async (path: string, fileContent: string) => {
			currentContent = fileContent;
			const file = { path, stat: {} };
			files.set(path, file);
			return file;
		},
	};

	return {
		service: new NoteService({ vault } as never),
		getContent: () => currentContent,
		setExistingPaths: (paths: string[]) => {
			files.clear();
			for (const path of paths) {
				files.set(path, { path, stat: {} });
			}
		},
	};
}

test("uniquePath appends a counter when the target path already exists", () => {
	const { service, setExistingPaths } = createNoteServiceWithContent("");
	setExistingPaths(["Places/entry.md", "Places/entry (2).md"]);

	assert.equal(service.uniquePath("Places", "entry"), "Places/entry (3).md");
});

test("appendUnderHeading inserts text before the next heading in the same section", async () => {
	const { service, getContent } = createNoteServiceWithContent("# Log\n\n## Entries\nexisting\n\n## Next\nrest\n");

	await service.appendUnderHeading({} as never, "Entries", "new line");

	assert.equal(getContent(), "# Log\n\n## Entries\nexisting\n\nnew line\n## Next\nrest\n");
});

test("appendUnderHeading creates the heading when it is missing", async () => {
	const { service, getContent } = createNoteServiceWithContent("# Log\n");

	await service.appendUnderHeading({} as never, "Entries", "- item");

	assert.equal(getContent(), "# Log\n## Entries\n- item\n");
});

test("appendUnderHeadingOrAtCursorLine falls back to the current line when the heading is missing", async () => {
	const { service } = createNoteServiceWithContent("# Log\n");
	let line = "Today";
	const editor = {
		getCursor: () => ({ line: 0, ch: line.length }),
		getLine: () => line,
		replaceRange: (text: string) => {
			line += text;
		},
	};

	const result = await service.appendUnderHeadingOrAtCursorLine(
		editor as never,
		{} as never,
		"Locations",
		"[[Places/Home|Home]]"
	);

	assert.equal(result, "cursor-line");
	assert.equal(line, "Today [[Places/Home|Home]]");
});

test("appendUnderHeadingOrAtCursorLine uses the heading when it exists", async () => {
	const { service, getContent } = createNoteServiceWithContent("# Day\n\n#### Locations\nold\n");
	const editor = {
		getCursor: () => ({ line: 0, ch: 0 }),
		getLine: () => "",
		replaceRange: () => {
			throw new Error("replaceRange should not be called when the heading exists");
		},
	};

	const result = await service.appendUnderHeadingOrAtCursorLine(
		editor as never,
		{} as never,
		"Locations",
		"new"
	);

	assert.equal(result, "heading");
	assert.equal(getContent(), "# Day\n\n#### Locations\nold\n\nnew");
});

test("buildPlaceNoteContent creates frontmatter, details and a log section", () => {
	const { service } = createNoteServiceWithContent("");
	const place: PlaceRecord = {
		path: "Places/France/Paris/Pantheon.md",
		name: "Pantheon",
		inlineName: "Latin Quarter",
		inlineText: "At {place}",
		latitude: 48.846222,
		longitude: 2.346414,
		radius: 120,
		tags: ["paris", "history"],
	};

	const content = service.buildPlaceNoteContent(place, {
		address: "Rue Soufflot, Paris, France",
		mapUrl: "https://example.com",
	});

	assert.match(content, /myloc-type: place/);
	assert.match(content, /inline_name: "Latin Quarter"/);
	assert.match(content, /inline_text: "At \{place\}"/);
	assert.match(content, /## Details/);
	assert.match(content, /## Log/);
});
