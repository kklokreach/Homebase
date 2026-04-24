import { Router, type IRouter } from "express";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  budgetCategoriesTable,
  monthlyBudgetsTable,
  monthlyReviewAccountSnapshotsTable,
  monthlyReviewsTable,
  reserveFundsTable,
  reserveTransactionsTable,
  transactionsTable,
} from "@workspace/db";

const router: IRouter = Router();

function getIdFromParams(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  return parseInt(raw, 10);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInt(value: unknown, field: string): number | { error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { error: `${field} must be a positive integer` };
  }
  return value;
}

function parseMonthQuery(value: unknown): number | { error: string } {
  const month = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "month must be an integer between 1 and 12" };
  }
  return month;
}

function parseYearQuery(value: unknown): number | { error: string } {
  const year = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return { error: "year must be a valid integer year" };
  }
  return year;
}

function parseOptionalText(value: unknown, field: string): string | null | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return { error: `${field} must be a string or null` };
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseOptionalNumber(value: unknown, field: string): number | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `${field} must be a number` };
  }
  return value;
}

function parseOptionalInteger(value: unknown, field: string): number | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: `${field} must be an integer` };
  }
  return value;
}

function isErrorResult<T>(value: T | { error: string }): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

async function ensureMonthlyReview(year: number, month: number) {
  const [existing] = await db
    .select()
    .from(monthlyReviewsTable)
    .where(and(eq(monthlyReviewsTable.year, year), eq(monthlyReviewsTable.month, month)));

  if (existing) return existing;

  const [created] = await db
    .insert(monthlyReviewsTable)
    .values({ year, month, notes: null })
    .returning();

  return created;
}

async function buildBudgetReview(year: number, month: number) {
  const categories = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(budgetCategoriesTable.sortOrder, budgetCategoriesTable.name);

  const monthlyBudgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(and(eq(monthlyBudgetsTable.year, year), eq(monthlyBudgetsTable.month, month)));

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const transactions = await db
    .select()
    .from(transactionsTable)
    .where(sql`${transactionsTable.date} LIKE ${prefix + "%"}`);

  const lines = categories.map((category) => {
    const budgetEntry = monthlyBudgets.find((item) => item.categoryId === category.id);
    const budgeted = Number(budgetEntry?.budgetAmount ?? 0);
    const spent = transactions
      .filter((tx) => tx.categoryId === category.id)
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    const left = budgeted - spent;

    return {
      categoryId: category.id,
      categoryName: category.name,
      budgeted,
      spent,
      left,
    };
  });

  return {
    year,
    month,
    totalBudgeted: lines.reduce((sum, line) => sum + line.budgeted, 0),
    totalSpent: lines.reduce((sum, line) => sum + line.spent, 0),
    totalLeft: lines.reduce((sum, line) => sum + line.left, 0),
    overBudgetCount: lines.filter((line) => line.left < 0).length,
    underBudgetCount: lines.filter((line) => line.left > 0).length,
    categories: lines,
  };
}

async function buildFundsReview(year: number, month: number) {
  const funds = await db
    .select()
    .from(reserveFundsTable)
    .orderBy(reserveFundsTable.sortOrder, reserveFundsTable.name);

  if (funds.length === 0) {
    return {
      year,
      month,
      totalBalance: 0,
      totalMonthlyChange: 0,
      funds: [],
    };
  }

  const cutoff = `${year}-${String(month).padStart(2, "0")}`;
  const nextMonthDate = new Date(year, month, 1);
  const nextMonthCutoff = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const transactions = await db
    .select()
    .from(reserveTransactionsTable)
    .where(lt(reserveTransactionsTable.date, nextMonthCutoff));

  function normalizeDelta(type: string, amount: number) {
    if (type === "withdrawal") return -amount;
    return amount;
  }

  const fundSummaries = funds.map((fund) => {
    const fundTransactions = transactions.filter((tx) => tx.reserveFundId === fund.id);
    const balance = fundTransactions.reduce(
      (sum, tx) => sum + normalizeDelta(tx.type, Number(tx.amount)),
      0,
    );
    const monthlyChange = fundTransactions
      .filter((tx) => tx.date.startsWith(cutoff))
      .reduce((sum, tx) => sum + normalizeDelta(tx.type, Number(tx.amount)), 0);
    const targetAmount = fund.targetAmount == null ? null : Number(fund.targetAmount);
    const progress =
      targetAmount && targetAmount > 0
        ? Math.max(0, Math.min(100, (balance / targetAmount) * 100))
        : null;

    return {
      id: fund.id,
      name: fund.name,
      targetAmount,
      balance,
      monthlyChange,
      progress,
    };
  });

  return {
    year,
    month,
    totalBalance: fundSummaries.reduce((sum, fund) => sum + fund.balance, 0),
    totalMonthlyChange: fundSummaries.reduce((sum, fund) => sum + fund.monthlyChange, 0),
    funds: fundSummaries,
  };
}

async function listAccountSnapshots(monthlyReviewId: number) {
  const rows = await db
    .select()
    .from(monthlyReviewAccountSnapshotsTable)
    .where(eq(monthlyReviewAccountSnapshotsTable.monthlyReviewId, monthlyReviewId))
    .orderBy(monthlyReviewAccountSnapshotsTable.sortOrder, monthlyReviewAccountSnapshotsTable.accountName);

  return rows.map((row) => ({
    id: row.id,
    monthlyReviewId: row.monthlyReviewId,
    accountName: row.accountName,
    accountType: row.accountType,
    balance: Number(row.balance),
    sortOrder: row.sortOrder,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

router.get("/reviews/monthly", async (req, res): Promise<void> => {
  const year = parseYearQuery(req.query["year"]);
  const month = parseMonthQuery(req.query["month"]);
  if (isErrorResult(year)) {
    res.status(400).json({ error: year.error });
    return;
  }
  if (isErrorResult(month)) {
    res.status(400).json({ error: month.error });
    return;
  }

  const review = await ensureMonthlyReview(year, month);
  const [budgetReview, fundsReview, accountSnapshots] = await Promise.all([
    buildBudgetReview(year, month),
    buildFundsReview(year, month),
    listAccountSnapshots(review.id),
  ]);

  res.json({
    review: {
      id: review.id,
      year: review.year,
      month: review.month,
      notes: review.notes,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    },
    budgetReview,
    fundsReview,
    accountSnapshots,
  });
});

router.put("/reviews/monthly/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: "Body must be an object" });
    return;
  }

  const notes = parseOptionalText(req.body["notes"], "notes");
  if (isErrorResult(notes)) {
    res.status(400).json({ error: notes.error });
    return;
  }

  const [updated] = await db
    .update(monthlyReviewsTable)
    .set({ notes: notes ?? null })
    .where(eq(monthlyReviewsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Monthly review not found" });
    return;
  }

  res.json({
    id: updated.id,
    year: updated.year,
    month: updated.month,
    notes: updated.notes,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.post("/reviews/monthly/:id/accounts", async (req, res): Promise<void> => {
  const monthlyReviewId = getIdFromParams(req.params);
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: "Body must be an object" });
    return;
  }

  const [review] = await db.select().from(monthlyReviewsTable).where(eq(monthlyReviewsTable.id, monthlyReviewId));
  if (!review) {
    res.status(404).json({ error: "Monthly review not found" });
    return;
  }

  const accountNameRaw = req.body["accountName"];
  if (typeof accountNameRaw !== "string" || accountNameRaw.trim() === "") {
    res.status(400).json({ error: "accountName must be a non-empty string" });
    return;
  }

  const accountType = parseOptionalText(req.body["accountType"], "accountType");
  const balance = parseOptionalNumber(req.body["balance"], "balance");
  const sortOrder = parseOptionalInteger(req.body["sortOrder"], "sortOrder");
  const notes = parseOptionalText(req.body["notes"], "notes");
  if (isErrorResult(accountType)) {
    res.status(400).json({ error: accountType.error });
    return;
  }
  if (isErrorResult(balance)) {
    res.status(400).json({ error: balance.error });
    return;
  }
  if (isErrorResult(sortOrder)) {
    res.status(400).json({ error: sortOrder.error });
    return;
  }
  if (isErrorResult(notes)) {
    res.status(400).json({ error: notes.error });
    return;
  }
  if (balance === undefined) {
    res.status(400).json({ error: "balance is required" });
    return;
  }

  const [created] = await db
    .insert(monthlyReviewAccountSnapshotsTable)
    .values({
      monthlyReviewId,
      accountName: accountNameRaw.trim(),
      accountType: accountType ?? null,
      balance: String(balance),
      sortOrder: sortOrder ?? 0,
      notes: notes ?? null,
    })
    .returning();

  res.status(201).json({
    id: created.id,
    monthlyReviewId: created.monthlyReviewId,
    accountName: created.accountName,
    accountType: created.accountType,
    balance: Number(created.balance),
    sortOrder: created.sortOrder,
    notes: created.notes,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

router.put("/reviews/monthly/accounts/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  if (!isPlainObject(req.body)) {
    res.status(400).json({ error: "Body must be an object" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const accountNameRaw = req.body["accountName"];
  if (accountNameRaw !== undefined) {
    if (typeof accountNameRaw !== "string" || accountNameRaw.trim() === "") {
      res.status(400).json({ error: "accountName must be a non-empty string" });
      return;
    }
    updates.accountName = accountNameRaw.trim();
  }

  const accountType = parseOptionalText(req.body["accountType"], "accountType");
  const balance = parseOptionalNumber(req.body["balance"], "balance");
  const sortOrder = parseOptionalInteger(req.body["sortOrder"], "sortOrder");
  const notes = parseOptionalText(req.body["notes"], "notes");
  if (isErrorResult(accountType)) {
    res.status(400).json({ error: accountType.error });
    return;
  }
  if (isErrorResult(balance)) {
    res.status(400).json({ error: balance.error });
    return;
  }
  if (isErrorResult(sortOrder)) {
    res.status(400).json({ error: sortOrder.error });
    return;
  }
  if (isErrorResult(notes)) {
    res.status(400).json({ error: notes.error });
    return;
  }

  if (accountType !== undefined) updates.accountType = accountType ?? null;
  if (balance !== undefined) updates.balance = String(balance);
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (notes !== undefined) updates.notes = notes ?? null;

  const [updated] = await db
    .update(monthlyReviewAccountSnapshotsTable)
    .set(updates)
    .where(eq(monthlyReviewAccountSnapshotsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Account snapshot not found" });
    return;
  }

  res.json({
    id: updated.id,
    monthlyReviewId: updated.monthlyReviewId,
    accountName: updated.accountName,
    accountType: updated.accountType,
    balance: Number(updated.balance),
    sortOrder: updated.sortOrder,
    notes: updated.notes,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

router.delete("/reviews/monthly/accounts/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [deleted] = await db
    .delete(monthlyReviewAccountSnapshotsTable)
    .where(eq(monthlyReviewAccountSnapshotsTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Account snapshot not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
