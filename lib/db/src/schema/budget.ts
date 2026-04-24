import { pgTable, text, serial, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const budgetCategoriesTable = pgTable("budget_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const monthlyBudgetsTable = pgTable("monthly_budgets", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => budgetCategoriesTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  budgetAmount: numeric("budget_amount", { precision: 10, scale: 2 }).notNull().default("0"),
});

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  merchant: text("merchant").notNull(),
  categoryId: integer("category_id").references(() => budgetCategoriesTable.id, { onDelete: "set null" }),
  date: text("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Reserve entities are kept separate from monthly budget categories so future
// household scoping can be added with a dedicated foreign key without
// disturbing the current monthly-budget model.
export const reserveFundsTable = pgTable("reserve_funds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  targetAmount: numeric("target_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const reserveTransactionsTable = pgTable("reserve_transactions", {
  id: serial("id").primaryKey(),
  reserveFundId: integer("reserve_fund_id")
    .notNull()
    .references(() => reserveFundsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  date: text("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Monthly reviews are month-scoped records so household/user scoping can be
// added later with a dedicated foreign key without changing the review model.
export const monthlyReviewsTable = pgTable(
  "monthly_reviews",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    yearMonthUnique: uniqueIndex("monthly_reviews_year_month_unique").on(table.year, table.month),
  }),
);

export const monthlyReviewAccountSnapshotsTable = pgTable("monthly_review_account_snapshots", {
  id: serial("id").primaryKey(),
  monthlyReviewId: integer("monthly_review_id")
    .notNull()
    .references(() => monthlyReviewsTable.id, { onDelete: "cascade" }),
  accountName: text("account_name").notNull(),
  accountType: text("account_type"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBudgetCategorySchema = createInsertSchema(budgetCategoriesTable).omit({ id: true });
export type InsertBudgetCategory = z.infer<typeof insertBudgetCategorySchema>;
export type BudgetCategory = typeof budgetCategoriesTable.$inferSelect;

export const insertMonthlyBudgetSchema = createInsertSchema(monthlyBudgetsTable).omit({ id: true });
export type InsertMonthlyBudget = z.infer<typeof insertMonthlyBudgetSchema>;
export type MonthlyBudget = typeof monthlyBudgetsTable.$inferSelect;

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;

export const insertReserveFundSchema = createInsertSchema(reserveFundsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReserveFund = z.infer<typeof insertReserveFundSchema>;
export type ReserveFund = typeof reserveFundsTable.$inferSelect;

export const insertReserveTransactionSchema = createInsertSchema(reserveTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertReserveTransaction = z.infer<typeof insertReserveTransactionSchema>;
export type ReserveTransaction = typeof reserveTransactionsTable.$inferSelect;

export const insertMonthlyReviewSchema = createInsertSchema(monthlyReviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMonthlyReview = z.infer<typeof insertMonthlyReviewSchema>;
export type MonthlyReview = typeof monthlyReviewsTable.$inferSelect;

export const insertMonthlyReviewAccountSnapshotSchema = createInsertSchema(monthlyReviewAccountSnapshotsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMonthlyReviewAccountSnapshot = z.infer<typeof insertMonthlyReviewAccountSnapshotSchema>;
export type MonthlyReviewAccountSnapshot = typeof monthlyReviewAccountSnapshotsTable.$inferSelect;
