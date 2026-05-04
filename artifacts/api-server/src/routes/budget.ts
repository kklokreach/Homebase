import { Router, type IRouter } from "express";
import { and, eq, inArray, or, lt, sql } from "drizzle-orm";
import {
  db,
  budgetCategoriesTable,
  monthlyBudgetsTable,
  monthlyIncomeTable,
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

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
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
  const [cat] = await db
    .insert(budgetCategoriesTable)
    .values({
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
      groupName: parsed.data.groupName?.trim() || null,
      sortOrder: parsed.data.sortOrder ?? 0,
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

  const budgets = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json(budgets.map((b) => ({ ...b, budgetAmount: Number(b.budgetAmount) })));
});

router.post("/budget/monthly", async (req, res): Promise<void> => {
  const parsed = UpsertMonthlyBudgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { categoryId, year, month, budgetAmount } = parsed.data;

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
    const [updated] = await db
      .update(monthlyBudgetsTable)
      .set({ budgetAmount: String(budgetAmount) })
      .where(eq(monthlyBudgetsTable.id, existing[0].id))
      .returning();
    result = updated;
  } else {
    const [inserted] = await db
      .insert(monthlyBudgetsTable)
      .values({ categoryId, year, month, budgetAmount: String(budgetAmount) })
      .returning();
    result = inserted;
  }

  res.json({ ...result, budgetAmount: Number(result.budgetAmount) });
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
  if (categoryId !== undefined) {
    conditions.push(eq(transactionsTable.categoryId, categoryId));
  }

  const query = db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      merchant: transactionsTable.merchant,
      categoryId: transactionsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      date: transactionsTable.date,
      notes: transactionsTable.notes,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${transactionsTable.date} DESC`, sql`${transactionsTable.createdAt} DESC`);

  if (limit) {
    query.limit(limit);
  }

  const txns = await query;
  res.json(txns.map(serializeTransaction));
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  const [txn] = await db
    .insert(transactionsTable)
    .values({
      amount: String(parsed.data.amount),
      merchant: parsed.data.merchant,
      categoryId: parsed.data.categoryId ?? null,
      date: parsed.data.date ? parsed.data.date.toISOString().slice(0, 10) : today,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  const [withCat] = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      merchant: transactionsTable.merchant,
      categoryId: transactionsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      date: transactionsTable.date,
      notes: transactionsTable.notes,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(eq(transactionsTable.id, txn.id));

  res.status(201).json(serializeTransaction(withCat));
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
  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.amount !== undefined) updates.amount = String(d.amount);
  if (d.merchant !== undefined) updates.merchant = d.merchant;
  if ("categoryId" in d) updates.categoryId = d.categoryId ?? null;
  if (d.date !== undefined) updates.date = d.date.toISOString().slice(0, 10);
  if ("notes" in d) updates.notes = d.notes ?? null;

  await db.update(transactionsTable).set(updates).where(eq(transactionsTable.id, id));

  const [withCat] = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      merchant: transactionsTable.merchant,
      categoryId: transactionsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      date: transactionsTable.date,
      notes: transactionsTable.notes,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .leftJoin(budgetCategoriesTable, eq(transactionsTable.categoryId, budgetCategoriesTable.id))
    .where(eq(transactionsTable.id, id));

  if (!withCat) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(serializeTransaction(withCat));
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

  const rollovers = new Map<number, number>();

  for (const cat of categories) {
    const catBudgets = priorBudgets
      .filter((b) => b.categoryId === cat.id)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    let runningLeft = 0;
    for (const b of catBudgets) {
      const ms = String(b.month).padStart(2, "0");
      const prefix = `${b.year}-${ms}`;
      const spent = priorTxns
        .filter((t) => t.categoryId === cat.id && t.date.startsWith(prefix))
        .reduce((sum, t) => sum + Number(t.amount), 0);
      const available = Number(b.budgetAmount) + runningLeft;
      runningLeft = available - spent;
    }

    rollovers.set(cat.id, runningLeft);
  }

  return rollovers;
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
    .orderBy(budgetCategoriesTable.sortOrder);

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

  const [monthlyIncome] = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, year), eq(monthlyIncomeTable.month, month)));

  // Full chain rollover for every category
  const rollovers = await computeRollovers(categories, year, month);

  const lines = categories.map((cat) => {
    const budgetEntry = monthlyBudgets.find((b) => b.categoryId === cat.id);
    const budgeted = Number(budgetEntry?.budgetAmount ?? 0);
    const spent = txns
      .filter((t) => t.categoryId === cat.id)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const rollover = rollovers.get(cat.id) ?? 0;
    const available = budgeted + rollover;
    const left = available - spent;

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      categoryGroupName: cat.groupName,
      budgeted,
      rollover,
      available,
      spent,
      left,
    };
  });

  const totalBudgeted = lines.reduce((s, l) => s + l.budgeted, 0);
  const totalRollover = lines.reduce((s, l) => s + l.rollover, 0);
  const totalAvailable = lines.reduce((s, l) => s + l.available, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  const totalLeft = lines.reduce((s, l) => s + l.left, 0);
  const incomeAmount = Number(monthlyIncome?.amount ?? 0);
  const incomeRemaining = incomeAmount - totalSpent;
  const budgetOverUnder = incomeAmount - totalBudgeted;

  const recentTxns = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      merchant: transactionsTable.merchant,
      categoryId: transactionsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      date: transactionsTable.date,
      notes: transactionsTable.notes,
      createdAt: transactionsTable.createdAt,
    })
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
    incomeRemaining,
    budgetOverUnder,
    categories: lines,
    recentTransactions: recentTxns.map(serializeTransaction),
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

  const catRows = categories.map((cat) => {
    const monthlyData = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const budgetEntry = yearBudgets.find((b) => b.categoryId === cat.id && b.month === m);
      const budgeted = Number(budgetEntry?.budgetAmount ?? 0);
      const monthStr = String(m).padStart(2, "0");
      const spent = yearTxns
        .filter((t) => t.categoryId === cat.id && t.date.startsWith(`${year}-${monthStr}`))
        .reduce((s, t) => s + Number(t.amount), 0);
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
  const budgets = await db.select().from(monthlyBudgetsTable).where(
    and(eq(monthlyBudgetsTable.year, year), eq(monthlyBudgetsTable.month, month)),
  );
  const txns = await db.select().from(transactionsTable).where(
    sql`${transactionsTable.date} LIKE ${prefix + "%"}`,
  );
  const [monthlyIncome] = await db
    .select()
    .from(monthlyIncomeTable)
    .where(and(eq(monthlyIncomeTable.year, year), eq(monthlyIncomeTable.month, month)));

  const snapshotRollovers = await computeRollovers(categories, year, month);
  const totalBudgeted = budgets.reduce((s, b) => s + Number(b.budgetAmount), 0);
  const totalRollover = Array.from(snapshotRollovers.values()).reduce((s, v) => s + v, 0);
  const totalSpent = txns.reduce((s, t) => s + Number(t.amount), 0);
  const totalAvailable = totalBudgeted + totalRollover;
  const totalLeft = totalAvailable - totalSpent;
  const incomeAmount = Number(monthlyIncome?.amount ?? 0);

  // Recent transactions
  const recentTxns = await db
    .select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      merchant: transactionsTable.merchant,
      categoryId: transactionsTable.categoryId,
      categoryName: budgetCategoriesTable.name,
      date: transactionsTable.date,
      notes: transactionsTable.notes,
      createdAt: transactionsTable.createdAt,
    })
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
      incomeRemaining: incomeAmount - totalSpent,
      month,
      year,
    },
    recentTransactions: recentTxns.map(serializeTransaction),
  });
});

function serializeTransaction(t: {
  id: number;
  amount: string | number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null | undefined;
  date: string;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: t.id,
    amount: Number(t.amount),
    merchant: t.merchant,
    categoryId: t.categoryId ?? null,
    categoryName: t.categoryName ?? null,
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
