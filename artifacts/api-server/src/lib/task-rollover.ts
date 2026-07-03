import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";

const HOUSEHOLD_TIME_ZONE = "America/Los_Angeles";
const WEEK_STARTS_ON = 1;

export function householdTodayDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  const year = partMap.get("year");
  const month = partMap.get("month");
  const day = partMap.get("day");

  return year && month && day
    ? `${year}-${month}-${day}`
    : now.toISOString().slice(0, 10);
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

export async function refreshTaskAutomation() {
  const now = new Date();
  const today = householdTodayDateString(now);
  const weekStart = householdWeekStartDateString(now);

  await db
    .update(tasksTable)
    .set({ dueDate: today })
    .where(
      and(
        eq(tasksTable.listType, "short"),
        eq(tasksTable.completed, false),
        lt(tasksTable.dueDate, today),
      ),
    );

  await db
    .update(tasksTable)
    .set({
      completed: false,
      completedAt: null,
    })
    .where(
      and(
        eq(tasksTable.listType, "weekly"),
        eq(tasksTable.completed, true),
        or(
          isNull(tasksTable.completedAt),
          sql`(${tasksTable.completedAt} AT TIME ZONE ${HOUSEHOLD_TIME_ZONE})::date < ${weekStart}`,
        ),
      ),
    );

  return { today, weekStart };
}
