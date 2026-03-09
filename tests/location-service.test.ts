import { test } from "node:test";
import { strict as assert } from "node:assert";
import { LocationService } from "../location-service";
import { DEFAULT_SETTINGS, LocationResult, SavedPlace } from "../types";

function createLocationService(savedPlaces: SavedPlace[] = []) {
	const settings = {
		...DEFAULT_SETTINGS,
		savedPlaces,
	};

	return new LocationService(
		{} as never,
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
			requestUrl: (async () => {
				throw new Error("requestUrl should not be called in this test");
			}) as never,
			openSavedPlacePicker: async () => null,
		}
	);
}

test("normalizeVaultPath trims slashes and rejects parent traversal", () => {
	const service = createLocationService();

	assert.equal(service.normalizeVaultPath("/Trips/2026/"), "Trips/2026");
	assert.throws(() => service.normalizeVaultPath("../Trips"), /invalid path segments/i);
});

test("buildTemplateContext fills address and map placeholders consistently", () => {
	const service = createLocationService();
	const location: LocationResult = {
		latitude: 52.2297,
		longitude: 21.0122,
		accuracy: 12,
		isApproximate: true,
	};

	const context = service.buildTemplateContext(location, {
		address: { display: "Warsaw, Poland", city: "Warsaw", country: "Poland" },
		weather: { temperature: 18, unit: "°C", description: "Clear" },
	});

	assert.equal(context.coords, "52.229700, 21.012200 (approximate)");
	assert.equal(context.address, "Warsaw, Poland");
	assert.equal(context.city, "Warsaw");
	assert.equal(context.country, "Poland");
	assert.match(context.mapUrl, /openstreetmap/);
	assert.equal(context.weather, "18°C, Clear");
	assert.equal(context.temp, "18°C");
});

test("findMatchingPlaces returns nearby places ordered by distance", () => {
	const places: SavedPlace[] = [
		{
			id: "a",
			name: "Near",
			latitude: 52.22971,
			longitude: 21.01221,
			radius: 300,
			template: "{place}",
		},
		{
			id: "b",
			name: "Farther",
			latitude: 52.2305,
			longitude: 21.0135,
			radius: 300,
			template: "{place}",
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
