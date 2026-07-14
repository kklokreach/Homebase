export type WeeklyDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_OPTIONS: { value: WeeklyDay; short: string; label: string }[] = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
];

export const REPEAT_OPTIONS = [
  { value: "forever", label: "Forever" },
  { value: "1", label: "1 repeat" },
  { value: "2", label: "2 repeats" },
  { value: "4", label: "4 repeats" },
  { value: "8", label: "8 repeats" },
  { value: "12", label: "12 repeats" },
  { value: "26", label: "26 repeats" },
  { value: "52", label: "52 repeats" },
];

export function defaultWeeklyDay(): WeeklyDay {
  return new Date().getDay() as WeeklyDay;
}

export function normalizeWeeklyDays(days: readonly number[] | null | undefined): WeeklyDay[] {
  return Array.from(
    new Set((days ?? []).filter((day): day is WeeklyDay => Number.isInteger(day) && day >= 0 && day <= 6)),
  ).sort((a, b) => a - b);
}

export function toggleWeeklyDay(days: readonly number[], day: WeeklyDay) {
  const current = new Set(normalizeWeeklyDays(days));
  if (current.has(day)) {
    current.delete(day);
  } else {
    current.add(day);
  }
  return normalizeWeeklyDays(Array.from(current));
}

export function repeatCountFromSelect(value: string) {
  if (value === "forever") return null;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function repeatSelectValue(value: number | null | undefined) {
  return value == null ? "forever" : String(value);
}

export function formatWeeklyDays(days: readonly number[] | null | undefined) {
  const normalized = normalizeWeeklyDays(days);
  if (normalized.length === 0) return "No days";
  if (normalized.length === 7) return "Every day";
  return normalized
    .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.short)
    .filter(Boolean)
    .join(", ");
}

export function formatRepeatCount(value: number | null | undefined) {
  if (value == null) return "Forever";
  return `${value} repeat${value === 1 ? "" : "s"}`;
}
