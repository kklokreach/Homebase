/**
 * Seed script: two prior months (Feb + Mar 2026) of budget + transactions.
 * Run with:  npx tsx lib/db/seed.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema/index.js";
import { eq, and } from "drizzle-orm";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const { budgetCategoriesTable, monthlyBudgetsTable, transactionsTable } = schema;

async function upsertMonthlyBudget(
  categoryId: number,
  year: number,
  month: number,
  amount: number
) {
  const existing = await db
    .select()
    .from(monthlyBudgetsTable)
    .where(
      and(
        eq(monthlyBudgetsTable.categoryId, categoryId),
        eq(monthlyBudgetsTable.year, year),
        eq(monthlyBudgetsTable.month, month)
      )
    );
  if (existing.length > 0) return;
  await db.insert(monthlyBudgetsTable).values({
    categoryId,
    year,
    month,
    budgetAmount: String(amount),
  });
}

async function txnExists(merchant: string, date: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.merchant, merchant),
        eq(transactionsTable.date, date)
      )
    );
  return rows.length > 0;
}

async function addTxn(
  merchant: string,
  amount: number,
  categoryId: number,
  date: string
) {
  if (await txnExists(merchant, date)) return;
  await db.insert(transactionsTable).values({
    merchant,
    amount: String(amount),
    categoryId,
    date,
    notes: null,
  });
}

async function main() {
  // Fetch existing categories
  const cats = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(budgetCategoriesTable.sortOrder);

  const byName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const G = byName["Groceries"];    // 1
  const R = byName["Restaurants"];  // 2
  const Ga = byName["Gas"];         // 3
  const H = byName["Household"];    // 4
  const Ch = byName["Child"];       // 5
  const B = byName["Bills"];        // 6
  const Sh = byName["Shopping"];    // 7
  const M = byName["Misc"];         // 8

  if (!G) { console.error("Categories not found. Run migrations first."); process.exit(1); }

  // ── Feb 2026 Budgets ─────────────────────────────────────────────────────
  // Same envelope amounts as April
  await upsertMonthlyBudget(G,  2026, 2, 500);
  await upsertMonthlyBudget(R,  2026, 2, 150);
  await upsertMonthlyBudget(Ga, 2026, 2, 100);
  await upsertMonthlyBudget(H,  2026, 2, 200);
  await upsertMonthlyBudget(Ch, 2026, 2, 300);
  await upsertMonthlyBudget(B,  2026, 2, 400);
  await upsertMonthlyBudget(Sh, 2026, 2, 200);
  await upsertMonthlyBudget(M,  2026, 2, 100);

  // ── Feb 2026 Transactions ────────────────────────────────────────────────
  // Groceries: $420 spent (saved $80 → rolls to Mar)
  await addTxn("Whole Foods",       160, G,  "2026-02-03");
  await addTxn("Trader Joe's",      130, G,  "2026-02-11");
  await addTxn("Target Groceries",   80, G,  "2026-02-18");
  await addTxn("Whole Foods",        50, G,  "2026-02-24");

  // Restaurants: $195 spent (over $45 → -$45 rolls to Mar)
  await addTxn("Chipotle",           42, R,  "2026-02-05");
  await addTxn("Olive Garden",       85, R,  "2026-02-14");
  await addTxn("Panera",             38, R,  "2026-02-20");
  await addTxn("Pizza Hut",          30, R,  "2026-02-27");

  // Gas: $72 spent (saved $28 → rolls to Mar)
  await addTxn("Shell Gas",          38, Ga, "2026-02-06");
  await addTxn("BP Gas",             34, Ga, "2026-02-20");

  // Household: $168 spent (saved $32 → rolls to Mar)
  await addTxn("Home Depot",         95, H,  "2026-02-08");
  await addTxn("Amazon Household",   73, H,  "2026-02-22");

  // Child: $295 spent (saved $5 → rolls to Mar)
  await addTxn("Daycare Feb",       200, Ch, "2026-02-01");
  await addTxn("Kids Clothes",       55, Ch, "2026-02-15");
  await addTxn("Toy Store",          40, Ch, "2026-02-22");

  // Bills: $400 spent (exactly on budget, $0 rolls)
  await addTxn("Electric Bill Feb", 120, B,  "2026-02-03");
  await addTxn("Internet Feb",       60, B,  "2026-02-03");
  await addTxn("Phone Bill Feb",     80, B,  "2026-02-03");
  await addTxn("Streaming Feb",      40, B,  "2026-02-03");
  await addTxn("Insurance Feb",     100, B,  "2026-02-10");

  // Shopping: $260 spent (over $60 → -$60 rolls to Mar)
  await addTxn("Amazon Shopping",   140, Sh, "2026-02-10");
  await addTxn("Target Shopping",    75, Sh, "2026-02-16");
  await addTxn("TJ Maxx",           45, Sh, "2026-02-23");

  // Misc: $55 spent (saved $45 → rolls to Mar)
  await addTxn("CVS Pharmacy",       30, M,  "2026-02-09");
  await addTxn("Miscellaneous Feb",  25, M,  "2026-02-19");

  // ── Mar 2026 Budgets ─────────────────────────────────────────────────────
  await upsertMonthlyBudget(G,  2026, 3, 500);
  await upsertMonthlyBudget(R,  2026, 3, 150);
  await upsertMonthlyBudget(Ga, 2026, 3, 100);
  await upsertMonthlyBudget(H,  2026, 3, 200);
  await upsertMonthlyBudget(Ch, 2026, 3, 300);
  await upsertMonthlyBudget(B,  2026, 3, 400);
  await upsertMonthlyBudget(Sh, 2026, 3, 200);
  await upsertMonthlyBudget(M,  2026, 3, 100);

  // ── Mar 2026 Transactions ────────────────────────────────────────────────
  // Groceries: Available = 500 + 80 = 580. Spent $515 → left $65
  await addTxn("Whole Foods",       175, G,  "2026-03-03");
  await addTxn("Costco",            190, G,  "2026-03-10");
  await addTxn("Trader Joe's",      100, G,  "2026-03-22");
  await addTxn("CVS Food",           50, G,  "2026-03-29");

  // Restaurants: Available = 150 + (-45) = 105. Spent $95 → left $10
  await addTxn("Chipotle",           45, R,  "2026-03-07");
  await addTxn("Local Diner",        50, R,  "2026-03-21");

  // Gas: Available = 100 + 28 = 128. Spent $110 → left $18
  await addTxn("Shell Gas",          60, Ga, "2026-03-05");
  await addTxn("Exxon",              50, Ga, "2026-03-19");

  // Household: Available = 200 + 32 = 232. Spent $140 → left $92
  await addTxn("IKEA",               85, H,  "2026-03-12");
  await addTxn("Target Home",        55, H,  "2026-03-25");

  // Child: Available = 300 + 5 = 305. Spent $315 → left -$10
  await addTxn("Daycare Mar",       200, Ch, "2026-03-01");
  await addTxn("School Supplies",    65, Ch, "2026-03-14");
  await addTxn("Activity Fee",       50, Ch, "2026-03-21");

  // Bills: Available = 400 + 0 = 400. Spent $405 → left -$5
  await addTxn("Electric Bill Mar", 130, B,  "2026-03-03");
  await addTxn("Internet Mar",       60, B,  "2026-03-03");
  await addTxn("Phone Bill Mar",     80, B,  "2026-03-03");
  await addTxn("Streaming Mar",      40, B,  "2026-03-03");
  await addTxn("Insurance Mar",      95, B,  "2026-03-10");

  // Shopping: Available = 200 + (-60) = 140. Spent $105 → left $35
  await addTxn("Amazon Shopping",    60, Sh, "2026-03-08");
  await addTxn("Nordstrom Rack",     45, Sh, "2026-03-17");

  // Misc: Available = 100 + 45 = 145. Spent $80 → left $65
  await addTxn("Walgreens",          35, M,  "2026-03-11");
  await addTxn("Hardware Store",     45, M,  "2026-03-24");

  console.log("✓ Seeded Feb + Mar 2026 budgets and transactions.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
