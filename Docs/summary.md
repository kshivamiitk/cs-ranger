# Platform Summary — LearnRift

> The site name "LearnRift" is a placeholder. It is stored in the environment variable `NEXT_PUBLIC_SITE_NAME` and can be changed without modifying any code.

---

## What Is This Platform?

LearnRift is an **online education marketplace** built specifically for college students and early-career professionals. The core thesis is that the best teachers of foundational CS concepts are often other students — people who just learned the material and remember exactly what was confusing.

The platform lets anyone:
- **Learn**: browse and enroll in courses covering Data Structures, Algorithms, Web Development, Mathematics, and other technical subjects.
- **Teach**: create structured courses with rich content (videos, quizzes, interactive code demos, markdown articles) and earn money from enrollments.
- **Engage**: follow creators you like (similar to YouTube subscriptions), bookmark nodes for later, ask doubts directly on each piece of content, and track your progress visually.

---

## The Three Roles

### Learner (default role for all users)
A Learner discovers courses, enrolls (free or paid), and consumes content. They can track their daily learning consistency via a heatmap (inspired by Codeforces/GitHub contribution graphs), earn badges and certificates, see their quiz performance in a report card, and subscribe to creators to get notified of new content.

### Creator (opt-in, same account as Learner)
A Creator builds and sells courses. They use a multi-step course builder to organise content into Modules and Nodes. Each Node can be a video (YouTube/Google Drive link), a Markdown article (with LaTeX support), an interactive static website (built with an in-browser HTML/CSS/JS editor), a PDF, or a quiz (multiple choice with LaTeX support and optional timer). Creators see their revenue analytics, manage a doubts inbox (all learner comments in one place), and receive payouts via Razorpay directly to their bank account or UPI.

### Admin (set via direct DB update only)
The Admin oversees the entire platform. They review and approve/reject courses before they go live, run bulk payouts to creators, handle support tickets from all users, manage platform settings (commission rate, refund policy, T&C), and have an immutable audit log of every admin action.

---

## Content Model (Course → Module → Node)

```
Course
 ├── Title, Description, Pricing (Free / Paid), Thumbnail
 ├── Module 1
 │    ├── Node: Video (YouTube or Google Drive embed)
 │    ├── Node: Markdown article (with LaTeX + code highlighting)
 │    └── Node: Quiz (MCQ, timer, LaTeX, explanations)
 ├── Module 2
 │    ├── Node: PDF (embedded viewer + optional download)
 │    └── Node: Static Website (in-browser HTML/CSS/JS editor, sandboxed preview)
 └── ...
```

Every node has a **comment section** below it. Learners can ask doubts and discuss. The creator sees all comments across all their courses in a unified "Doubts" inbox.

---

## Money Flow

```
Learner pays ₹X
        │
        ▼
Razorpay processes payment
        │
        ├──► Platform keeps X% (admin-configurable commission)
        │
        └──► Creator's pending balance increases by X × (1 − commission%)

Periodically (manual or scheduled):
Admin initiates bulk payout
        │
        ▼
Razorpay disburses pending balances to each creator's verified bank/UPI
```

- Commission rate is set by Admin and shown in the Creator T&C (which creators must accept before publishing).
- Creators must complete Razorpay KYC before receiving any payout.
- TDS is deducted at the applicable rate for creators earning above the annual threshold.

---

## Project Structure

The repository has exactly two top-level folders:

```
/
├── frontend/     ← Next.js (React, TypeScript, Tailwind CSS)
└── backend/
    ├── shared/               ← shared middleware, types, utilities (not a running service)
    ├── api-gateway/          ← port 4000 — single entry point for all frontend traffic
    ├── auth-service/         ← port 4001 — registration, login, JWT, OAuth
    ├── user-service/         ← port 4002 — profiles, subscriptions, T&C acceptance
    ├── course-service/       ← port 4003 — courses, modules, nodes, comments, bookmarks
    ├── enrollment-service/   ← port 4004 — enrollments, node progress, completion
    ├── search-service/       ← port 4005 — full-text course & creator search
    ├── payment-service/      ← port 4006 — Razorpay checkout, payment webhooks, refunds
    ├── wallet-service/       ← port 4007 — creator earnings ledger, balance, commission
    ├── payout-service/       ← port 4008 — KYC (Razorpay), bulk payout disbursement, TDS
    ├── notification-service/ ← port 4009 — emails (Resend/SES) + in-app (Supabase Realtime)
    ├── support-service/      ← port 4010 — support tickets, replies, canned responses
    ├── achievement-service/  ← port 4011 — badges, streaks, certificate PDF generation
    └── analytics-service/    ← port 4012 — report cards, creator analytics, admin KPIs
```

**Why wallet-service is separate from payment-service**: Payment Service handles the raw Razorpay API interaction (create order, verify webhook, initiate refund). Wallet Service handles the accounting side (who earned what, after commission, after refunds). Two different concerns — one talks to Razorpay, one does ledger math.

**Why payout-service is separate from wallet-service**: Payout Service handles KYC (Razorpay Contact + Fund Account creation) and the actual disbursement. Wallet Service provides the balance data that payout-service reads. The split keeps KYC/disbursement code isolated from balance tracking code.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React), TypeScript, Tailwind CSS |
| Backend | 12 microservices + API gateway (Node.js / TypeScript / Express) |
| Message Queue | BullMQ on Redis (async event processing) |
| Database | Supabase (PostgreSQL) with Row-Level Security |
| File Storage | Supabase Storage (images, PDFs, certificates, attachments) |
| Real-time | Supabase Realtime (WebSocket — in-app notifications) |
| Payments | Razorpay (checkout, payouts, KYC, webhooks) |
| Email | Resend / Brevo / Amazon SES (transactional emails) |
| Video | YouTube IFrame API / Google Drive embed (no self-hosting) |
| Code Editor | Monaco Editor (for Static Website nodes) |
| Math Rendering | KaTeX (LaTeX in Markdown nodes and quizzes) |
| PDF Generation | pdf-lib or Puppeteer (certificates, report exports) |

---

## Key Design Decisions

### Why YouTube/Google Drive for videos instead of direct upload?
Direct video upload + transcoding (HLS) is expensive in storage, compute, and bandwidth — especially at the 1 lakh MAU scale. YouTube and Google Drive are free, globally distributed CDNs. Creators already know how to use them. This lets the platform launch lean and replace with self-hosted video later without changing the learning experience.

### Why microservices at this scale?
The platform is designed to reach 1 lakh MAU. Starting with a monolith and breaking it apart later is high-risk and high-cost. A microservices split allows individual services to be scaled, deployed, or replaced independently. The services communicate via async queues (BullMQ/Redis) for non-critical paths (emails, badges, certificates) and HTTP for critical paths (enrollment, payment verification).

### Why three separate money services (payment, wallet, payout)?
These are three distinct jobs: **Payment Service** talks to Razorpay to collect money from learners. **Wallet Service** tracks how much each creator has earned (the ledger — credits, commission deductions, refund reversals). **Payout Service** handles KYC and sends money out to creator bank accounts. Keeping them separate means a bug in the payout disbursement code cannot accidentally corrupt the ledger, and the KYC code is isolated from both payment collection and balance tracking.

### Why Supabase?
Supabase provides PostgreSQL with Row-Level Security (RLS), built-in auth, file storage, and real-time WebSocket subscriptions — all in one managed service. This dramatically reduces infrastructure complexity at launch while remaining fully compatible with a migration to raw PostgreSQL + separate services later if needed.

### Why Razorpay?
Razorpay supports the full lifecycle needed: payment collection (checkout), creator onboarding (Contact + Fund Account creation, KYC), and payout disbursement (bulk payouts to bank accounts and UPI). It is the dominant payment infrastructure provider in India and is compliant with RBI regulations.

---

## Pages & Routes (Quick Reference)

### Public
| Route | Description |
|---|---|
| `/` | Landing page |
| `/login` | Log in |
| `/signup` | Sign up |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/course/:id` | Course detail page (unenrolled view) |
| `/u/:username` | Public user profile |
| `/verify/:certId` | Certificate verification |
| `/catalog` | Course catalog (public browsable) |
| `/creators` | Creator directory (public) |

### Learner
| Route | Description |
|---|---|
| `/home` | Personal dashboard + heatmap |
| `/my-courses` | Enrolled courses list |
| `/course/:id/learn/:nodeId` | Course player |
| `/bookmarks` | Saved nodes |
| `/achievements` | Badges, streaks, certificates |
| `/report-cards` | Quiz scores & analytics |
| `/transactions` | Payment history |
| `/support` | Support tickets |
| `/notifications` | Full notifications list |

### Creator
| Route | Description |
|---|---|
| `/creator/overview` | Creator dashboard |
| `/creator/courses` | Course list + builder |
| `/creator/courses/:id/analytics` | Course analytics |
| `/creator/doubts` | Doubt inbox |
| `/creator/finance` | Revenue & payouts |

### Admin
| Route | Description |
|---|---|
| `/admin/overview` | Platform KPIs + course review queue |
| `/admin/payouts` | Payout management |
| `/admin/support` | Support ticket inbox |
| `/admin/users` | User management |
| `/admin/courses` | Platform-wide course management |
| `/admin/categories` | Category management |
| `/admin/settings` | Platform configuration |
| `/admin/audit-log` | Immutable admin action log |

### Shared
| Route | Description |
|---|---|
| `/profile/edit` | Edit own profile |
| `/settings` | Account & notification settings |
| `/search` | Search results page |

---

## Scalability Notes

- Target: **1 lakh (100,000) monthly active users**.
- All list endpoints use indexed queries with pagination (page size 20). No full-table scans in hot paths.
- The platform's primary latency problem from prior versions is addressed by: proper DB indexing, query-level caching (Redis/Supabase edge cache), CDN for static assets, and async processing for non-real-time work (emails, badges, certificates) via message queues.
- Video content is served from YouTube/Google Drive CDNs — zero bandwidth cost to the platform.
- Supabase's connection pooler (PgBouncer) handles high-concurrency DB connections without exhausting Postgres connection limits.
- Notification fan-out (subscriptions) is handled asynchronously so a single creator publishing a course to 10,000 subscribers doesn't block the request.

---

## Documentation Index

| File | Covers |
|---|---|
| `design.md` | Full frontend + backend architecture reference |
| `common.md` | Landing page, authentication, navbar, shared components |
| `learner.md` | Learner role, dashboard, catalog, bookmarks, achievements, report cards |
| `creator.md` | Creator role, course builder, doubts inbox, finance |
| `course.md` | Course structure, all 5 node types in detail, comment system, progress tracking |
| `admin.md` | Admin panel, course review, payouts, support, platform settings, audit log |
| `summary.md` | This file — high-level overview and quick reference |
