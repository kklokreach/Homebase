import { Router, type IRouter } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, reserveFundsTable, reserveTransactionsTable } from "@workspace/db";

const router: IRouter = Router();

type ReserveTransactionType = "contribution" | "withdrawal" | "adjustment";

type ReserveFundInput = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
  targetAmount?: number | null;
};

type ReserveTransactionInput = {
  reserveFundId?: number;
  type?: ReserveTransactionType;
  amount?: number;
  date?: string;
  notes?: string | null;
};

function getIdFromParams(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  return parseInt(raw, 10);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalText(
  value: unknown,
  field: string,
): string | null | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return { error: `${field} must be a string or null` };

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseOptionalInteger(value: unknown, field: string): number | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: `${field} must be an integer` };
  }
  return value;
}

function parseOptionalNumber(
  value: unknown,
  field: string,
): number | null | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `${field} must be a number or null` };
  }
  return value;
}

function parseOptionalDateString(
  value: unknown,
  field: string,
): string | { error: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${field} must be a date string in YYYY-MM-DD format` };
  }
  return value;
}

function isErrorResult<T>(value: T | { error: string }): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

function validateReserveFundBody(body: unknown, partial: boolean): ReserveFundInput | { error: string } {
  if (!isPlainObject(body)) return { error: "Body must be an object" };

  const nameRaw = body["name"];
  const icon = parseOptionalText(body["icon"], "icon");
  const color = parseOptionalText(body["color"], "color");
  const sortOrder = parseOptionalInteger(body["sortOrder"], "sortOrder");
  const targetAmount = parseOptionalNumber(body["targetAmount"], "targetAmount");

  if (isErrorResult(icon)) return icon;
  if (isErrorResult(color)) return color;
  if (isErrorResult(sortOrder)) return sortOrder;
  if (isErrorResult(targetAmount)) return targetAmount;
  if (targetAmount !== undefined && targetAmount !== null && targetAmount < 0) {
    return { error: "targetAmount must be greater than or equal to 0" };
  }

  let name: string | undefined;
  if (nameRaw !== undefined) {
    if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
      return { error: "name must be a non-empty string" };
    }
    name = nameRaw.trim();
  } else if (!partial) {
    return { error: "name is required" };
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    ...(targetAmount !== undefined ? { targetAmount } : {}),
  };
}

function validateReserveTransactionBody(
  body: unknown,
  partial: boolean,
): ReserveTransactionInput | { error: string } {
  if (!isPlainObject(body)) return { error: "Body must be an object" };

  const reserveFundIdRaw = body["reserveFundId"];
  const typeRaw = body["type"];
  const amountRaw = body["amount"];
  const date = parseOptionalDateString(body["date"], "date");
  const notes = parseOptionalText(body["notes"], "notes");

  if (isErrorResult(date)) return date;
  if (isErrorResult(notes)) return notes;

  let reserveFundId: number | undefined;
  if (reserveFundIdRaw !== undefined) {
    if (typeof reserveFundIdRaw !== "number" || !Number.isInteger(reserveFundIdRaw) || reserveFundIdRaw <= 0) {
      return { error: "reserveFundId must be a positive integer" };
    }
    reserveFundId = reserveFundIdRaw;
  } else if (!partial) {
    return { error: "reserveFundId is required" };
  }

  let type: ReserveTransactionType | undefined;
  if (typeRaw !== undefined) {
    if (
      typeRaw !== "contribution" &&
      typeRaw !== "withdrawal" &&
      typeRaw !== "adjustment"
    ) {
      return { error: "type must be contribution, withdrawal, or adjustment" };
    }
    type = typeRaw;
  } else if (!partial) {
    return { error: "type is required" };
  }

  let amount: number | undefined;
  if (amountRaw !== undefined) {
    if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw)) {
      return { error: "amount must be a number" };
    }
    if (type === "contribution" || type === "withdrawal") {
      if (amountRaw <= 0) {
        return { error: `${type} amount must be greater than 0` };
      }
    }
    amount = amountRaw;
  } else if (!partial) {
    return { error: "amount is required" };
  }

  return {
    ...(reserveFundId !== undefined ? { reserveFundId } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function normalizeReserveDelta(type: ReserveTransactionType, amount: number): number {
  if (type === "contribution") return amount;
  if (type === "withdrawal") return -amount;
  return amount;
}

function toTodayString() {
  return new Date().toISOString().split("T")[0];
}

async function buildReserveFundSummaries(fundIds?: number[]) {
  const funds =
    fundIds && fundIds.length > 0
      ? await db
          .select()
          .from(reserveFundsTable)
          .where(inArray(reserveFundsTable.id, fundIds))
          .orderBy(reserveFundsTable.sortOrder, reserveFundsTable.name)
      : await db
          .select()
          .from(reserveFundsTable)
          .orderBy(reserveFundsTable.sortOrder, reserveFundsTable.name);

  const transactions =
    fundIds && fundIds.length > 0
      ? await db
          .select()
          .from(reserveTransactionsTable)
          .where(inArray(reserveTransactionsTable.reserveFundId, fundIds))
          .orderBy(sql`${reserveTransactionsTable.date} DESC`, sql`${reserveTransactionsTable.createdAt} DESC`)
      : await db
          .select()
          .from(reserveTransactionsTable)
          .orderBy(sql`${reserveTransactionsTable.date} DESC`, sql`${reserveTransactionsTable.createdAt} DESC`);

  const grouped = new Map<number, typeof reserveTransactionsTable.$inferSelect[]>();
  for (const tx of transactions) {
    if (!grouped.has(tx.reserveFundId)) grouped.set(tx.reserveFundId, []);
    grouped.get(tx.reserveFundId)!.push(tx);
  }

  return funds.map((fund) => {
    const fundTxs = grouped.get(fund.id) ?? [];
    const balance = fundTxs.reduce(
      (sum, tx) => sum + normalizeReserveDelta(tx.type as ReserveTransactionType, Number(tx.amount)),
      0,
    );
    const targetAmount = fund.targetAmount === null ? null : Number(fund.targetAmount);
    const progress =
      targetAmount && targetAmount > 0
        ? Math.max(0, Math.min(100, (balance / targetAmount) * 100))
        : null;

    return {
      id: fund.id,
      name: fund.name,
      icon: fund.icon,
      color: fund.color,
      sortOrder: fund.sortOrder,
      targetAmount,
      balance,
      progress,
      transactionCount: fundTxs.length,
      createdAt: fund.createdAt.toISOString(),
      updatedAt: fund.updatedAt.toISOString(),
    };
  });
}

async function getReserveFundSummaryById(id: number) {
  const [summary] = await buildReserveFundSummaries([id]);
  return summary ?? null;
}

function serializeReserveTransaction(row: {
  id: number;
  reserveFundId: number;
  reserveFundName: string;
  type: string;
  amount: string;
  date: string;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    reserveFundId: row.reserveFundId,
    reserveFundName: row.reserveFundName,
    type: row.type,
    amount: Number(row.amount),
    date: row.date,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/reserves/funds", async (_req, res): Promise<void> => {
  const funds = await buildReserveFundSummaries();
  res.json(funds);
});

router.post("/reserves/funds", async (req, res): Promise<void> => {
  const parsed = validateReserveFundBody(req.body, false);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [fund] = await db
    .insert(reserveFundsTable)
    .values({
      name: parsed.name!,
      icon: parsed.icon ?? null,
      color: parsed.color ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      targetAmount: parsed.targetAmount === null || parsed.targetAmount === undefined ? null : String(parsed.targetAmount),
    })
    .returning();

  const summary = await getReserveFundSummaryById(fund.id);
  res.status(201).json(summary);
});

router.put("/reserves/funds/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const parsed = validateReserveFundBody(req.body, true);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if ("icon" in parsed) updates.icon = parsed.icon ?? null;
  if ("color" in parsed) updates.color = parsed.color ?? null;
  if (parsed.sortOrder !== undefined) updates.sortOrder = parsed.sortOrder;
  if ("targetAmount" in parsed) {
    updates.targetAmount =
      parsed.targetAmount === null || parsed.targetAmount === undefined
        ? null
        : String(parsed.targetAmount);
  }

  const [fund] = await db
    .update(reserveFundsTable)
    .set(updates)
    .where(eq(reserveFundsTable.id, id))
    .returning();

  if (!fund) {
    res.status(404).json({ error: "Reserve fund not found" });
    return;
  }

  const summary = await getReserveFundSummaryById(id);
  res.json(summary);
});

router.delete("/reserves/funds/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [fund] = await db.delete(reserveFundsTable).where(eq(reserveFundsTable.id, id)).returning();
  if (!fund) {
    res.status(404).json({ error: "Reserve fund not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/reserves/transactions", async (req, res): Promise<void> => {
  const reserveFundIdRaw = req.query["reserveFundId"];
  const limitRaw = req.query["limit"];

  let reserveFundId: number | undefined;
  if (reserveFundIdRaw !== undefined) {
    const parsedId = Number(Array.isArray(reserveFundIdRaw) ? reserveFundIdRaw[0] : reserveFundIdRaw);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      res.status(400).json({ error: "reserveFundId must be a positive integer" });
      return;
    }
    reserveFundId = parsedId;
  }

  let limit: number | undefined;
  if (limitRaw !== undefined) {
    const parsedLimit = Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: "limit must be a positive integer" });
      return;
    }
    limit = parsedLimit;
  }

  const query = db
    .select({
      id: reserveTransactionsTable.id,
      reserveFundId: reserveTransactionsTable.reserveFundId,
      reserveFundName: reserveFundsTable.name,
      type: reserveTransactionsTable.type,
      amount: reserveTransactionsTable.amount,
      date: reserveTransactionsTable.date,
      notes: reserveTransactionsTable.notes,
      createdAt: reserveTransactionsTable.createdAt,
    })
    .from(reserveTransactionsTable)
    .innerJoin(reserveFundsTable, eq(reserveTransactionsTable.reserveFundId, reserveFundsTable.id))
    .where(reserveFundId ? eq(reserveTransactionsTable.reserveFundId, reserveFundId) : undefined)
    .orderBy(sql`${reserveTransactionsTable.date} DESC`, sql`${reserveTransactionsTable.createdAt} DESC`);

  if (limit) {
    query.limit(limit);
  }

  const txns = await query;
  res.json(txns.map(serializeReserveTransaction));
});

router.post("/reserves/transactions", async (req, res): Promise<void> => {
  const parsed = validateReserveTransactionBody(req.body, false);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [fund] = await db.select().from(reserveFundsTable).where(eq(reserveFundsTable.id, parsed.reserveFundId!));
  if (!fund) {
    res.status(404).json({ error: "Reserve fund not found" });
    return;
  }

  const [created] = await db
    .insert(reserveTransactionsTable)
    .values({
      reserveFundId: parsed.reserveFundId!,
      type: parsed.type!,
      amount: String(parsed.amount!),
      date: parsed.date ?? toTodayString(),
      notes: parsed.notes ?? null,
    })
    .returning();

  const [withFund] = await db
    .select({
      id: reserveTransactionsTable.id,
      reserveFundId: reserveTransactionsTable.reserveFundId,
      reserveFundName: reserveFundsTable.name,
      type: reserveTransactionsTable.type,
      amount: reserveTransactionsTable.amount,
      date: reserveTransactionsTable.date,
      notes: reserveTransactionsTable.notes,
      createdAt: reserveTransactionsTable.createdAt,
    })
    .from(reserveTransactionsTable)
    .innerJoin(reserveFundsTable, eq(reserveTransactionsTable.reserveFundId, reserveFundsTable.id))
    .where(eq(reserveTransactionsTable.id, created.id));

  res.status(201).json(serializeReserveTransaction(withFund));
});

router.put("/reserves/transactions/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [existing] = await db.select().from(reserveTransactionsTable).where(eq(reserveTransactionsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Reserve transaction not found" });
    return;
  }

  const parsed = validateReserveTransactionBody(req.body, true);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const effectiveType = parsed.type ?? (existing.type as ReserveTransactionType);
  const effectiveAmount = parsed.amount ?? Number(existing.amount);
  if ((effectiveType === "contribution" || effectiveType === "withdrawal") && effectiveAmount <= 0) {
    res.status(400).json({ error: `${effectiveType} amount must be greater than 0` });
    return;
  }

  if (parsed.reserveFundId !== undefined) {
    const [fund] = await db.select().from(reserveFundsTable).where(eq(reserveFundsTable.id, parsed.reserveFundId));
    if (!fund) {
      res.status(404).json({ error: "Reserve fund not found" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (parsed.reserveFundId !== undefined) updates.reserveFundId = parsed.reserveFundId;
  if (parsed.type !== undefined) updates.type = parsed.type;
  if (parsed.amount !== undefined) updates.amount = String(parsed.amount);
  if (parsed.date !== undefined) updates.date = parsed.date;
  if ("notes" in parsed) updates.notes = parsed.notes ?? null;

  const [updated] = await db
    .update(reserveTransactionsTable)
    .set(updates)
    .where(eq(reserveTransactionsTable.id, id))
    .returning();

  const [withFund] = await db
    .select({
      id: reserveTransactionsTable.id,
      reserveFundId: reserveTransactionsTable.reserveFundId,
      reserveFundName: reserveFundsTable.name,
      type: reserveTransactionsTable.type,
      amount: reserveTransactionsTable.amount,
      date: reserveTransactionsTable.date,
      notes: reserveTransactionsTable.notes,
      createdAt: reserveTransactionsTable.createdAt,
    })
    .from(reserveTransactionsTable)
    .innerJoin(reserveFundsTable, eq(reserveTransactionsTable.reserveFundId, reserveFundsTable.id))
    .where(eq(reserveTransactionsTable.id, id));

  res.json(serializeReserveTransaction(withFund));
});

router.delete("/reserves/transactions/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [tx] = await db.delete(reserveTransactionsTable).where(eq(reserveTransactionsTable.id, id)).returning();
  if (!tx) {
    res.status(404).json({ error: "Reserve transaction not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
