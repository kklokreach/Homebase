# Homebase

## Overview

Full-stack household management app for two adults (Me and Wife). Built as a pnpm monorepo with a React + Vite frontend and Express API server backed by PostgreSQL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/homebase), wouter for routing, TanStack Query, Tailwind CSS v4
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/homebase run dev` — run frontend locally

## Artifacts

- **artifacts/homebase** — React/Vite frontend (preview path: /)
- **artifacts/api-server** — Express REST API (preview path: /api)

## App Structure

### Pages
- `/` — Home: today's tasks by Me/Wife/Shared, budget snapshot, recent transactions
- `/tasks` — Tasks with quick-add, tabs (Today/Upcoming/Mine/Wife/Shared), progressive disclosure
- `/finances` — Budget dashboard with rollover logic, transaction entry, monthly/annual review
- `/settings` — Budget category management

### Database Tables
- `tasks` — title, assignee (me/wife/us), dueDate, recurring, notes, category, completed
- `budget_categories` — name, icon, color, sort_order
- `monthly_budgets` — categoryId, year, month, budgetAmount (rollover calculated dynamically)
- `transactions` — amount, merchant, categoryId, date, notes

### Finance Logic
- Each month's budget = current month budget + previous month rollover
- Rollover = previous month budgeted - previous month spent (positive = surplus, negative = deficit)
- Available = budgeted + rollover
- Left = available - spent

## Sample Data
Seeded at startup: 8 budget categories (Groceries, Restaurants, Gas, Household, Child, Bills, Shopping, Misc), 16 monthly budgets (current + previous month), 11 transactions, 10 tasks.
