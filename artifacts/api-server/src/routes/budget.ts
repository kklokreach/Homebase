import { Router, type IRouter } from "express";
import { and, eq, inArray, or, lt, sql } from "drizzle-orm";
import {
  db,
  budgetCategoriesTable,
  monthlyBudgetsTable,
  monthlyIncomeTable,
  transactionSplitsTable,
  transactionsTable,
} from "@workspace/db";
import { parsePositiveIntParam, sendInvalidId } from "../lib/http";
import {
  CreateBudgetCategoryBody,
  UpdateBudgetCategoryParams,
  UpdateBudgetCategoryBody,
  DeleteBudgetCategoryParams,
  UpsertMonthlyBudgetBody,
  ListMonthlyBudgetsQueryParams,
  CreateTransactionBody,
  UpdateTransactionParams,
  UpdateTransactionBody,
  DeleteTransactionParams,
  ListTransactionsQueryParams,
  GetBudgetDashboardQueryParams,
  GetAnnualReviewQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const MONTHLY_BUDGET_SEED_LOCK_NAMESPACE = 705912;

type TransactionType = "expense" | "income";

type TransactionSplitInput = {
  categoryId?: number | null;
  amount: number;
};

type SerializedTransactionSplit = {
  id: number | null;
  categoryId: number | null;
  categoryName: string | null;
  amount: number;
};

type TransactionRow = {
  id: number;
  transactionType: string;
  amount: string | number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null | undefined;
  date: string;
  notes: string | null;
  createdAt: Date;
};

type SpendingEntry = {
  categoryId: number | null;
  amount: number;
  date: string;
};

type MonthlyBudgetRow = {
  id: number;
  categoryId: number;
  year: number;
  month: number;
  budgetAmount: string | number;
  rolloverOverride: string | number | null;
  rolloverApplied: boolean;
};

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function monthKey(year: number, month: number) {
  return year * 12 + month;
}

function previousYearMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

function isCurrentMonth(year: number, month: number) {
  const current = currentYearMonth();
  return year === current.year && month === current.month;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOrderedIds(body: unknown) {
  if (!isPlainObject(body) || !Array.isArray(body["orderedIds"])) return null;

  const orderedIds = body["orderedIds"];
  if (
    orderedIds.length === 0 ||
    !orderedIds.every((id) => Number.isInteger(id) && id > 0) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return null;
  }

  return orderedIds as number[];
}

function parseYearMonthValues(source: Record<string, unknown>) {
  const year = Number(source["year"]);
  const month = Number(source["month"]);

  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { year, month };
}

function parseMonthlyIncomeBody(body: unknown) {
  if (!isPlainObject(body)) return null;

  const parsed = parseYearMonthValues(body);
  const amount = Number(body["amount"]);

  if (!parsed || !Number.isFinite(amount) || amount < 0) return null;

  return { ...parsed, amount };
}

function normalizeTransactionType(value: string | null | undefined): TransactionType {
  return value === "income" ? "income" : "expense";
}

function toCents(amount: number) {
  return Math.round(amount * 100);
}

function moneyForDb(amount: number) {
  return (toCents(amount) / 100).toFixed(2);
}

function moneyForApi(amount: number) {
  return toCents(amount) / 100;
}

function baseBudgetAmount(
  budget: Pick<MonthlyBudgetRow, "budgetAmount" | "rolloverApplied"> | undefined,
  rollover: number,
) {
  if (!budget) return 0;
  const amount = Number(budget.budgetAmount);
  // Legacy rows marked rolloverApplied stored available amount, not base budget.
  return moneyForApi(budget.rolloverApplied ? amount - rollover : amount);
}

function rolloverOverrideAmount(
  budget: Pick<MonthlyBudgetRow, "rolloverOverride"> | undefined,
) {
  if (!budget || budget.rolloverOverride == null) return null;
  return moneyForApi(Number(budget.rolloverOverride));
}

function effectiveRollover(
  budget: Pick<MonthlyBudgetRow, "rolloverOverride"> | undefined,
  computedRollover: number,
) {
  return rolloverOverrideAmount(budget) ?? computedRollover;
}

function normalizeCategoryId(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) return { error: "Category ids must be positive integers." };
  return value;
}

function normalizeExpenseSplits(
  amount: number,
  categoryId: number | null | undefined,
  splits: TransactionSplitInput[] | undefined,
): { categoryId: number | null; splits: { categoryId: number | null; amount: number }[] } | { error: string } {
  if (!Number.isFinite(amount) || toCents(amount) <= 0) {
    return { error: "Transaction amount must be greater than 0." };
  }

  const source = splits && splits.length > 0
    ? splits
    : [{ categoryId, amount }];

  const normalized = source.map((split) => {
    const normalizedCategoryId = normalizeCategoryId(split.categoryId);
    if (isPlainObject(normalizedCategoryId)) return normalizedCategoryId;

    if (!Number.isFinite(split.amount) || toCents(split.amount) <= 0) {
      return { error: "Split amounts must be greater than 0." };
    }

    return {
      categoryId: normalizedCategoryId,
      amount: toCents(split.amount) / 100,
    };
  });

  const error = normalized.find((split) => "error" in split);
  if (error && "error" in error) return error;

  const validSplits = normalized as { categoryId: number | null; amount: number }[];
  const total = validSplits.reduce((sum, split) => sum + toCents(split.amount), 0);
  if (total !== toCents(amount)) {
    return { error: "Split amounts must add up to the transaction amount." };
  }

  return {
    categoryId: validSplits.length === 1 ? validSplits[0].categoryId : null,
    splits: validSplits,
  };
}

function normalizeTransactionParts(
  type: TransactionType,
  amount: number,
  categoryId: number | null | undefined,
  splits: TransactionSplitInput[] | undefined,
): { categoryId: number | null; splits: { categoryId: number | null; amount: number }[] } | { error: string } {
  if (!Number.isFinite(amount) || toCents(amount) <= 0) {
    return { error: "Transaction amount must be greater than 0." };
  }

  if (type === "income") {
    return { categoryId: null, splits: [] };
  }

  return normalizeExpenseSplits(amount, categoryId, splits);
}

function transactionSelectFields() {
  return {
    id: transactionsTable.id,
    transactionType: transactionsTable.transactionType,
    amount: transactionsTable.amount,
    merchant: transactionsTable.merchant,
    categoryId: transactionsTable.categoryId,
    categoryName: budgetCategoriesTable.name,
    date: transactionsTable.date,
    notes: transactionsTable.notes,
    createdAt: transactionsTable.createdAt,
  };
}

async function loadTransactionSplits(transactionIds: number[]) {
  const splitMap = new Map<number, SerializedTransactionSplit[]>();
  if (transactionIds.length === 0) return splitMap;

  const rows = await db
    .select({
      id: transactionSplitsTable.id,
      transactionId: transactionSplitsTable.transactionId,
      categoryId: transactionSplitsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      amount: transactionSplitsTable.amount,
    })
    .from(transactionSplitsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionSplitsTable.categoryId, budgetCategoriesTable.id))
    .where(inArray(transactionSplitsTable.transactionId, transactionIds))
    .orderBy(transactionSplitsTable.id);

  for (const row of rows) {
    if (!splitMap.has(row.transactionId)) splitMap.set(row.transactionId, []);
    splitMap.get(row.transactionId)!.push({
      id: row.id,
      categoryId: row.categoryId ?? null,
      categoryName: row.categoryName ?? null,
      amount: Number(row.amount),
    });
  }

  return splitMap;
}

async function serializeTransactionRows(rows: TransactionRow[]) {
  const splitMap = await loadTransactionSplits(rows.map((row) => row.id));
  return rows.map((row) => serializeTransaction(row, splitMap.get(row.id) ?? []));
}

async function buildSpendingEntries(
  txns: { id: number; transactionType: string; amount: string | number; categoryId: number | null; date: string }[],
): Promise<SpendingEntry[]> {
  const expenseTxns = txns.filter((txn) => normalizeTransactionType(txn.transactionType) === "expense");
  const splitMap = await loadTransactionSplits(expenseTxns.map((txn) => txn.id));
  const entries: SpendingEntry[] = [];

  for (const txn of expenseTxns) {
    const splits = splitMap.get(txn.id) ?? [];

    if (splits.length > 0) {
      for (const split of splits) {
        entries.push({
          categoryId: split.categoryId,
          amount: split.amount,
          date: txn.date,
        });
      }
      continue;
    }

    entries.push({
      categoryId: txn.categoryId ?? null,
      amount: Number(txn.amount),
      date: txn.date,
    });
  }

  return entries;
}

function computeRolloversFromRows(
  categories: { id: number }[],
  priorBudgets: MonthlyBudgetRow[],
  priorSpendingEntries: SpendingEntry[],
  year: number,
  month: number,
) {
  const rollovers = new Map<number, number>();
  const cutoff = monthKey(year, month);

  for (const cat of categories) {
    const catBudgets = priorBudgets
      .filter((budget) => budget.categoryId === cat.id && monthKey(budget.year, budget.month) < cutoff)
      .sort((a, b) => monthKey(a.year, a.month) - monthKey(b.year, b.month));

    let runningLeft = 0;
    for (const budget of catBudgets) {
      const prefix = `${budget.year}-${String(budget.month).padStart(2, "0")}`;
      const spent = priorSpendingEntries
        .filter((entry) => entry.categoryId === cat.id && entry.date.startsWith(prefix))
        .reduce((sum, entry) => sum + entry.amount, 0);
      const budgeted = baseBudgetAmount(budget, runningLeft);
      const available = budgeted + effectiveRollover(budget, runningLeft);
      runningLeft = moneyForApi(available - spent);
    }

    rollovers.set(cat.id, runningLeft);
  }

  return rollovers;
}

async function ensureMonthlyBudgetRows(
  categories: { id: number }[],
  year: number,
  month: number,
) {
  if (!isCurrentMonth(year, month) || categories.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MONTHLY_BUDGET_SEED_LOCK_NAMESPACE}, ${monthKey(year, month)})`);

    const existingCurrentBudgets = await tx
      .select()
      .from(monthlyBudgetsTable)
      .where(and(eq(monthlyBudgetsTable.year, year), eq(monthlyBudgetsTable.month, month)));
    const existingCategoryIds = new Set(existingCurrentBudgets.map((budget) => budget.categoryId));
    const missingCategories = categories.filter((category) => !existingCategoryIds.has(category.id));
    if (missingCategories.length === 0) return;

    const previousMonth = previousYearMonth(year, month);
    const previousBudgets = await tx
      .select()
      .from(monthlyBudgetsTable)
      .where(and(eq(monthlyBudgetsTable.year, previousMonth.year), eq(monthlyBudgetsTable.month, previousMonth.month)));
    if (previousBudgets.length === 0) return;

    const monthStr = String(month).padStart(2, "0");
    const cutoff = `${year}-${monthStr}`;
    const priorTxns = await tx
      .select()
      .from(transactionsTable)
      .where(sql`${transactionsTable.date} < ${cutoff}`);
    const priorSpendingEntries = await buildSpendingEntries(priorTxns);

    const priorBudgets = await tx
      .select()
      .from(monthlyBudgetsTable)
      .where(
        or(
          lt(monthlyBudgetsTable.year, year),
          and(
            eq(monthlyBudgetsTable.year, year),
            lt(monthlyBudgetsTable.month, month),
          ),
        ),
      );
    if (priorBudgets.length === 0) return;

    const previousRollovers = computeRolloversFromRows(
      categories,
      priorBudgets,
      priorSpendingEntries,
      previousMonth.year,
      previousMonth.month,
    );

    const values = missingCategories.flatMap((category) => {
      const previousBudget = previousBudgets.find((budget) => budget.categoryId === category.id);
      if (!previousBudget) return [];

      const nextBudgetAmount = baseBudgetAmount(
        previousBudget,
        previousRollovers.get(category.id) ?? 0,
      );

      return [{
        categoryId: category.id,
        year,
        month,
        budgetAmount: moneyForDb(nextBudgetAmount),
        rolloverOverride: null,
        rolloverApplied: false,
      }];
    });

    if (values.length > 0) {
      await tx.insert(monthlyBudgetsTable).values(values);
    }
  });
}

// ── Budget Categories ─────────────────────────────────────────────────────

router.get("/budget/categories", async (_req, res): Promise<void> => {
  const cats = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(budgetCategoriesTable.sortOrder, budgetCategoriesTable.name);
  res.json(cats);
});

router.post("/budget/categories", async (req, res): Promise<void> => {
  const parsed = CreateBudgetCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [nextOrder] = await db
    .select({
      value: sql<number>`coalesce(max(${budgetCategoriesTable.sortOrder}), -1) + 1`,
    })
    .from(budgetCategoriesTable);

  const [cat] = await db
    .insert(budgetCategoriesTable)
    .values({
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
      groupName: parsed.data.groupName?.trim() || null,
      sortOrder: parsed.data.sortOrder ?? Number(nextOrder?.value ?? 0),
    })
    .returning();
  res.status(201).json(cat);
});

router.put("/budget/categories/reorder", async (req, res): Promise<void> => {
  const orderedIds = parseOrderedIds(req.body);
  if (!orderedIds) {
    res.status(400).json({ error: "orderedIds must be a non-empty array of unique category ids" });
    return;
  }

  const existing = await db
    .select({ id: budgetCategoriesTable.id })
    .from(budgetCategoriesTable)
    .where(inArray(budgetCategoriesTable.id, orderedIds));
  const existingIds = new Set(existing.map((cat) => cat.id));
  if (orderedIds.some((id) => !existingIds.has(id))) {
    res.status(404).json({ error: "One or more categories were not found" });
    return;
  }

  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(budgetCategoriesTable)
        .set({ sortOrder: index })
        .where(eq(budgetCategoriesTable.id, id)),
    ),
  );

  res.sendStatus(204);
});

router.put("/budget/categories/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "category id");
    return;
  }
  const parsed = UpdateBudgetCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updates.name = d.name;
  if ("icon" in d) updates.icon = d.icon ?? null;
  if ("color" in d) updates.color = d.color ?? null;
  if ("groupName" in d) updates.groupName = d.groupName?.trim() || null;
  if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;

  const [cat] = await db
    .update(budgetCategoriesTable)
    .set(updates)
    .where(eq(budgetCategoriesTable.id, id))
    .returning();
  if (!cat) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(cat);
});

router.delete("/budget/categories/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "category id");
    return;
  }
  await db.delete(budgetCategoriesTable).where(eq(budgetCategoriesTable.id, id));
  res.sendStatus(204);
});

// ── Monthly Budgets ───────────────────────────────────────────────────────

router.get("/budget/monthly", async (req, res): Promise<void> => {
  const parsed = ListMonthlyBudgetsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { year, month } = parsed.data;
  const conditions = [];
  if (year) conditions.push(eq(monthlyBudgetsTable.year, year));
  if (month) conditions.push(eq(monthlyBudgetsTable.month, month));
  if (year && month) {
    const categories = await db.select({ id: budgetCategoriesTable.id }).from(budgetCategoriesTable);
    await ensureMonthlyBudgetRows(categories, year, month);
  }

  const budgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  if (year && month) {
    const categories = await db.select({ id: budgetCategoriesTable.id }).from(budgetCategoriesTable);
    const rollovers = await computeRollovers(categories, year, month);
    res.json(budgets.map((b) => ({
      ...b,
      budgetAmount: baseBudgetAmount(b, rollovers.get(b.categoryId) ?? 0),
      rolloverOverride: rolloverOverrideAmount(b),
    })));
    return;
  }

  res.json(budgets.map((b) => ({
    ...b,
    budgetAmount: Number(b.budgetAmount),
    rolloverOverride: rolloverOverrideAmount(b),
  })));
});

router.post("/budget/monthly", async (req, res): Promise<void> => {
  const parsed = UpsertMonthlyBudgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { categoryId, year, month, budgetAmount } = parsed.data;
  const hasRolloverOverride = Object.prototype.hasOwnProperty.call(parsed.data, "rolloverOverride");
  const rolloverOverride = hasRolloverOverride ? parsed.data.rolloverOverride ?? null : undefined;
  const rolloverOverrideForDb =
    rolloverOverride === undefined
      ? undefined
      : rolloverOverride === null
      ? null
      : moneyForDb(rolloverOverride);

  const existing = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(
      and(
        eq(monthlyBudgetsTable.categoryId, categoryId),
        eq(monthlyBudgetsTable.year, year),
        eq(monthlyBudgetsTable.month, month),
      ),
    );

  let result;
  if (existing.length > 0) {
    const updates: {
      budgetAmount: string;
      rolloverApplied: boolean;
      rolloverOverride?: string | null;
    } = { budgetAmount: moneyForDb(budgetAmount), rolloverApplied: false };
    if (hasRolloverOverride) updates.rolloverOverride = rolloverOverrideForDb ?? null;

    const [updated] = await db
      .update(monthlyBudgetsTable)
      .set(updates)
      .where(eq(monthlyBudgetsTable.id, existing[0].id))
      .returning();
    result = updated;
  } else {
    const [inserted] = await db
      .insert(monthlyBudgetsTable)
      .values({
        categoryId,
        year,
        month,
        budgetAmount: moneyForDb(budgetAmount),
        rolloverOverride: rolloverOverrideForDb ?? null,
        rolloverApplied: false,
      })
      .returning();
    result = inserted;
  }

  res.json({
    ...result,
    budgetAmount: moneyForApi(budgetAmount),
    rolloverOverride: rolloverOverrideAmount(result),
    rolloverApplied: false,
  });
});

// ── Transactions ──────────────────────────────────────────────────────────

// Monthly Income
router.get("/budget/income", async (req, res): Promise<void> => {
  const parsed = parseYearMonthValues(req.query as Record<string, unknown>);
  if (!parsed) {
    res.status(400).json({ error: "year and month are required" });
    return;
  }

  const [income] = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, parsed.year), eq(monthlyIncomeTable.month, parsed.month)));

  res.json({
    year: parsed.year,
    month: parsed.month,
    amount: Number(income?.amount ?? 0),
  });
});

router.put("/budget/income", async (req, res): Promise<void> => {
  const parsed = parseMonthlyIncomeBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "year, month, and a non-negative amount are required" });
    return;
  }

  const existing = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, parsed.year), eq(monthlyIncomeTable.month, parsed.month)));

  const [income] =
    existing.length > 0
      ? await db
          .update(monthlyIncomeTable)
          .set({ amount: String(parsed.amount), updatedAt: new Date() })
          .where(eq(monthlyIncomeTable.id, existing[0].id))
          .returning()
      : await db
          .insert(monthlyIncomeTable)
          .values({ year: parsed.year, month: parsed.month, amount: String(parsed.amount) })
          .returning();

  res.json({
    id: income.id,
    year: income.year,
    month: income.month,
    amount: Number(income.amount),
    updatedAt: income.updatedAt.toISOString(),
  });
});

// Transactions
router.get("/transactions", async (req, res): Promise<void> => {
  const parsed = ListTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { year, month, categoryId, limit } = parsed.data;
  const conditions = [];

  if (year !== undefined && month !== undefined) {
    const monthStr = String(month).padStart(2, "0");
    const prefix = `${year}-${monthStr}`;
    conditions.push(sql`${transactionsTable.date} LIKE ${prefix + "%"}`);
  }

  const rows = await db
    .select(transactionSelectFields())
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${transactionsTable.date} DESC`, sql`${transactionsTable.createdAt} DESC`);

  const serialized = await serializeTransactionRows(rows);
  const filtered = categoryId === undefined
    ? serialized
    : serialized.filter((txn) =>
        txn.type === "expense" && txn.splits.some((split) => split.categoryId === categoryId),
      );

  res.json(limit ? filtered.slice(0, limit) : filtered);
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const type = parsed.data.type ?? "expense";
  const amount = parsed.data.amount;
  const merchant = parsed.data.merchant.trim();
  if (!merchant) {
    res.status(400).json({ error: "Merchant is required." });
    return;
  }

  const normalized = normalizeTransactionParts(type, amount, parsed.data.categoryId ?? null, parsed.data.splits);
  if ("error" in normalized) {
    res.status(400).json({ error: normalized.error });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const txn = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(transactionsTable)
      .values({
        transactionType: type,
        amount: moneyForDb(amount),
        merchant,
        categoryId: normalized.categoryId,
        date: parsed.data.date ? parsed.data.date.toISOString().slice(0, 10) : today,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    if (normalized.splits.length > 0) {
      await tx.insert(transactionSplitsTable).values(
        normalized.splits.map((split) => ({
          transactionId: created.id,
          categoryId: split.categoryId,
          amount: moneyForDb(split.amount),
        })),
      );
    }

    return created;
  });

  const [withCat] = await db
    .select(transactionSelectFields())
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(eq(transactionsTable.id, txn.id));

  const [serialized] = await serializeTransactionRows([withCat]);
  res.status(201).json(serialized);
});

router.put("/transactions/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "transaction id");
    return;
  }
  const parsed = UpdateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  const nextType = normalizeTransactionType(d.type ?? existing.transactionType);
  const nextAmount = d.amount ?? Number(existing.amount);
  const touchesBudgetShape =
    d.type !== undefined || d.amount !== undefined || "categoryId" in d || "splits" in d;
  let nextSplits: { categoryId: number | null; amount: number }[] | null = null;

  if (touchesBudgetShape) {
    let splitSource = "splits" in d ? d.splits : undefined;

    if (!("splits" in d) && !("categoryId" in d)) {
      const existingSplits = (await loadTransactionSplits([id])).get(id) ?? [];
      splitSource = existingSplits.map((split) => ({
        categoryId: split.categoryId,
        amount: split.amount,
      }));

      if (splitSource.length === 1 && d.amount !== undefined) {
        splitSource = [{ ...splitSource[0], amount: nextAmount }];
      }
    }

    const normalized = normalizeTransactionParts(
      nextType,
      nextAmount,
      "categoryId" in d ? d.categoryId ?? null : existing.categoryId,
      splitSource,
    );

    if ("error" in normalized) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    updates.transactionType = nextType;
    updates.amount = moneyForDb(nextAmount);
    updates.categoryId = normalized.categoryId;
    nextSplits = normalized.splits;
  }

  if (d.merchant !== undefined) {
    const merchant = d.merchant.trim();
    if (!merchant) {
      res.status(400).json({ error: "Merchant is required." });
      return;
    }
    updates.merchant = merchant;
  }
  if (d.date !== undefined) updates.date = d.date.toISOString().slice(0, 10);
  if ("notes" in d) updates.notes = d.notes ?? null;

  await db.transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.update(transactionsTable).set(updates).where(eq(transactionsTable.id, id));
    }

    if (nextSplits !== null) {
      await tx.delete(transactionSplitsTable).where(eq(transactionSplitsTable.transactionId, id));
      if (nextSplits.length > 0) {
        await tx.insert(transactionSplitsTable).values(
          nextSplits.map((split) => ({
            transactionId: id,
            categoryId: split.categoryId,
            amount: moneyForDb(split.amount),
          })),
        );
      }
    }
  });

  const [withCat] = await db
    .select(transactionSelectFields())
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(eq(transactionsTable.id, id));

  if (!withCat) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const [serialized] = await serializeTransactionRows([withCat]);
  res.json(serialized);
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "transaction id");
    return;
  }
  await db.delete(transactionsTable).where(eq(transactionsTable.id, id));
  res.sendStatus(204);
});

// ── Budget Dashboard ──────────────────────────────────────────────────────

/**
 * Compute per-category rollover by chaining all prior months.
 *
 * Algorithm (per category):
 *  1. Gather every month-budget row that predates the requested month,
 *     sorted chronologically.
 *  2. Walk through them in order, tracking a running "left" balance.
 *     Each month: available = budgeted + runningLeft ; left = available - spent.
 *  3. The final runningLeft after processing all prior months becomes the
 *     rollover for the requested month.
 *
 * This ensures Feb surplus → Mar available → Mar surplus → Apr available, etc.
 */
async function computeRollovers(
  categories: { id: number }[],
  year: number,
  month: number,
): Promise<Map<number, number>> {
  // All budget rows strictly before the requested month
  const priorBudgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(
      or(
        lt(monthlyBudgetsTable.year, year),
        and(
          eq(monthlyBudgetsTable.year, year),
          lt(monthlyBudgetsTable.month, month),
        ),
      ),
    );

  if (priorBudgets.length === 0) {
    return new Map(categories.map((c) => [c.id, 0]));
  }

  // All transactions strictly before the requested month
  const monthStr = String(month).padStart(2, "0");
  const cutoff = `${year}-${monthStr}`;
  const priorTxns = await db
    .select()
    .from(transactionsTable)
    .where(sql`${transactionsTable.date} < ${cutoff}`);
  const priorSpendingEntries = await buildSpendingEntries(priorTxns);
  return computeRolloversFromRows(categories, priorBudgets, priorSpendingEntries, year, month);
}

router.get("/budget/dashboard", async (req, res): Promise<void> => {
  const parsed = GetBudgetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { year: qYear, month: qMonth } = parsed.data;
  const { year, month } = qYear && qMonth ? { year: qYear, month: qMonth } : currentYearMonth();

  const categories = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(budgetCategoriesTable.sortOrder, budgetCategoriesTable.name);

  await ensureMonthlyBudgetRows(categories, year, month);

  const monthlyBudgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(
      and(eq(monthlyBudgetsTable.year, year), eq(monthlyBudgetsTable.month, month)),
    );

  const monthStr = String(month).padStart(2, "0");
  const prefix = `${year}-${monthStr}`;
  const txns = await db
    .select()
    .from(transactionsTable)
    .where(sql`${transactionsTable.date} LIKE ${prefix + "%"}`);
  const spendingEntries = await buildSpendingEntries(txns);
  const incomeTransactionsTotal = txns
    .filter((txn) => normalizeTransactionType(txn.transactionType) === "income")
    .reduce((sum, txn) => sum + Number(txn.amount), 0);

  const [monthlyIncome] = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, year), eq(monthlyIncomeTable.month, month)));

  // Full chain rollover for every category
  const rollovers = await computeRollovers(categories, year, month);

  const lines = categories.map((cat) => {
    const budgetEntry = monthlyBudgets.find((b) => b.categoryId === cat.id);
    const computedRollover = rollovers.get(cat.id) ?? 0;
    const rolloverOverride = rolloverOverrideAmount(budgetEntry);
    const rollover = rolloverOverride ?? computedRollover;
    const budgeted = baseBudgetAmount(budgetEntry, computedRollover);
    const spent = spendingEntries
      .filter((entry) => entry.categoryId === cat.id)
      .reduce((sum, entry) => sum + entry.amount, 0);

    const available = moneyForApi(budgeted + rollover);
    const left = moneyForApi(available - spent);

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      categoryGroupName: cat.groupName,
      budgeted,
      computedRollover,
      rolloverOverride,
      rollover,
      available,
      spent,
      left,
    };
  });

  const totalBudgeted = lines.reduce((s, l) => s + l.budgeted, 0);
  const totalRollover = lines.reduce((s, l) => s + l.rollover, 0);
  const totalAvailable = lines.reduce((s, l) => s + l.available, 0);
  const totalSpent = spendingEntries.reduce((s, entry) => s + entry.amount, 0);
  const totalLeft = totalAvailable - totalSpent;
  const incomeAmount = Number(monthlyIncome?.amount ?? 0);
  const incomeRemaining = incomeAmount - totalSpent;
  const budgetOverUnder = incomeAmount - totalBudgeted;

  const recentTxns = await db
    .select(transactionSelectFields())
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(sql`${transactionsTable.date} LIKE ${prefix + "%"}`)
    .orderBy(sql`${transactionsTable.date} DESC`)
    .limit(10);

  res.json({
    year,
    month,
    totalBudgeted,
    totalRollover,
    totalAvailable,
    totalSpent,
    totalLeft,
    incomeAmount,
    incomeTransactionsTotal,
    incomeRemaining,
    budgetOverUnder,
    categories: lines,
    recentTransactions: await serializeTransactionRows(recentTxns),
  });
});

// ── Annual Review ─────────────────────────────────────────────────────────

router.get("/budget/annual", async (req, res): Promise<void> => {
  const parsed = GetAnnualReviewQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { year } = parsed.data;

  const categories = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(budgetCategoriesTable.sortOrder);

  const yearBudgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(eq(monthlyBudgetsTable.year, year));

  const yearTxns = await db
    .select()
    .from(transactionsTable)
    .where(sql`${transactionsTable.date} LIKE ${String(year) + "-%"}`);
  const yearSpendingEntries = await buildSpendingEntries(yearTxns);
  const rolloversByMonth = new Map<number, Map<number, number>>();
  for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
    rolloversByMonth.set(monthIndex, await computeRollovers(categories, year, monthIndex));
  }

  const catRows = categories.map((cat) => {
    const monthlyData = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const budgetEntry = yearBudgets.find((b) => b.categoryId === cat.id && b.month === m);
      const computedRollover = rolloversByMonth.get(m)?.get(cat.id) ?? 0;
      const budgeted = baseBudgetAmount(budgetEntry, computedRollover);
      const monthStr = String(m).padStart(2, "0");
      const spent = yearSpendingEntries
        .filter((entry) => entry.categoryId === cat.id && entry.date.startsWith(`${year}-${monthStr}`))
        .reduce((s, entry) => s + entry.amount, 0);
      return { month: m, budgeted, spent };
    });

    const totalBudgeted = monthlyData.reduce((s, m) => s + m.budgeted, 0);
    const totalSpent = monthlyData.reduce((s, m) => s + m.spent, 0);

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      totalBudgeted,
      totalSpent,
      monthlyData,
    };
  });

  res.json({
    year,
    totalBudgeted: catRows.reduce((s, c) => s + c.totalBudgeted, 0),
    totalSpent: catRows.reduce((s, c) => s + c.totalSpent, 0),
    categories: catRows,
  });
});

// ── Home Snapshot ─────────────────────────────────────────────────────────

router.get("/home/snapshot", async (_req, res): Promise<void> => {
  const { year, month } = currentYearMonth();
  const today = new Date().toISOString().split("T")[0];

  // Today tasks
  const { tasksTable } = await import("@workspace/db");
  const { isNull: isNullFn, or: orFn } = await import("drizzle-orm");
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        isNullFn(tasksTable.parentTaskId),
        eq(tasksTable.completed, false),
        orFn(
          eq(tasksTable.dueDate, today),
          isNullFn(tasksTable.dueDate),
        ),
      ),
    )
    .orderBy(tasksTable.sortOrder, tasksTable.createdAt);

  const me = tasks.filter((t) => t.assignee === "me").map(serializeTask);
  const wife = tasks.filter((t) => t.assignee === "wife").map(serializeTask);
  const shared = tasks.filter((t) => t.assignee === "us").map(serializeTask);

  // Budget snapshot — uses full chain rollover just like the dashboard
  const monthStr = String(month).padStart(2, "0");
  const prefix = `${year}-${monthStr}`;

  const categories = await db.select().from(budgetCategoriesTable);
  await ensureMonthlyBudgetRows(categories, year, month);
  const budgets = await db.select().from(monthlyBudgetsTable).where(
    and(eq(monthlyBudgetsTable.year, year), eq(monthlyBudgetsTable.month, month)),
  );
  const txns = await db.select().from(transactionsTable).where(
    sql`${transactionsTable.date} LIKE ${prefix + "%"}`,
  );
  const spendingEntries = await buildSpendingEntries(txns);
  const incomeTransactionsTotal = txns
    .filter((txn) => normalizeTransactionType(txn.transactionType) === "income")
    .reduce((sum, txn) => sum + Number(txn.amount), 0);
  const [monthlyIncome] = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, year), eq(monthlyIncomeTable.month, month)));

  const snapshotRollovers = await computeRollovers(categories, year, month);
  const totalBudgeted = budgets.reduce((sum, budget) => (
    sum + baseBudgetAmount(budget, snapshotRollovers.get(budget.categoryId) ?? 0)
  ), 0);
  const totalRollover = categories.reduce((sum, category) => {
    const budget = budgets.find((item) => item.categoryId === category.id);
    const computedRollover = snapshotRollovers.get(category.id) ?? 0;
    return sum + effectiveRollover(budget, computedRollover);
  }, 0);
  const totalSpent = spendingEntries.reduce((s, entry) => s + entry.amount, 0);
  const totalAvailable = moneyForApi(totalBudgeted + totalRollover);
  const totalLeft = moneyForApi(totalAvailable - totalSpent);
  const incomeAmount = Number(monthlyIncome?.amount ?? 0);

  // Recent transactions
  const recentTxns = await db
    .select(transactionSelectFields())
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(sql`${transactionsTable.date} LIKE ${prefix + "%"}`)
    .orderBy(sql`${transactionsTable.date} DESC`)
    .limit(5);

  res.json({
    todayTasks: {
      me,
      wife,
      shared,
      totalToday: me.length + wife.length + shared.length,
      completedToday: 0,
    },
    budgetSnapshot: {
      totalAvailable,
      totalSpent,
      totalLeft,
      incomeAmount,
      incomeTransactionsTotal,
      incomeRemaining: incomeAmount - totalSpent,
      month,
      year,
    },
    recentTransactions: await serializeTransactionRows(recentTxns),
  });
});

function serializeTransaction(t: {
  id: number;
  transactionType: string;
  amount: string | number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null | undefined;
  date: string;
  notes: string | null;
  createdAt: Date;
}, splitRows: SerializedTransactionSplit[] = []) {
  const type = normalizeTransactionType(t.transactionType);
  const splits = type === "expense"
    ? splitRows.length > 0
      ? splitRows
      : [{
          id: null,
          categoryId: t.categoryId ?? null,
          categoryName: t.categoryName ?? null,
          amount: Number(t.amount),
        }]
    : [];
  const primarySplit = splits.length === 1 ? splits[0] : null;

  return {
    id: t.id,
    type,
    amount: Number(t.amount),
    merchant: t.merchant,
    categoryId: type === "expense" ? primarySplit?.categoryId ?? null : null,
    categoryName: type === "income"
      ? "Income"
      : primarySplit
      ? primarySplit.categoryName
      : splits.length > 1
      ? "Split transaction"
      : t.categoryName ?? null,
    splits,
    date: t.date,
    notes: t.notes ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

function serializeTask(task: {
  id: number;
  title: string;
  assignee: string | null;
  dueDate: string | null;
  recurring: string | null;
  notes: string | null;
  category: string | null;
  completed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    title: task.title,
    assignee: task.assignee,
    dueDate: task.dueDate,
    recurring: task.recurring,
    notes: task.notes,
    category: task.category,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export default router;
