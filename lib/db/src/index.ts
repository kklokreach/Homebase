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
    ALTER TABLE budget_categories
      ADD COLUMN IF NOT EXISTS group_name text;

    CREATE TABLE IF NOT EXISTS monthly_income (
      id serial PRIMARY KEY,
      year integer NOT NULL,
      month integer NOT NULL,
      amount numeric(10, 2) NOT NULL DEFAULT '0',
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS monthly_income_year_month_unique
      ON monthly_income (year, month);
  `);
}

export * from "./schema";
