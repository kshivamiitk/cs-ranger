# LearnRift

An online education marketplace for college students and early-career engineers. Built per the spec in [`Docs/`](Docs/).

## Repo layout

```
/
├── frontend/    Next.js 15 + React 19 + Tailwind. Dark glassmorphic UI.
├── backend/     12 microservices + api-gateway. Express + TypeScript. Real Supabase + Razorpay integration.
├── database/    Postgres/Supabase schema — migrations, RLS, triggers, performance indexes, seed.
├── Docs/        Original product + design specification.
├── .env.example Master env template — copy to .env / backend/.env / frontend/.env.local
└── CHECKLIST.md What's done and what's pending, per-requirement.
```

## Quickstart

```bash
# 1. Copy env templates and fill in real keys (see "What you need" below)
cp .env.example .env
cp .env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# 2. Apply DB migrations to your Supabase project (or local Postgres)
cd database && ./apply.sh "$DATABASE_URL"

# 3. Install + run backend (all 13 services, ports 4000–4012)
cd ../backend && npm install && npm run dev

# 4. Install + run frontend (port 3000) in a separate terminal
cd ../frontend && npm install && npm run dev
```

Open http://localhost:3000.

## What you need in `.env`

| Key | Where to get it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | supabase.com → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as above (anon key only — frontend) |
| `DATABASE_URL` | Supabase → Project Settings → Database (use the pooler URL) |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | dashboard.razorpay.com → API Keys (Test Mode) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Webhooks → set a secret |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Same as `RAZORPAY_KEY_ID` (frontend checkout) |
| `RAZORPAY_ACCOUNT_NUMBER` | Your RazorpayX virtual account (for payouts) |
| `RESEND_API_KEY`, `EMAIL_FROM` | resend.com → API Keys |
| `REDIS_URL` (optional) | Upstash, Railway, or local Redis — for BullMQ event queue |

Without these, the platform falls back to dev-friendly behavior: console-logged emails, in-memory mock data, and Razorpay flows that return placeholder order IDs.

## What works today

- **Auth**: real signup with bcrypt + email verification, login with JWT + rotating refresh, forgot/reset password.
- **Courses**: 5-step builder creates real courses with all 5 node types (video / markdown / quiz / pdf / static-website). Static-website uses Monaco editor with sandboxed iframe preview.
- **Discovery**: PostgreSQL full-text + trigram autocomplete, faceted filters, real catalog.
- **Player**: video iframe + watch-position save every 10s, quiz with attempt persistence + grading, Q&A thread, notes.
- **Payments**: Razorpay order creation, checkout modal, HMAC-verified webhook, idempotent payment processing, refunds.
- **Wallet**: per-creator ledger with atomic credit/commission via DB trigger; balance queries are O(1).
- **KYC + Payouts**: Razorpay Contact + Fund Account creation, signature-verified webhooks, **bulk payout via Razorpay X with idempotency keys**.
- **Achievements**: badges, streaks (with grace period), certificate verification page.
- **Notifications**: in-app DB-backed, email via Resend, event-driven from BullMQ topics.
- **Admin**: course review queue (approve/reject), bulk payout flow, support inbox with internal notes.

## Performance posture

The platform is built to hit `< 200ms p95` read latency at 1 lakh MAU. Key choices:

- **20 hot-path indexes** across `courses`, `enrollments`, `node_progress`, `wallet_ledger`, `notifications`, `payouts`, `comments`, `reviews` (migrations 0009 + 0011).
- **Denormalised `creator_balances`** so balance queries don't sum the ledger every time. Maintained by an `after insert` trigger on `wallet_ledger`.
- **PG `tsvector` + GIN** for search; **`pg_trgm`** for autocomplete prefix matching.
- **API-level cache**: analytics endpoints cache 5 min in-memory (Redis upgrade is one line).
- **React Query** on the client: 60s staleTime, no refetch on focus, all heavy pages cached.
- **Rate limiting** at the gateway: 300 req/min general, 5/15min on login.

See [`CHECKLIST.md`](CHECKLIST.md) for the full per-requirement status.

See [`frontend/README.md`](frontend/README.md), [`backend/README.md`](backend/README.md), and [`database/README.md`](database/README.md) for deeper docs.
