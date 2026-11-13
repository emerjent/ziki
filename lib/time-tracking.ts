/**
 * Issue time tracking (#time-tracking): people log whole minutes against an
 * issue, and the issue's total is summed from those entries. Entries are kept
 * (rather than a single counter) so the history stays auditable and a mistaken
 * entry can be removed without losing the rest.
 */

/** The most one entry may record: a full day. */
export const MAX_TIME_ENTRY_MINUTES = 24 * 60;

/** Whether a value is a whole number of minutes in the allowed range. */
export function isValidMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TIME_ENTRY_MINUTES
  );
}

/**
 * Read minutes from a form field. Accepts a number or a numeric string and
 * returns null when it is not a whole number in range.
 */
export function parseMinutesInput(raw: unknown): number | null {
  if (typeof raw === "number") return isValidMinutes(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const value = Number(text);
  return isValidMinutes(value) ? value : null;
}

/** Human duration: 0m, 45m, 1h, 1h 30m, 24h. */
export function formatDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Total minutes across entries. */
export function sumMinutes(entries: ReadonlyArray<{ minutes: number }>): number {
  return entries.reduce((total, entry) => total + (Number.isFinite(entry.minutes) ? entry.minutes : 0), 0);
}
