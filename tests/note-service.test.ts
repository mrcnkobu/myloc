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

test("buildPlaceNoteContent escapes newlines, quotes and backslashes in frontmatter", () => {
	const { service } = createNoteServiceWithContent("");
	const weird = 'Line one\nLine "two" with C:\\path';
	const place: PlaceRecord = {
		path: "Places/Test.md",
		name: "Test",
		inlineName: "",
		inlineText: weird,
		latitude: 1,
		longitude: 2,
		radius: 100,
		tags: [],
	};

	const content = service.buildPlaceNoteContent(place, { address: null, mapUrl: "https://example.com" });

	// The inline_text value stays on a single frontmatter line (no raw newline break).
	assert.ok(content.includes(`inline_text: ${JSON.stringify(weird)}`));
	// Frontmatter remains structurally intact: location line follows immediately.
	assert.match(content, /inline_text: .*\nlocation: \[1\.000000, 2\.000000\]/);
});

test("buildVisitNoteContent mirrors the place, drops radius and adds creation date/time", () => {
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

	const content = service.buildVisitNoteContent(place, {
		latitude: 48.846000,
		longitude: 2.346000,
		address: "Rue Soufflot, Paris, France",
		mapUrl: "https://example.com",
		placeLink: "[[Places/France/Paris/Pantheon|Pantheon]]",
		createdDate: "2026-07-04",
		createdTime: "16:30",
		createdDateTime: "2026-07-04 16:30",
	});

	assert.match(content, /myloc-type: visit/);
	assert.match(content, /name: "Pantheon"/);
	assert.doesNotMatch(content, /radius:/);
	assert.doesNotMatch(content, /inline_name:/);
	assert.match(content, /created_date: 2026-07-04/);
	assert.match(content, /created_time: 16:30/);
	assert.match(content, /location: \[48\.846000, 2\.346000\]/);
	assert.match(content, /- Place: \[\[Places\/France\/Paris\/Pantheon\|Pantheon\]\]/);
	assert.match(content, /## Notes/);
});
