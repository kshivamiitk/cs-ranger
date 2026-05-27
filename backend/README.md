# LearnRift — Backend

12 microservices + an api-gateway, all in TypeScript on Express, sharing a `@cs-ranger/shared` package via npm workspaces. Each service runs independently and is mocked end-to-end (no Supabase or Razorpay credentials required) so the frontend can hit the gateway and get realistic responses immediately.

## Run

```bash
cd backend
npm install              # installs deps for the workspace root + all services
cp .env.example .env
npm run dev              # boots all 13 services concurrently with tsx watch
```

Health: `curl http://localhost:4000/health` returns the gateway plus every service's status.

## Port map

| Service | Port | Owns |
|---|---|---|
| api-gateway | 4000 | routing, rate limiting, JWT shim |
| auth-service | 4001 | users, sessions, OAuth |
| user-service | 4002 | profiles, subscriptions |
| course-service | 4003 | courses, modules, nodes, comments, bookmarks |
| enrollment-service | 4004 | enrollments, progress, watch positions |
| search-service | 4005 | full-text course/creator search, autocomplete |
| payment-service | 4006 | Razorpay orders, webhook, refunds |
| wallet-service | 4007 | creator ledger, balances, payout eligibility |
| payout-service | 4008 | KYC + Razorpay payouts, TDS |
| notification-service | 4009 | in-app + email, Supabase Realtime |
| support-service | 4010 | tickets, replies, canned responses |
| achievement-service | 4011 | badges, streaks, certificate gen + verify |
| analytics-service | 4012 | report cards, course funnel, admin KPIs |

## Auth (dev mode)

In dev, the api-gateway forwards requests to services; services read `x-user-id` and `x-user-role` headers (set by the gateway after JWT validation in real deployment). To impersonate a learner during local testing:

```bash
curl -H "x-user-id: u1" -H "x-user-role: learner" http://localhost:4000/api/users/me
```

## Production wiring (what's stubbed)

Each service has the routing and validation in place but stubs the integrations:

- **Supabase** — repositories use in-memory arrays. Swap with `@supabase/supabase-js` calls when ready.
- **Razorpay** — `payment-service/src/index.ts` and `payout-service/src/index.ts` have inline comments showing the SDK calls.
- **BullMQ / Redis** — event handlers are inline `app.post('/_events/...')` placeholders. Replace with `bullmq` Queue + Worker.
- **Resend / SES** — `notification-service` accepts events and logs; wire up Resend SDK for real dispatch.

## Folder convention (every service)

```
<service>/
├── src/
│   ├── routes/         (one file per resource)
│   ├── controllers/    (thin: parse → call service → respond)
│   ├── services/       (business logic)
│   ├── repositories/   (DB queries)
│   ├── events/         (BullMQ producers/consumers)
│   └── index.ts        (boot)
├── package.json
└── tsconfig.json
```

The scaffolded `index.ts` files in this repo collapse routes/controllers/repositories into one file for compactness — split them as each service grows.
