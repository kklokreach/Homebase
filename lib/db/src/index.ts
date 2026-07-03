import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function ensureSchema() {
  await pool.query(`
    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'short';

    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'expense';

    ALTER TABLE budget_categories
      ADD COLUMN IF NOT EXISTS group_name text;

    ALTER TABLE monthly_budgets
      ADD COLUMN IF NOT EXISTS rollover_applied boolean NOT NULL DEFAULT false;

    ALTER TABLE monthly_budgets
      ADD COLUMN IF NOT EXISTS rollover_override numeric(10, 2);

    CREATE TABLE IF NOT EXISTS transaction_splits (
      id serial PRIMARY KEY,
      transaction_id integer NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id integer REFERENCES budget_categories(id) ON DELETE SET NULL,
      amount numeric(10, 2) NOT NULL
    );

    CREATE INDEX IF NOT EXISTS transaction_splits_transaction_id_idx
      ON transaction_splits (transaction_id);

    CREATE INDEX IF NOT EXISTS transaction_splits_category_id_idx
      ON transaction_splits (category_id);

    INSERT INTO transaction_splits (transaction_id, category_id, amount)
    SELECT t.id, t.category_id, t.amount
    FROM transactions t
    WHERE t.transaction_type = 'expense'
      AND NOT EXISTS (
        SELECT 1
        FROM transaction_splits s
        WHERE s.transaction_id = t.id
      );

    CREATE TABLE IF NOT EXISTS monthly_income (
      id serial PRIMARY KEY,
      year integer NOT NULL,
      month integer NOT NULL,
      amount numeric(10, 2) NOT NULL DEFAULT '0',
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS monthly_income_year_month_unique
      ON monthly_income (year, month);

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id serial PRIMARY KEY,
      plan_date date NOT NULL,
      body text NOT NULL DEFAULT '',
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS weekly_plans_plan_date_unique
      ON weekly_plans (plan_date);

    DO $$
    DECLARE
      public_table record;
    BEGIN
      FOR public_table IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format(
          'ALTER TABLE IF EXISTS %I.%I ENABLE ROW LEVEL SECURITY',
          public_table.schemaname,
          public_table.tablename
        );
      END LOOP;
    END $$;
  `);
}

export * from "./schema";
