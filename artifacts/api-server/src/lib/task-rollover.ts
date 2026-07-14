import { and, eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";

const HOUSEHOLD_TIME_ZONE = "America/Los_Angeles";
const WEEK_STARTS_ON = 1;
const WEEKDAY_VALUES = new Set([0, 1, 2, 3, 4, 5, 6]);

type WeeklyScheduleTask = {
  weeklyDays?: string | null;
  repeatCount?: number | null;
  repeatStartDate?: string | null;
  createdAt?: Date | string | null;
};

export function householdTodayDateString(now = new Date()) {
  return dateStringInHouseholdTimeZone(now);
}

export function dateStringInHouseholdTimeZone(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  const year = partMap.get("year");
  const month = partMap.get("month");
  const day = partMap.get("day");

  return year && month && day
    ? `${year}-${month}-${day}`
    : value.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function householdWeekStartDateString(now = new Date()) {
  const today = householdTodayDateString(now);
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const daysSinceWeekStart = (dayOfWeek - WEEK_STARTS_ON + 7) % 7;
  return addDays(today, -daysSinceWeekStart);
}

export function parseWeeklyDays(value: string | null | undefined) {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(",")
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && WEEKDAY_VALUES.has(day)),
    ),
  ).sort((a, b) => a - b);
}

export function serializeWeeklyDays(value: unknown) {
  if (!Array.isArray(value)) return "";

  return Array.from(
    new Set(
      value
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && WEEKDAY_VALUES.has(day)),
    ),
  )
    .sort((a, b) => a - b)
    .join(",");
}

export function normalizeRepeatCount(value: unknown) {
  if (value == null) return null;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function dateKeyToTime(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function dateKeyFromValue(value: Date | string | null | undefined, fallback: string) {
  if (!value) return fallback;
  if (value instanceof Date) return dateStringInHouseholdTimeZone(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return dateStringInHouseholdTimeZone(parsed);
  return value.slice(0, 10) || fallback;
}

export function weekdayForDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDay();
}

function countScheduledOccurrences(days: number[], startDate: string, endDate: string) {
  const start = dateKeyToTime(startDate);
  const end = dateKeyToTime(endDate);
  if (start == null || end == null || start > end) return 0;

  const oneDay = 24 * 60 * 60 * 1000;
  let count = 0;
  for (let current = start; current <= end; current += oneDay) {
    const day = new Date(current).getUTCDay();
    if (days.includes(day)) count += 1;
  }
  return count;
}

export function weeklyTaskOccursOn(task: WeeklyScheduleTask, dateKey: string) {
  const days = parseWeeklyDays(task.weeklyDays);
  if (!days.includes(weekdayForDateKey(dateKey))) return false;

  const startDate = dateKeyFromValue(task.repeatStartDate ?? task.createdAt, dateKey);
  if ((dateKeyToTime(startDate) ?? 0) > (dateKeyToTime(dateKey) ?? 0)) return false;

  const repeatCount = normalizeRepeatCount(task.repeatCount);
  if (repeatCount == null) return true;

  const occurrencesThroughDate = countScheduledOccurrences(days, startDate, dateKey);
  return occurrencesThroughDate > 0 && occurrencesThroughDate <= repeatCount;
}

export function weeklyTaskHasUpcoming(task: WeeklyScheduleTask, dateKey: string) {
  const days = parseWeeklyDays(task.weeklyDays);
  if (days.length === 0) return false;

  const repeatCount = normalizeRepeatCount(task.repeatCount);
  if (repeatCount == null) return true;

  const startDate = dateKeyFromValue(task.repeatStartDate ?? task.createdAt, dateKey);
  const dayBefore = addDays(dateKey, -1);
  const occurrencesBeforeDate = countScheduledOccurrences(days, startDate, dayBefore);
  return occurrencesBeforeDate < repeatCount;
}

export async function refreshTaskAutomation() {
  const now = new Date();
  const today = householdTodayDateString(now);
  const weekStart = householdWeekStartDateString(now);

  await db
    .update(tasksTable)
    .set({ dueDate: today })
    .where(
      and(
        eq(tasksTable.completed, false),
        lt(tasksTable.dueDate, today),
      ),
    );

  const completedWeeklyTasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.listType, "weekly"), eq(tasksTable.completed, true)));

  await Promise.all(
    completedWeeklyTasks
      .filter((task) => {
        const completedDate = task.completedAt
          ? dateStringInHouseholdTimeZone(task.completedAt)
          : null;
        return (!completedDate || completedDate < today) && weeklyTaskOccursOn(task, today);
      })
      .map((task) =>
        db
          .update(tasksTable)
          .set({
            completed: false,
            completedAt: null,
          })
          .where(eq(tasksTable.id, task.id)),
      ),
  );

  return { today, weekStart };
}
