import { test } from "node:test";
import { strict as assert } from "node:assert";
import { NoteService } from "../note-service";
import { LocationResult } from "../types";

function createNoteServiceWithContent(content: string) {
	let currentContent = content;
	let frontmatterStore: Record<string, unknown> = {};
	const vault = {
		read: async () => currentContent,
		modify: async (_file: unknown, nextContent: string) => {
			currentContent = nextContent;
		},
		getAbstractFileByPath: (path: string): { path: string } | null => {
			void path;
			return null;
		},
	};

	const app = {
		vault,
		fileManager: {
			processFrontMatter: async (_file: unknown, updater: (frontmatter: Record<string, unknown>) => void) => {
				updater(frontmatterStore);
			},
		},
	};

	return {
		service: new NoteService(app as never),
		getContent: () => currentContent,
		getFrontmatter: () => frontmatterStore,
		setExistingPaths: (paths: string[]) => {
			vault.getAbstractFileByPath = (path: string) => (paths.includes(path) ? { path } : null);
		},
	};
}

test("uniquePath appends a counter when the target path already exists", () => {
	const { service, setExistingPaths } = createNoteServiceWithContent("");
	setExistingPaths(["Trips/entry.md", "Trips/entry (2).md"]);

	assert.equal(service.uniquePath("Trips", "entry"), "Trips/entry (3).md");
});

test("appendUnderHeading inserts text before the next heading in the same section", async () => {
	const { service, getContent } = createNoteServiceWithContent("# Log\n\n## Check-ins\nexisting\n\n## Next\nrest\n");

	await service.appendUnderHeading({} as never, "Check-ins", "new line");

	assert.equal(getContent(), "# Log\n\n## Check-ins\nexisting\n\nnew line\n## Next\nrest\n");
});

test("upsertFrontmatterLocation writes only the requested fields", async () => {
	const { service, getFrontmatter } = createNoteServiceWithContent("");
	const location: LocationResult = {
		latitude: 52.2297,
		longitude: 21.0122,
		accuracy: 10,
		isApproximate: false,
	};

	const status = await service.upsertFrontmatterLocation({} as never, {
		update: false,
		location,
		fields: {
			location: true,
			address: true,
			datetime: true,
			weather: false,
		},
		address: "Warsaw",
		datetime: "2026-03-09T12:00:00",
	});

	assert.equal(status, "inserted");
	assert.deepEqual(getFrontmatter(), {
		location: [52.2297, 21.0122],
		address: "Warsaw",
		datetime: "2026-03-09T12:00:00",
	});
});
