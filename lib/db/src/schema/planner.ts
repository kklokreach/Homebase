import { date, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weeklyPlansTable = pgTable(
  "weekly_plans",
  {
    id: serial("id").primaryKey(),
    planDate: date("plan_date").notNull(),
    body: text("body").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    planDateUnique: uniqueIndex("weekly_plans_plan_date_unique").on(table.planDate),
  }),
);

export const insertWeeklyPlanSchema = createInsertSchema(weeklyPlansTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertWeeklyPlan = z.infer<typeof insertWeeklyPlanSchema>;
export type WeeklyPlan = typeof weeklyPlansTable.$inferSelect;
