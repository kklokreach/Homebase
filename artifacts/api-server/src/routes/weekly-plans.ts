import { Router, type IRouter } from "express";
import { and, asc, gte, lte } from "drizzle-orm";
import { db, weeklyPlansTable } from "@workspace/db";
import { isPlainObject } from "../lib/http";

const MAX_PLAN_BODY_LENGTH = 12_000;

type WeeklyPlanRow = typeof weeklyPlansTable.$inferSelect;

function isDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function normalizePlanDate(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function serializePlan(plan: WeeklyPlanRow) {
  return {
    date: normalizePlanDate(plan.planDate),
    body: plan.body,
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function validatePlanBody(body: unknown) {
  if (!isPlainObject(body)) return { error: "Body must be an object" };

  const rawBody = body["body"];
  if (typeof rawBody !== "string") return { error: "body must be a string" };
  if (rawBody.length > MAX_PLAN_BODY_LENGTH) {
    return { error: "body is too long" };
  }

  return { body: rawBody };
}

const router: IRouter = Router();

router.get("/weekly-plans", async (req, res): Promise<void> => {
  const rawWeekStart = Array.isArray(req.query.weekStart) ? req.query.weekStart[0] : req.query.weekStart;
  const weekStart = typeof rawWeekStart === "string" ? rawWeekStart : "";

  if (!isDateKey(weekStart)) {
    res.status(400).json({ error: "weekStart must be a YYYY-MM-DD date" });
    return;
  }

  const weekEnd = addDays(weekStart, 6);
  const rows = await db
    .select()
    .from(weeklyPlansTable)
    .where(and(gte(weeklyPlansTable.planDate, weekStart), lte(weeklyPlansTable.planDate, weekEnd)))
    .orderBy(asc(weeklyPlansTable.planDate));
  const rowsByDate = new Map(rows.map((row) => [normalizePlanDate(row.planDate), row]));

  res.json(
    Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const row = rowsByDate.get(date);
      return row ? serializePlan(row) : { date, body: "", updatedAt: null };
    }),
  );
});

router.put("/weekly-plans/:date", async (req, res): Promise<void> => {
  const date = req.params["date"] ?? "";
  if (!isDateKey(date)) {
    res.status(400).json({ error: "date must be a YYYY-MM-DD date" });
    return;
  }

  const parsed = validatePlanBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [plan] = await db
    .insert(weeklyPlansTable)
    .values({ planDate: date, body: parsed.body })
    .onConflictDoUpdate({
      target: weeklyPlansTable.planDate,
      set: {
        body: parsed.body,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(serializePlan(plan));
});

export default router;
