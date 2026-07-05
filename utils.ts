export function getSystemTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const radiusMeters = 6371000;
	const toRad = (deg: number) => deg * Math.PI / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDatePattern(date: Date, pattern: string, timezone: string): string {
	const parts: Record<string, string> = {};
	const get = (opts: Intl.DateTimeFormatOptions): string =>
		String(new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(date));

	const year = get({ year: "numeric" });
	const month = get({ month: "2-digit" });
	const day = get({ day: "2-digit" });
	const hour = get({ hour: "2-digit", hour12: false });
	const minute = get({ minute: "2-digit" });

	parts["yyyy"] = year;
	parts["yy"] = year.slice(-2);
	parts["MM"] = month;
	parts["M"] = String(parseInt(month));
	parts["dd"] = day;
	parts["d"] = String(parseInt(day));
	parts["HH"] = hour.padStart(2, "0");
	parts["H"] = String(parseInt(hour));
	parts["mm"] = minute.padStart(2, "0");
	parts["m"] = String(parseInt(minute));

	let result = pattern;
	for (const token of ["yyyy", "yy", "MM", "M", "dd", "d", "HH", "H", "mm", "m"]) {
		result = result.split(token).join(parts[token]);
	}
	return result;
}

export function sanitizeFilename(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "");
}

export function formatDuration(ms: number): string {
	const totalMinutes = Math.round(ms / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (hours === 0) return `${minutes}m`;
	if (minutes === 0) return `${hours}h`;
	return `${hours}h ${minutes}m`;
}

export function generateId(): string {
	try {
		return crypto.randomUUID().slice(0, 8);
	} catch {
		return Date.now().toString(36);
	}
}

export interface ParsedTimelineEvent {
	dailyNotePath: string;
	dailyNoteLabel: string;
	time: string;
	action: "in" | "out";
	placePath: string;
	placeLabel: string;
}

export function parseTimelineLine(line: string): ParsedTimelineEvent | null {
	const match = line.match(/^- \[\[([^\]|]+)(?:\|([^\]]+))?\]\] (\d{2}:\d{2}) logged (in|out) \[\[([^\]|]+)(?:\|([^\]]+))?\]\](?: · .+)?$/);
	if (!match) {
		return null;
	}

	return {
		dailyNotePath: match[1],
		dailyNoteLabel: match[2] || match[1].split("/").pop() || match[1],
		time: match[3],
		action: match[4] as "in" | "out",
		placePath: match[5],
		placeLabel: match[6] || match[5].split("/").pop() || match[5],
	};
}
