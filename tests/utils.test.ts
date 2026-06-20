import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseTimelineLine } from "../utils";

test("parseTimelineLine parses aliased daily-note and place links", () => {
	const parsed = parseTimelineLine(
		"- [[Daily/2026/2026-06-21_Sun|2026-06-21_Sun]] 14:22 logged in [[Places/Home|Home]]"
	);

	assert.deepEqual(parsed, {
		dailyNotePath: "Daily/2026/2026-06-21_Sun",
		dailyNoteLabel: "2026-06-21_Sun",
		time: "14:22",
		action: "in",
		placePath: "Places/Home",
		placeLabel: "Home",
	});
});

test("parseTimelineLine parses logout entries with duration suffix", () => {
	const parsed = parseTimelineLine(
		"- [[2026-06-21|2026-06-21]] 16:05 logged out [[Places/Office|Office]] · 1h 43m"
	);

	assert.equal(parsed?.action, "out");
	assert.equal(parsed?.placePath, "Places/Office");
	assert.equal(parsed?.time, "16:05");
});
