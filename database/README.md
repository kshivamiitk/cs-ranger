# CS-Ranger — Database

PostgreSQL schema for Supabase (or any Postgres 15+). Covers every table referenced in `Docs/design.md §5` plus the indexes, triggers, and Row-Level Security policies needed to run the platform safely.

## Layout

```
database/
├── migrations/
│   ├── 0001_extensions.sql        extensions + enum types
│   ├── 0002_identity.sql          users, profiles, tokens, subscriptions
│   ├── 0003_courses.sql           courses, modules, nodes, reviews, comments, bookmarks
│   ├── 0004_enrollment_progress.sql enrollments, node_progress, quizzes, notes
│   ├── 0005_money.sql             razorpay_orders, payments, wallet_ledger, payouts, KYC
│   ├── 0006_notifications_support.sql notifications + support tickets
│   ├── 0007_achievements.sql      badges, streaks, certificates
│   ├── 0008_platform_audit.sql    platform_settings + immutable admin audit log
│   ├── 0009_triggers.sql          derived-counter triggers (enrollment_count, rating_avg, progress)
│   └── 0010_rls.sql               Row-Level Security policies for every table
├── seed.sql                       development seed matching frontend/src/lib/mock-data.ts
├── apply.sh                       one-shot runner: applies all migrations + seed
└── README.md                      this file
```

## Apply locally

```bash
# Spin up a Postgres in Docker (or use your own):
docker run --rm -d --name csr-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# Run all migrations + seed:
./apply.sh "postgres://postgres:dev@localhost:5432/postgres"
```

Skip the seed with `WITH_SEED=0 ./apply.sh "$DATABASE_URL"`.

## Apply on Supabase

```bash
# Option A: psql against your Supabase pooler URL
./apply.sh "postgresql://postgres.<ref>:<pwd>@aws-...pooler.supabase.com:5432/postgres"

# Option B: paste each migration file into the Supabase SQL editor in order.
```

RLS policies in `0010_rls.sql` call `auth.uid()`, which Supabase provides automatically. If you're running raw Postgres, define `auth.uid()` to read `current_setting('app.user_id', true)::uuid` and have your service layer set it per request.

## Key design choices

- **All money is stored in paise** (smallest unit) as `integer`. The frontend displays `paise / 100` as ₹. This avoids floating-point drift across the wallet ledger.
- **`creator_balances`** is denormalised and kept in sync by an `after insert` trigger on `wallet_ledger`. Balance reads stay O(1) even with millions of ledger rows.
- **`courses.search_vector`** is a `tsvector` refreshed by trigger on title/subtitle/description/tags, with a GIN index — this is what `search-service` queries.
- **`admin_audit_log` is append-only**, enforced by triggers that raise on `UPDATE` and `DELETE`. The `bigserial` primary key gives durable ordering.
- **Three-step money flow** matches the service split: `razorpay_orders` (payment-service create-order) → `payments` (payment-service webhook) → `wallet_ledger` (wallet-service consumer). Refunds insert a `refund_debit` rather than mutating the original credit, preserving the audit trail.
- **Sequential unlock** is policy at the API layer, not at the DB layer — RLS only restricts who can _see_ a node; the `enrollment-service` decides whether to mark a node accessible based on `node_progress`.
- **Foreign keys**: `on delete cascade` where the child is meaningless without the parent (modules → nodes); `on delete restrict` for money tables so you can't lose a payment by deleting a course.

## What's intentionally NOT in here

- **Sharding / partitioning**: not needed at 1 lakh MAU. The biggest hot table (`node_progress`) can be hash-partitioned by `learner_id` later if writes become a bottleneck.
- **Materialized views for analytics**: the `analytics-service` caches results in Redis with a 5-minute TTL. Add MVs only if Redis cache stampedes become a problem.
- **Triggers for notifications/badges**: those run through the event queue (BullMQ) so they can retry and batch. The DB stays clean of side effects.

## Seed contents

The seed mirrors `frontend/src/lib/mock-data.ts` so the UI looks identical against a fresh database:

- 8 users (Arjun, Ananya, Rohan, Sneha, Vikram, Priya, Kabir, Admin) with roles assigned
- 8 categories, 8 published courses spanning all categories
- Modules + nodes auto-generated (4 modules × 5–8 nodes per course)
- 4 enrollments for the demo learner (1 completed, 3 in progress)
- Payments + wallet ledger + 2 completed payouts for Ananya
- 8 badges (5 earned by the demo user), 1 certificate, 5 notifications, 1 support ticket
- KYC verified for Ananya so the bulk-payout admin flow has something to disburse
