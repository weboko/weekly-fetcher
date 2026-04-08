export function isoDay(date) {
    return date.toISOString().slice(0, 10);
}
export function createDefaultFetchWindow(now = new Date()) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return {
        startDate: isoDay(start),
        endDate: isoDay(end),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
}
export function clampText(input, limit) {
    const normalized = input.replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
export function toIsoString(value) {
    return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}
export function isWithinWindow(date, window) {
    if (!date) {
        return false;
    }
    const target = new Date(date).getTime();
    const start = new Date(`${window.startDate}T00:00:00Z`).getTime();
    const end = new Date(`${window.endDate}T23:59:59Z`).getTime();
    return target >= start && target <= end;
}
export function formatDateLabel(value) {
    if (!value) {
        return "n/a";
    }
    return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(new Date(value));
}
