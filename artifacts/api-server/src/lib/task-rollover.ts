import { and, eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";

const HOUSEHOLD_TIME_ZONE = "America/Los_Angeles";

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

export async function rollOverUnfinishedTasksToToday() {
  const today = householdTodayDateString();

  await db
    .update(tasksTable)
    .set({ dueDate: today })
    .where(
      and(
        eq(tasksTable.completed, false),
        lt(tasksTable.dueDate, today),
      ),
    );

  return today;
}
