import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { DEFAULT_SETTINGS } from "../types";
import type { PlaceRecord } from "../types";

const require = createRequire(import.meta.url);
const { LocationService } = require("../location-service.ts") as typeof import("../location-service");

function createLocationService(places: PlaceRecord[] = []) {
	const settings = {
		...DEFAULT_SETTINGS,
		placesRoot: "Places",
		timelineFolderName: "_timeline",
	};

	const markdownFiles = places.map((place) => ({ path: place.path }));
	const frontmatterByPath = new Map(
		places.map((place) => [place.path, {
			"myloc-type": "place",
			name: place.name,
			inline_name: place.inlineName,
			inline_text: place.inlineText,
			location: [place.latitude, place.longitude],
			radius: place.radius,
			tags: place.tags,
		}])
	);

	return new LocationService(
		{
			vault: {
				getMarkdownFiles: () => markdownFiles,
				getAbstractFileByPath: () => null,
				createFolder: async () => undefined,
			},
			metadataCache: {
				getFileCache: (file: { path: string }) => ({ frontmatter: frontmatterByPath.get(file.path) }),
			},
		} as never,
		() => settings,
		() => ({
			date: "2026-03-09",
			time: "12:00",
			datetime: "2026-03-09 12:00",
			iso: "2026-03-09T12:00:00",
		}),
		() => "Europe/Warsaw",
		{
			isMobile: false,
			version: "0.0.0-test",
			requestUrl: (async () => {
				throw new Error("requestUrl should not be called in this test");
			}) as never,
		}
	);
}

test("normalizeVaultPath trims slashes and rejects parent traversal", () => {
	const service = createLocationService();

	assert.equal(service.normalizeVaultPath("/Trips/2026/"), "Trips/2026");
	assert.throws(() => service.normalizeVaultPath("../Trips"), /invalid segments/i);
});

test("getPlaceFilePath resolves under the configured places root", () => {
	const service = createLocationService();

	assert.equal(service.getPlaceFilePath("France/Paris/Pantheon"), "Places/France/Paris/Pantheon.md");
});

test("findMatchingPlaces returns nearby places ordered by distance", () => {
	const places: PlaceRecord[] = [
		{
			path: "Places/Near.md",
			name: "Near",
			inlineName: "",
			inlineText: "",
			latitude: 52.22971,
			longitude: 21.01221,
			radius: 300,
			tags: [],
		},
		{
			path: "Places/Farther.md",
			name: "Farther",
			inlineName: "",
			inlineText: "",
			latitude: 52.2305,
			longitude: 21.0135,
			radius: 300,
			tags: [],
		},
	];

	const service = createLocationService(places);
	const matches = service.findMatchingPlaces({
		latitude: 52.2297,
		longitude: 21.0122,
		accuracy: 10,
		isApproximate: false,
	});

	assert.deepEqual(matches.map((match) => match.place.name), ["Near", "Farther"]);
	assert.ok(matches[0].distance <= matches[1].distance);
});

test("getTimelineFilePath uses monthly files inside the timeline folder", () => {
	const service = createLocationService();

	assert.equal(service.getTimelineFilePath(new Date("2026-06-20T12:00:00Z")), "Places/_timeline/2026-06.md");
});
