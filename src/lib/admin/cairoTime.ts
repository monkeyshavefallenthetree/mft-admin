/**
 * Canonical Egypt (`Africa/Cairo`) timezone helpers.
 *
 * Uses `Intl.DateTimeFormat` with `timeZone: "Africa/Cairo"` so dates, shift
 * boundaries, payroll cycles, and lateness checks produce identical results
 * regardless of whether code runs on a UTC Vercel server, a Cairo workstation,
 * or a phone traveling in another timezone — including across Egypt DST (UTC+2 / UTC+3).
 */

export const CAIRO_TZ = "Africa/Cairo";

const cairoPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface CairoDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

function toValidDate(input: Date | number = Date.now()): Date {
  return input instanceof Date ? input : new Date(input);
}

/** Extracts Egypt (`Africa/Cairo`) wall-clock date/time components. */
export function cairoParts(input: Date | number = Date.now()): CairoDateParts {
  const d = toValidDate(input);
  const parts = cairoPartsFormatter.formatToParts(d);
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
    else if (p.type === "hour") hour = Number(p.value) === 24 ? 0 : Number(p.value);
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "second") second = Number(p.value);
  }
  return { year, month, day, hour, minute, second };
}

/**
 * Returns Cairo's UTC offset in milliseconds at the given UTC epoch ms
 * (e.g. `+7_200_000` for UTC+2 winter, `+10_800_000` for UTC+3 summer DST).
 */
export function cairoOffsetMsAt(utcMs: number): number {
  const p = cairoParts(utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const utcSec = Math.floor(utcMs / 1000) * 1000;
  return asUtc - utcSec;
}

/**
 * Converts a Cairo wall-clock date/time to a real JS `Date` instant.
 * Handles overflow (e.g. `minute >= 1440` or negative days) and DST accurately.
 */
export function cairoWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wallUtcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = cairoOffsetMsAt(wallUtcGuess);
  const candidate1 = wallUtcGuess - offset1;
  const offset2 = cairoOffsetMsAt(candidate1);
  return new Date(wallUtcGuess - offset2);
}

/** Formats an instant as `"YYYY-MM-DD"` in `Africa/Cairo`. */
export function cairoYmd(input: Date | number = Date.now()): string {
  const p = cairoParts(input);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes after Cairo midnight (`0..1439`), seconds truncated (HR-POL-2026 clause 1). */
export function cairoMinutesOfDay(input: Date | number = Date.now()): number {
  const p = cairoParts(input);
  return p.hour * 60 + p.minute;
}

/** Instant at Cairo midnight of `baseDate`'s Cairo calendar day + `minutes` (supports overflow past midnight). */
export function cairoAtMinutes(baseDate: Date | number, minutes: number): Date {
  const p = cairoParts(baseDate);
  return cairoWallTimeToDate(p.year, p.month, p.day, 0, minutes, 0, 0);
}

/** Parses `"YYYY-MM-DD"` into `{ year, month, day }`, or `null` if invalid. */
export function parseYmdParts(ymdStr: string | null | undefined): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymdStr || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Instant at `"YYYY-MM-DD"` in Cairo + `minutes` after Cairo midnight. */
export function cairoYmdAtMinutes(ymdStr: string, minutes: number): Date | null {
  const p = parseYmdParts(ymdStr);
  if (!p) return null;
  return cairoWallTimeToDate(p.year, p.month, p.day, 0, minutes, 0, 0);
}

/** Epoch ms for `"YYYY-MM-DD"` at `00:00:00.000` in `Africa/Cairo`. */
export function cairoStartOfDayMs(ymdStr: string): number {
  const p = parseYmdParts(ymdStr);
  if (!p) return NaN;
  return cairoWallTimeToDate(p.year, p.month, p.day, 0, 0, 0, 0).getTime();
}

/** Epoch ms for `"YYYY-MM-DD"` at `23:59:59.999` in `Africa/Cairo`. */
export function cairoEndOfDayMs(ymdStr: string): number {
  const p = parseYmdParts(ymdStr);
  if (!p) return NaN;
  return cairoWallTimeToDate(p.year, p.month, p.day, 23, 59, 59, 999).getTime();
}

/** Day of week (`0` = Sunday .. `6` = Saturday) for a calendar `"YYYY-MM-DD"` string (TZ-independent). */
export function cairoDayOfWeek(ymdStr: string): number {
  const p = parseYmdParts(ymdStr);
  if (!p) return -1;
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0)).getUTCDay();
}

/** Adds whole calendar days to a `"YYYY-MM-DD"` string (TZ-independent). */
export function addDaysToYmd(ymdStr: string, deltaDays: number): string {
  const p = parseYmdParts(ymdStr);
  if (!p) return ymdStr;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + deltaDays, 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Formats an instant as a Cairo clock time string (e.g. `"10:05 AM"`). */
export function formatCairoTime(input: Date | number, locale = "en-US"): string {
  const d = toValidDate(input);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: CAIRO_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
