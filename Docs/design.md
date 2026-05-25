# Website Design Document — Full Specification

---

## 1. Overview

This is an online education platform that connects **Learners** with **Creators** (course instructors). The platform supports course discovery, enrollment, video-based learning, doubt resolution, achievement tracking, and monetization — all within a single product.

The platform has three distinct user roles:
- **Learner** — browses, enrolls in, and consumes courses.
- **Creator** — creates and publishes courses, manages doubts, tracks revenue.
- **Admin** — manages platform-level payouts, support, and platform configuration.

Target scale: **1 lakh (100,000) monthly active users** at launch ceiling. Architecture must handle this without re-engineering.

---

## 2. Frontend Design

### 2.1 Global / Common Components

#### 2.1.1 Navbar

The navbar is persistent across all pages for all user roles. It is sticky (stays at the top on scroll) and collapses into a hamburger menu on mobile viewports (< 768px).

**Left section:**
- Main logo of the website (SVG, high-res). Clicking the logo navigates to the role-appropriate home page (Learner → `/home`, Creator → `/creator/overview`, Admin → `/admin/overview`).
- The logo should have a companion favicon (generated via favicon.io or equivalent) that mirrors the logo mark. The favicon must be set for all standard sizes: 16×16, 32×32, 180×180 (Apple touch icon), and 192×192 (Android).

**Right section:**
- **Theme toggle button**: switches between Light Mode and Dark Mode. The preference is persisted in `localStorage` and also synced to the user's profile in the database so that the preference carries across devices. The toggle should use a smooth CSS transition (no flash of unstyled content on load).
- **Profile button**: a circular avatar button showing the user's profile photo (or a generated initials-based placeholder if no photo has been uploaded). Clicking it opens a dropdown menu with:
  - "View Profile" — goes to the public profile page.
  - "Edit Profile" — opens the profile editor (see §2.1.2).
  - "Settings" — account-level settings (notifications, password, connected accounts).
  - "Log Out" — invalidates the session and redirects to the landing page.

#### 2.1.2 Profile Editor

Accessible to all roles. A modal or dedicated page (`/profile/edit`) with the following editable fields:

| Field | Type | Constraints |
|---|---|---|
| Profile Photo | Image upload | Max 5 MB, JPG/PNG/WEBP. Stored in Supabase Storage. Displayed as circular crop. |
| Display Name | Text | 2–60 characters. |
| Username | Text | 3–30 chars, lowercase alphanumeric + underscores only. Must be globally unique. |
| Bio / About | Textarea | Max 500 characters. Shown on the public profile. Supports basic markdown (bold, italic, links). |
| College / Institution | Text | Optional. 2–100 characters. |
| Social Links | URL fields | Optional. LinkedIn, Twitter/X, GitHub, Personal Website. Each validated as a proper URL. |

Changes are saved via a "Save Changes" button with optimistic UI update. If the server rejects (e.g. username taken), the field is highlighted with an inline error message.

#### 2.1.3 Light / Dark Mode

- Default: system preference (`prefers-color-scheme` media query).
- Override: stored in `localStorage` + user profile DB field.
- All color tokens must be defined as CSS custom properties (`--color-bg`, `--color-text`, etc.) so the entire theme is switched by toggling a class on `<html>`.
- No hard-coded color values anywhere in component styles.

#### 2.1.4 Notifications Bell

A bell icon in the navbar with a badge showing unread count. Clicking opens a dropdown listing the 10 most recent notifications with a "See all" link. Notifications are delivered via Supabase Realtime (WebSocket) so they appear without a page reload.

---

### 2.2 Learner Interface

The Learner role has the following pages, navigated via the navbar:

#### 2.2.1 Home (`/home`)

- **Hero banner**: personalized greeting ("Good morning, {name}"), a quick summary card showing currently-in-progress courses with a progress bar.
- **Continue Learning**: horizontal scroll strip of the 3–5 most recently accessed courses with a "Resume" button that deep-links to the exact last lesson watched.
- **Recommended for You**: algorithm-driven grid of courses based on the learner's enrolled categories, rating history, and completion rate. Falls back to "Popular this week" if no history exists.
- **Featured / Promoted Courses**: curated by Admin.
- **New Arrivals**: latest published courses, sorted by publish date.

#### 2.2.2 My Courses (`/my-courses`)

Lists all courses the learner is enrolled in. Two tabs:
- **In Progress** — courses with 1–99% completion.
- **Completed** — courses with 100% completion (triggers certificate generation).

Each course card shows: thumbnail, title, creator name, progress bar (%), last accessed date, and a "Continue" / "Review" button.

Filtering: by category, by creator, by completion status. Sorting: by last accessed, by progress, by enrollment date.

#### 2.2.3 Course Catalog (`/catalog`)

- Search bar (full-text search against course title, description, and tags).
- Filter panel (left sidebar on desktop, bottom sheet on mobile):
  - Category (multi-select)
  - Price range (free / paid / range slider)
  - Rating (4★ and above, etc.)
  - Duration (< 2h, 2–10h, > 10h)
  - Language
  - Creator
- Sort options: Relevance, Newest, Most Popular, Highest Rated, Price (low→high), Price (high→low).
- Course cards in a responsive grid (4 cols → 3 → 2 → 1 on smaller viewports).
- Infinite scroll or paginated results (page size: 20).
- Each card shows: thumbnail, title, creator avatar + name, rating (stars + count), price (with strike-through original price if discounted), and a short tagline.
- Clicking a card goes to the **Course Detail Page** (`/course/:id`).

#### 2.2.4 Course Detail Page (`/course/:id`)

- Hero section: course banner image or preview video (autoplay muted on hover), title, subtitle, rating summary, enrollment count, last updated date.
- Creator info card with avatar, name, bio snippet, and a link to their profile.
- What You'll Learn: bullet points.
- Course Curriculum: accordion of sections and lessons. Each lesson shows title, type (video/quiz/article), duration. Locked lessons show a lock icon.
- Reviews: paginated list of learner reviews with star rating, date, and text. Summary histogram at the top.
- Sticky bottom bar (mobile) or sticky sidebar (desktop) with: price, "Enroll Now" / "Continue Learning" CTA, and a "Bookmark" icon.
- If already enrolled: the sidebar shows progress and a "Go to Course" button.

#### 2.2.5 Course Player (`/course/:id/learn/:lessonId`)

- **Video player**: custom-skinned HTML5 video player with:
  - Play/pause, seek bar, volume, playback speed (0.5× – 2×), fullscreen, PiP (Picture-in-Picture).
  - Auto-save watch position every 10 seconds to the backend. On revisit, resume from last position.
  - Quality selector if multiple resolutions are available.
- **Sidebar** (collapsible): course curriculum tree showing all sections/lessons. Current lesson highlighted. Completed lessons show a checkmark.
- **Notes tab**: learner can write timestamped notes for the current video. Notes are saved to the DB and can be exported as PDF.
- **Q&A tab**: see §2.2.9 (Doubts).
- **Resources tab**: downloadable files attached to the lesson by the creator (PDFs, ZIPs, etc.).
- **Auto-progress**: after a video ends, mark the lesson complete and auto-advance to the next lesson (with a 5-second countdown cancel option).
- Keyboard shortcuts: Space (play/pause), ← / → (±10s seek), F (fullscreen), M (mute).

#### 2.2.6 Creators (`/creators`)

- A directory of all active Creators on the platform.
- Search by name. Filter by category expertise.
- Creator cards: avatar, name, category tags, total students, average rating, course count.
- Clicking opens the Creator's public profile (`/creator/:username`) showing their bio, all their published courses, and aggregated stats.

#### 2.2.7 Bookmarks (`/bookmarks`)

- Grid of bookmarked courses (not yet enrolled).
- Bookmark can be removed from here.
- CTA to enroll directly from the bookmarks page.

#### 2.2.8 Achievements (`/achievements`)

- A gamified achievement system to encourage learning engagement.
- **Badges**: earned by milestones (e.g., "First Course Completed", "5-Day Streak", "Top Reviewer", "100 Hours Learned").
- **Streaks**: daily login / lesson completion streak with a calendar heatmap visualization.
- **Leaderboard** (optional, can be scoped to a single course or platform-wide): top learners by XP points.
- **Certificates**: auto-generated PDF certificates on course completion. Each certificate has a unique verification URL (`/verify/:certId`). Certificate layout: learner name, course name, creator name, date, platform logo, and QR code linking to the verification URL.

#### 2.2.9 Report Cards (`/report-cards`)

- A learning analytics dashboard for the learner.
- **Overall stats**: total courses enrolled, completed, in-progress; total hours watched; average quiz score.
- **Per-course breakdown**: lesson-by-lesson completion, quiz scores with date, time spent.
- **Weekly activity chart**: bar chart of hours learned per day over the past 4 weeks.
- Exportable as PDF.

#### 2.2.10 Transaction History (`/transactions`)

- A paginated table of all payments made by the learner.
- Columns: date, course name, amount paid, payment method, Razorpay transaction ID, status (success / refunded / failed).
- Downloadable as CSV.
- Refund request button for eligible transactions (within refund window defined by admin policy).

#### 2.2.11 Support (`/support`)

- FAQ accordion (searchable).
- "Contact Support" form that creates a support ticket.
- Live chat widget (if a live agent is available) or async ticket status tracker.
- Ticket history: list of past support requests with status (open / in-progress / resolved).

---

### 2.3 Creator Interface

Creators access a separate dashboard area (`/creator/*`). Navigation is via a left sidebar on desktop and a bottom tab bar on mobile.

#### 2.3.1 Overview (`/creator/overview`)

A KPI dashboard with:
- **Revenue**: total earnings (all time), this month, last month. Revenue trend line chart (last 12 months).
- **Students**: total enrolled across all courses, new this month.
- **Courses**: total published, total drafts.
- **Ratings**: average rating across all courses, total reviews.
- **Top Performing Course**: thumbnail + name + revenue + student count.
- **Recent Activity**: feed of recent enrollments, reviews, and doubt questions.
- **Payout Status**: next payout date, pending balance, last payout amount.

#### 2.3.2 Courses (`/creator/courses`)

- **Course List**: table of all courses (draft, under review, published, archived) with quick stats (students, revenue, rating).
- **Create New Course** button → multi-step course builder:

  **Step 1 — Basics**
  - Title (max 80 chars), Subtitle (max 120 chars), Description (rich text editor — supports headings, bold, italic, lists, links, code blocks).
  - Category and sub-category (dropdown, seeded by admin).
  - Language.
  - Level (Beginner / Intermediate / Advanced / All Levels).
  - Tags (max 10, comma-separated).

  **Step 2 — Media**
  - Course Thumbnail (image upload, recommended 1280×720, max 10 MB).
  - Promotional Video (optional, max 3 minutes — used as the preview on the course detail page).

  **Step 3 — Curriculum**
  - Drag-and-drop section builder.
  - Within each section: add lessons of type:
    - **Video** (upload MP4/MOV/AVI, max 4 GB per video; transcoding handled server-side to HLS for adaptive streaming).
    - **Article** (rich text editor).
    - **Quiz** (multiple-choice question builder with correct answer flagging and optional explanation).
    - **Assignment** (prompt text + file submission).
  - Each lesson can have: title, description (optional), attachments (PDF/ZIP), free preview toggle (lessons marked as free preview are watchable without enrollment).

  **Step 4 — Pricing**
  - Free or Paid toggle.
  - If paid: price in INR. Supports a "Discounted Price" field with optional discount validity window.
  - Enrollment limit (optional): cap the number of students.

  **Step 5 — Settings & Submit**
  - Welcome message (sent to learner on enrollment).
  - Completion message (shown when learner finishes the course).
  - Certificate: toggle whether a certificate is issued on completion.
  - "Submit for Review" button → course enters review queue. Admin approves/rejects.

- **Edit Course**: same multi-step form with existing values pre-filled.
- **Course Analytics** (`/creator/courses/:id/analytics`):
  - Enrollment over time, video completion funnel, average quiz scores per lesson, revenue breakdown, refund count.

#### 2.3.3 Doubts (`/creator/doubts`)

- A unified inbox of all Q&A questions posted by learners across all the creator's courses.
- Filter by course, by status (unanswered / answered / mine).
- Each doubt shows: learner name + avatar, course name, lesson name, question text, timestamp, reply count.
- Creator can reply inline. Replies support text and markdown.
- "Mark as Resolved" button.
- Email notification sent to creator when a new doubt arrives (via the mailing service — see §4.3).

#### 2.3.4 Finance (`/creator/finance`)

- **Earnings Summary**: total lifetime earnings, platform commission deducted, net payout received.
- **Payout Schedule**: shows the next scheduled payout date and the pending balance that will be disbursed.
- **Transaction Ledger**: itemized list — per-enrollment revenue entries, refund deductions, commission deductions, payouts disbursed.
- **Bank Account / UPI Details**: creator adds their bank account (name, account number, IFSC) or UPI ID. This triggers Razorpay KYC verification (see §3.4).
- **Payout History**: list of past payouts with date, amount, Razorpay payout ID, and status.
- **Tax Documents**: downloadable TDS certificates and invoices (auto-generated).

---

### 2.4 Admin Interface

Admin panel is at `/admin/*`. Left sidebar navigation.

#### 2.4.1 Overview (`/admin/overview`)

- Platform-level KPIs: total users (learners + creators), new signups today/this week, total courses (active, under review, archived), total revenue collected, platform commission earned.
- Recent activity feed.
- **Course Review Queue**: pending courses submitted by creators. Admin can approve (course goes live) or reject (with a reason text sent to creator).
- **User flags**: accounts reported for abuse/spam.

#### 2.4.2 Payouts (`/admin/payouts`)

- **Commission Settings**: set the platform commission percentage. This value is referenced in the terms and conditions that every creator must accept before publishing a course (see §3.4).
- **Pending Payouts**: list of creators with pending balances due for payout, showing name, bank details, and amount.
- **Initiate Bulk Payout**: triggers a Razorpay bulk payout to all creators who have met the minimum payout threshold. Provides a confirmation step with total amount to be disbursed.
- **Payout History**: full log of all bulk payout runs, with per-creator breakdown and Razorpay reference IDs.
- **Failed Payouts**: list of payouts that failed (invalid bank details, etc.) with a retry option.

#### 2.4.3 Support Chats (`/admin/support`)

- Unified view of all support tickets from learners and creators.
- Status filter: open / in-progress / resolved.
- Assign ticket to an admin team member.
- Ticket detail: full conversation thread with timestamps.
- "Close Ticket" and "Reopen Ticket" actions.
- Internal notes (not visible to the user) for admin-to-admin communication on a ticket.
- Canned responses library for common questions.

---

## 3. Project Structure

The repository is split into exactly two top-level folders: `frontend/` and `backend/`. They are completely independent — different dependencies, different deployment pipelines, different environment variables. The only contract between them is the HTTP API.

```
/ (repo root)
├── frontend/                        ← Next.js app (React, TypeScript, Tailwind)
│   ├── public/                      ← static files (favicon, og-image, robots.txt)
│   ├── src/
│   │   ├── app/                     ← Next.js App Router pages & layouts
│   │   │   ├── (public)/            ← landing, login, signup, catalog, course detail
│   │   │   ├── (learner)/           ← home, my-courses, bookmarks, achievements, etc.
│   │   │   ├── (creator)/           ← creator/overview, courses, doubts, finance
│   │   │   └── (admin)/             ← admin/overview, payouts, support, users, etc.
│   │   ├── components/
│   │   │   ├── common/              ← Navbar, Footer, ThemeToggle, NotificationBell
│   │   │   ├── learner/             ← Heatmap, CourseCard, CoursePlayer, QuizRunner
│   │   │   ├── creator/             ← CourseBuilder, NodeEditor, DoubtInbox
│   │   │   └── admin/               ← ReviewQueue, PayoutTable, TicketInbox
│   │   ├── hooks/                   ← useAuth, useProgress, useNotifications, etc.
│   │   ├── lib/
│   │   │   ├── api/                 ← typed API client functions (one file per service)
│   │   │   ├── utils/               ← date helpers, formatters, validators
│   │   │   └── constants.ts         ← env-driven constants (site name, API base URL)
│   │   └── styles/
│   │       ├── globals.css          ← CSS custom properties for light/dark tokens
│   │       └── theme.css            ← theme class definitions
│   ├── .env.local                   ← NEXT_PUBLIC_SITE_NAME, NEXT_PUBLIC_API_URL, etc.
│   └── package.json
│
└── backend/                         ← all microservices live here
    ├── shared/                      ← code shared across all services (NOT a running service)
    │   ├── middleware/
    │   │   ├── auth.ts              ← JWT validation middleware (used by every service)
    │   │   └── validate.ts          ← Zod request validation middleware
    │   ├── utils/
    │   │   ├── response.ts          ← standard response envelope { success, data, error, meta }
    │   │   ├── logger.ts            ← structured logger (writes JSON, no PII)
    │   │   └── errors.ts            ← typed AppError classes (NotFound, Forbidden, etc.)
    │   ├── types/                   ← shared TypeScript types (User, Course, Node, etc.)
    │   └── package.json
    │
    ├── api-gateway/                 ← port 4000
    ├── auth-service/                ← port 4001
    ├── user-service/                ← port 4002
    ├── course-service/              ← port 4003
    ├── enrollment-service/          ← port 4004
    ├── search-service/              ← port 4005
    ├── payment-service/             ← port 4006
    ├── wallet-service/              ← port 4007
    ├── payout-service/              ← port 4008
    ├── notification-service/        ← port 4009
    ├── support-service/             ← port 4010
    ├── achievement-service/         ← port 4011
    └── analytics-service/           ← port 4012
```

Each service under `backend/` follows the same internal structure:

```
backend/<service-name>/
├── src/
│   ├── routes/          ← Express route definitions (one file per resource)
│   ├── controllers/     ← request handlers (thin — only parse input, call service, send response)
│   ├── services/        ← business logic (the real meat; no HTTP knowledge here)
│   ├── repositories/    ← all DB queries (Supabase client calls); one file per table/domain
│   ├── events/          ← event publishers and consumers (queue in/out)
│   └── index.ts         ← app bootstrap, port binding
├── .env                 ← service-specific secrets and config
└── package.json
```

---

## 4. Backend Architecture

### 4.1 Design Principles

- **SOLID** principles applied at the service and module level.
- **DRY** — all shared logic (JWT middleware, error classes, response envelope, logger) lives in `backend/shared/`. No copy-pasting across services.
- **Strict separation**: the `frontend/` folder contains zero business logic. The `backend/` services contain zero HTML/CSS/React. They communicate exclusively via HTTP REST (JSON).
- **Each microservice owns its own data**: no service directly queries another service's DB tables. Inter-service data needs go through HTTP calls or async events.
- **Async by default for side effects**: anything that doesn't need to block the HTTP response (emails, badge evaluation, certificate generation, notification fan-out) is published to a message queue and processed by the owning service in the background.

### 4.2 Microservices — Full Breakdown

#### `api-gateway` (port 4000)

The single entry point for all frontend HTTP requests. The frontend never calls individual services directly.

**Responsibilities:**
- Rate limiting: per-IP and per-authenticated-user (login endpoint: 5 req/15 min; general: 300 req/min).
- JWT validation: verifies the access token on every request (calls Auth Service only for token refresh; all other validation is done locally using the public key).
- Request routing: proxies requests to the correct downstream service based on the URL prefix (e.g., `/api/courses/*` → `course-service`, `/api/wallet/*` → `wallet-service`).
- Response envelope enforcement: all responses wrapped in `{ success, data, error, meta }`.
- Correlation ID injection: adds `X-Request-ID` header to every upstream request for distributed tracing.
- Health check aggregation: `/health` endpoint that pings all downstream services and reports their status.

---

#### `auth-service` (port 4001)

**Owns tables:** `users`, `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`

**Responsibilities:**
- User registration (email + password): hash password with bcrypt (cost 12), create user record, issue email verification token, publish `user.registered` event.
- Email verification: validate token, mark user as verified, issue first access + refresh token pair.
- Login (email + password): validate credentials, check `is_verified`, issue access token (JWT, 15-min expiry) + refresh token (opaque, 30-day expiry, stored in `httpOnly` cookie).
- Google OAuth: handle OAuth callback, create user if new, issue tokens.
- Token refresh: validate refresh token, rotate it (invalidate old, issue new), return new access token.
- Logout: invalidate the provided refresh token.
- "Logout from all devices": invalidate all refresh tokens for a user.
- Forgot password: issue a signed password reset token, publish `user.password_reset_requested` event (Notification Service picks this up and sends the email).
- Reset password: validate reset token, hash new password, invalidate all refresh tokens.
- Role management: assign/revoke `learner`, `creator`, `admin` roles on a user (admin-only endpoint for admin grant; self-service for creator activation).

---

#### `user-service` (port 4002)

**Owns tables:** `profiles`, `subscriptions`, `creator_terms_acceptance`

**Responsibilities:**
- Profile CRUD: create profile on first login (triggered by `user.registered` event), read/update profile fields (display name, username, bio, college, social links, theme preference, avatar URL).
- Username uniqueness check: exposed as a fast `GET /users/check-username?username=x` endpoint used by the frontend for real-time validation during profile edit.
- Avatar upload: accepts image file, validates MIME type and size, stores in Supabase Storage, returns the public URL for the profile to save.
- Public profile: `GET /users/:username` — returns public profile data (no PII) for the profile page.
- Creator subscriptions: `POST /users/:creatorId/subscribe`, `DELETE /users/:creatorId/subscribe`, `GET /users/:creatorId/subscribers/count`. On subscribe, publishes `subscription.created` event (Notification Service uses this to set up future notification routing).
- Creator T&C acceptance: record acceptance (creator_id, terms_version, commission_rate_at_acceptance, timestamp). Check if the current T&C version has been accepted.
- Onboarding status: get/set `has_completed_onboarding` flag.

---

#### `course-service` (port 4003)

**Owns tables:** `courses`, `modules`, `nodes`, `node_attachments`, `reviews`, `comments`, `comment_replies`, `bookmarks`, `categories`

**Responsibilities:**
- Course CRUD: create, read, update, delete courses. Only the creator who owns a course can modify it.
- Course status machine: `draft` → `under_review` → `published` → `archived`. Transitions are guarded (e.g., only Admin can move from `under_review` to `published`). On `published`, publishes `course.published` event.
- Module CRUD: add, reorder, delete modules within a course.
- Node CRUD: add, reorder, delete, update nodes of any type (pdf, static_website, video, markdown, quiz) within a module. Each node type has its own validation (e.g., video nodes validate that the URL is a valid YouTube or Google Drive format).
- Node attachments: handle file upload of attachments (PDF/ZIP) for any node, store in Supabase Storage.
- Free preview flag: toggle `is_free_preview` on any node.
- Sequential unlock: enforce node access order if the course has `sequential_unlock = true`.
- Reviews: create, read (paginated), aggregate rating summary. One review per learner per course.
- Comments: create, read (threaded, paginated, sorted by upvotes), reply, upvote, pin, delete, flag for moderation. Mark as resolved (creator only).
- Bookmarks: `POST /bookmarks` (node-level), `DELETE /bookmarks/:nodeId`, `GET /bookmarks` (full list grouped by course). Validates that the node actually exists before saving the bookmark.
- Categories: CRUD for categories and sub-categories (Admin only for write; public for read).
- Course detail page data: a single aggregated endpoint `GET /courses/:id/detail` that returns course metadata + module/node outline + creator info + rating summary in one query, to avoid multiple round trips from the frontend.

---

#### `enrollment-service` (port 4004)

**Owns tables:** `enrollments`, `node_progress`, `watch_positions`

**Responsibilities:**
- Enrollment creation: triggered by `payment.verified` event from Payment Service (for paid courses) or directly via API (for free courses). Creates the enrollment record. Publishes `enrollment.created` event.
- Free course enrollment: `POST /enrollments` — validates the course is free, creates enrollment immediately.
- Access check: `GET /enrollments/check?courseId=X&learnerId=Y` — fast boolean check used by Course Service and the frontend to decide whether to show locked content.
- Node progress: `POST /progress/:nodeId/complete` — marks a node as complete. Recalculates `progress_percent` on the enrollment. If percent reaches 100, marks `completed_at` and publishes `enrollment.completed` event.
- Watch position: `PUT /progress/:nodeId/watch-position` — upserts the video watch position (called every 10 seconds by the frontend player). Returns the last saved position on `GET /progress/:nodeId/watch-position`.
- Course progress summary: `GET /enrollments/:courseId/progress` — returns progress percent + per-node completion status (used to render the curriculum sidebar with checkmarks).
- Completion event consumer: listens for `enrollment.completed` → triggers Achievement Service and Certificate generation via published events.

---

#### `search-service` (port 4005)

**Owns tables:** (read-only view of `courses` and `profiles` — no write access)

**Responsibilities:**
- Full-text course search: `GET /search/courses?q=...&filters=...&sort=...&page=...` — executes a PostgreSQL `tsvector` query against course title, subtitle, description, and tags. Returns paginated results with ranking score.
- Creator search: `GET /search/creators?q=...` — searches profiles where the user has the Creator role and has at least one published course.
- Filter application: applies all catalog filters (category, price range, rating threshold, level, language, duration) as SQL `WHERE` clauses on top of the text search.
- Search index refresh: listens for `course.published` and `course.updated` events to trigger re-indexing (updating the `tsvector` column) for the affected course.
- Autocomplete: `GET /search/autocomplete?q=...` — fast prefix-match against course titles and creator names for the navbar search dropdown (returns top 5 courses + top 3 creators, no full payload, just id + title/name + thumbnail).

**Note:** Search Service reads from the same Supabase PostgreSQL database as Course Service but uses a read-only connection and never writes. This keeps search concerns isolated without a separate search engine (Elasticsearch etc.) at this scale.

---

#### `payment-service` (port 4006)

**Owns tables:** `payments`, `razorpay_orders`

**Responsibilities:**
- Create Razorpay Order: `POST /payments/create-order` — validates that the course exists, is published, and the learner is not already enrolled. Creates a Razorpay Order via their API. Stores `(learner_id, course_id, razorpay_order_id, amount, status=pending)`. Returns `order_id` and `key_id` to the frontend for the checkout modal.
- Razorpay Payment Webhook: `POST /payments/webhook` — receives Razorpay webhook events. **Verifies HMAC-SHA256 signature before doing anything.** On `payment.captured`: updates payment status to `success`, publishes `payment.verified` event (consumed by Wallet Service and Enrollment Service). On `payment.failed`: updates status to `failed`.
- Refund initiation: `POST /payments/:paymentId/refund` (Admin only). Calls Razorpay Refund API. Publishes `payment.refunded` event (consumed by Wallet Service and Enrollment Service).
- Payment status: `GET /payments/:paymentId` — returns payment details for the Transaction History page.
- Learner payment history: `GET /payments?learnerId=X` — paginated list of all payments for a learner.

**Why separate from Wallet Service?** Payment Service talks to Razorpay and handles the raw money movement (checkout, webhooks, refunds). Wallet Service handles the accounting (who is owed what). They are different concerns — one is about Razorpay API, the other is about ledger math.

---

#### `wallet-service` (port 4007)

**Owns tables:** `wallet_ledger`, `creator_balances`

**Responsibilities:**
This service is the source of truth for how much each creator has earned and how much they are owed. It maintains a double-entry-style ledger.

- Credit on enrollment: listens for `payment.verified` event. Computes `net = amount × (1 − commission_rate)`. Writes two ledger entries: `enrollment_gross_credit` for the full amount and `commission_debit` for the platform's cut. Updates the creator's running balance in `creator_balances`.
- Debit on refund: listens for `payment.refunded` event. Writes a `refund_debit` ledger entry, reducing the creator's balance by the net amount originally credited.
- Balance query: `GET /wallet/:creatorId/balance` — returns current pending balance, total earned (all time), total paid out, total commissions paid. Used by Finance page.
- Ledger query: `GET /wallet/:creatorId/ledger?page=X` — paginated, filterable (by type, by date range) transaction ledger. Used by the Finance → Transaction Ledger table.
- Balance check for payout: `GET /wallet/eligible-for-payout` (Admin only) — returns all creators whose balance ≥ minimum payout threshold and whose KYC is approved. Used by Payout Service before initiating disbursement.
- Post-payout debit: listens for `payout.completed` event from Payout Service. Writes a `payout_debit` ledger entry and zeros the creator's pending balance.
- TDS tracking: for each `enrollment_credit`, checks the creator's year-to-date gross and records whether TDS should be withheld. Writes `tds_debit` entries when applicable.
- Annual earnings statement: `GET /wallet/:creatorId/annual-statement?year=2026` — aggregates all ledger entries for the year into a downloadable summary.

**The `creator_balances` table** holds the denormalised running balance per creator. It is updated atomically (using a database transaction) whenever a ledger entry is written, so that balance reads are O(1) instead of summing the entire ledger on every request.

---

#### `payout-service` (port 4008)

**Owns tables:** `payout_runs`, `payout_items`, `kyc_details`

**Responsibilities:**
This service handles two distinct concerns: **KYC** (creator bank account verification) and **Disbursement** (sending money).

**KYC:**
- `POST /kyc/:creatorId` — accepts bank account or UPI details. Calls Razorpay API to create a Contact + Fund Account. Stores `(razorpay_contact_id, razorpay_fund_account_id, kyc_status=pending)`.
- Razorpay KYC Webhook: `POST /kyc/webhook` — handles KYC status updates from Razorpay. Updates `kyc_status` to `approved` or `failed`. Publishes `kyc.status_changed` event (Notification Service sends email to creator).
- KYC status query: `GET /kyc/:creatorId` — returns current KYC status and masked bank details.
- Re-KYC: creator can update bank details (creates a new Fund Account in Razorpay and re-triggers verification).

**Disbursement:**
- Initiate bulk payout: `POST /payouts/bulk` (Admin only). Calls Wallet Service to get all eligible creators. For each: calls Razorpay Payout API with the creator's Fund Account ID and the pending balance. Creates a `payout_run` record and one `payout_item` per creator (status `processing`).
- Razorpay Payout Webhook: `POST /payouts/webhook` — handles `payout.processed` and `payout.failed` events. Updates `payout_item.status`. On `payout.processed`: publishes `payout.completed` event (Wallet Service debits the creator's balance; Notification Service sends confirmation email to creator). On `payout.failed`: marks item as failed, publishes `payout.failed` event (Notification Service alerts creator to fix bank details; Admin notified).
- Retry failed payout: `POST /payouts/:payoutItemId/retry` (Admin only).
- Payout run history: `GET /payouts/runs` (Admin) — list of all payout runs. `GET /payouts/runs/:runId` — per-creator breakdown for a single run.
- Creator payout history: `GET /payouts?creatorId=X` — list of all payouts received by a creator.
- TDS certificate generation: `GET /payouts/tds-certificate/:creatorId?year=2026` — generates PDF TDS certificate for the given year using payout and TDS deduction records from Wallet Service.

---

#### `notification-service` (port 4009)

**Owns tables:** `notifications`, `notification_preferences`

**Responsibilities:**
- In-app notification creation: consumes events from all other services and creates rows in the `notifications` table. Pushes the notification to the user's Supabase Realtime channel so the frontend bell icon updates without a poll.
- Email dispatch: sends transactional emails using Resend (or Brevo/SES). Each email type has a corresponding template.
- Notification preferences: honours each user's preferences (`notification_preferences` table) — skips email dispatch if the user has disabled that notification type.
- Notification list: `GET /notifications?userId=X&page=Y` — paginated list for the full Notifications page.
- Mark as read: `PUT /notifications/:id/read`, `PUT /notifications/read-all`.
- Unread count: `GET /notifications/unread-count` — fast integer query (used to render the badge).
- Email batching: comments/doubts are batched — at most one "new activity" email per creator per hour. This prevents spamming a creator who gets 20 comments in quick succession.

**Events consumed and actions taken:**

| Event | Action |
|---|---|
| `user.registered` | Send welcome + email verification email. |
| `user.password_reset_requested` | Send password reset email. |
| `enrollment.created` | Send enrollment confirmation email to learner. |
| `enrollment.completed` | Send course completion email with certificate link to learner. |
| `course.published` (new course) | Send in-app + email notification to all subscribers of that creator. |
| `course.node_added` (to existing course) | Send in-app + email notification to enrolled learners. |
| `comment.created` | Send batched in-app + email notification to course creator. |
| `comment.replied` | Send in-app + email notification to comment author. |
| `kyc.status_changed` | Send KYC approved/rejected email to creator. |
| `payout.completed` | Send payout confirmation email to creator. |
| `payout.failed` | Send payout failure alert to creator + admin. |
| `support_ticket.updated` | Send ticket status update email to ticket owner. |
| `achievement.badge_earned` | Send in-app notification to learner. |

---

#### `support-service` (port 4010)

**Owns tables:** `support_tickets`, `ticket_messages`, `canned_responses`

**Responsibilities:**
- Create ticket: `POST /tickets` — creates a ticket from any user. Auto-creates a ticket for refund requests (linked to `payment_id`).
- Ticket list: `GET /tickets` — for users (returns their own tickets only); for admin (returns all tickets with filter/sort).
- Ticket detail: `GET /tickets/:id` — returns full ticket + message thread.
- Reply: `POST /tickets/:id/messages` — adds a message to the thread. Can be marked `is_internal_note = true` (admin only, not visible to the user). Publishes `support_ticket.updated` event.
- Status change: `PUT /tickets/:id/status` — open / in_progress / resolved. Publishes `support_ticket.updated` event.
- Assign ticket: `PUT /tickets/:id/assign` (Admin only).
- Canned responses: `GET /canned-responses`, `POST /canned-responses`, `PUT /canned-responses/:id`, `DELETE /canned-responses/:id` (Admin write, all admin read).
- Refund ticket: `POST /tickets/:id/refund-decision` (Admin only) — approve or reject a refund. On approval, calls Payment Service refund endpoint.

---

#### `achievement-service` (port 4011)

**Owns tables:** `badges`, `user_badges`, `user_streaks`, `certificates`

**Responsibilities:**
- Badge rule evaluation: consumes events and checks all badge rules after each event. Rules are defined as data in the `badges` table (each badge has a `rule_key` that maps to a rule function in the service code). If a new badge is earned, writes a `user_badges` row and publishes `achievement.badge_earned` event.
- Streak tracking: consumes `node_progress.completed` events. Updates `user_streaks.last_activity_date` and `current_streak` for the relevant learner. Resets streak if the gap between last activity and today is > 1 day (with grace period logic). Recalculates `longest_streak` if current exceeds it.
- Streak query: `GET /achievements/:userId/streak` — returns current streak, longest streak, and last activity date.
- Badge list: `GET /achievements/:userId/badges` — returns all badges (earned ones with date + locked ones) for the achievements page.
- Certificate generation: listens for `enrollment.completed` event. If the course has `certificate_enabled = true`, generates a PDF certificate using a template (Puppeteer or pdf-lib). Stores in Supabase Storage. Creates a `certificates` row with a `verification_token` (UUID). Publishes `achievement.certificate_issued` event (Notification Service sends the email).
- Certificate verification: `GET /certificates/verify/:token` — public endpoint. Returns certificate details (learner name, course name, creator name, completion date) if the token is valid. Used by the `/verify/:certId` public page.
- Certificate download: `GET /certificates/:id/download` — returns a signed URL to the PDF in Supabase Storage (authenticated, learner can only access their own certificates).

---

#### `analytics-service` (port 4012)

**Owns tables:** (read-only access to `node_progress`, `enrollments`, `wallet_ledger`, `users`, `courses`, `payments`)

**Responsibilities:**
This service aggregates data for three audiences: Learner (report card), Creator (course analytics), and Admin (platform KPIs). It always reads from a **read replica** of the database to avoid impacting write performance.

- **Learner report card**: `GET /analytics/learner/:userId/report-card` — returns:
  - Summary stats (total nodes completed, total hours, quiz attempts, pass rate).
  - Per-course breakdown (completion %, per-quiz scores with attempt history).
  - Activity data for the heatmap (daily node completions for the past 52 weeks).

- **Creator course analytics**: `GET /analytics/creator/:creatorId/courses/:courseId` — returns:
  - Enrollment trend (new enrollments per day/week/month).
  - Node completion funnel (% of enrolled learners who completed each node).
  - Revenue breakdown (gross, commission, net, refunds).
  - Quiz performance (avg score per quiz, per-question wrong answer rates).

- **Creator overview stats**: `GET /analytics/creator/:creatorId/overview` — fast aggregated KPIs for the creator overview page (total revenue, total students, course count, avg rating).

- **Admin platform KPIs**: `GET /analytics/admin/overview` — platform-wide stats (total users, new signups today/week, total revenue, commission earned, active learners MTD, total published courses).

- **Admin revenue chart**: `GET /analytics/admin/revenue?period=12m` — monthly revenue and commission trend data.

- **Caching**: all analytics endpoints cache their results for 5 minutes in Redis (or Supabase edge cache). Cache is invalidated by writing a cache key with the relevant entity ID when events arrive (e.g., `enrollment.created` invalidates the creator's overview cache and the course's funnel cache).

---

### 4.3 API Gateway Routing Table

| URL Prefix | Routed to |
|---|---|
| `/api/auth/*` | `auth-service:4001` |
| `/api/users/*` | `user-service:4002` |
| `/api/courses/*` | `course-service:4003` |
| `/api/enrollments/*` | `enrollment-service:4004` |
| `/api/search/*` | `search-service:4005` |
| `/api/payments/*` | `payment-service:4006` |
| `/api/wallet/*` | `wallet-service:4007` |
| `/api/payouts/*` | `payout-service:4008` |
| `/api/notifications/*` | `notification-service:4009` |
| `/api/support/*` | `support-service:4010` |
| `/api/achievements/*` | `achievement-service:4011` |
| `/api/analytics/*` | `analytics-service:4012` |

### 4.4 Inter-Service Communication

**Synchronous (HTTP)**: used when Service A needs data from Service B to complete the current request. Example: Enrollment Service calls Course Service to confirm a course exists and is published before creating an enrollment.

**Asynchronous (Event Queue)**: used for all side effects that don't need to block the response. The queue is implemented with **BullMQ on Redis** (cheap, reliable, supports delayed jobs and retries). Each service has its own queue consumer.

Key event flows:

```
[Learner clicks Enroll on paid course]
  └─► payment-service: creates Razorpay order → returns order_id to frontend
        └─► [Razorpay processes payment, fires webhook]
              └─► payment-service: verifies webhook → publishes payment.verified
                    ├─► wallet-service: credits creator balance, writes ledger
                    ├─► enrollment-service: creates enrollment record
                    │     └─► publishes enrollment.created
                    │           └─► notification-service: sends enrollment email
                    └─► (enrollment.created is also consumed by achievement-service
                          for "first enrollment" badge check)

[Learner completes last node in course]
  └─► enrollment-service: marks course complete → publishes enrollment.completed
        ├─► achievement-service: generates certificate, checks badges
        │     ├─► publishes achievement.certificate_issued
        │     │     └─► notification-service: sends certificate email
        │     └─► publishes achievement.badge_earned (if applicable)
        │           └─► notification-service: sends badge in-app notification
        └─► analytics-service: invalidates course funnel cache

[Admin initiates bulk payout]
  └─► payout-service: calls wallet-service for eligible creators → calls Razorpay
        └─► [Razorpay fires payout webhook]
              └─► payout-service: updates payout_item status → publishes payout.completed
                    ├─► wallet-service: writes payout_debit, zeros creator balance
                    └─► notification-service: sends payout confirmation email to creator
```

### 4.5 Payment & Payout — Razorpay Integration Detail

#### Enrollment Payment Flow
1. Learner clicks "Enroll Now" on a paid course.
2. Frontend → `POST /api/payments/create-order` → Payment Service validates course + non-enrolled, creates Razorpay Order, returns `{ order_id, key_id, amount }`.
3. Frontend opens Razorpay checkout modal.
4. On payment success, Razorpay fires `payment.captured` webhook to Payment Service's public webhook endpoint.
5. Payment Service verifies HMAC-SHA256 signature using `RAZORPAY_WEBHOOK_SECRET`. Rejects any unverified payload immediately.
6. On verified success: updates payment status → publishes `payment.verified` event to queue.
7. Wallet Service consumes event: reads current `commission_rate` from `platform_settings`, calculates `net = amount × (1 − rate)`, writes `enrollment_gross_credit` + `commission_debit` ledger entries, atomically increments `creator_balances.pending`.
8. Enrollment Service consumes event: creates enrollment row, sets `progress_percent = 0`.
9. Notification Service consumes `enrollment.created`: sends confirmation email.

#### Creator KYC Flow
1. Creator submits bank details → `POST /api/payouts/kyc`.
2. Payout Service calls Razorpay: `POST /v1/contacts` (type=`vendor`) → gets `contact_id`.
3. Calls Razorpay: `POST /v1/fund_accounts` with `contact_id` + bank/UPI details → gets `fund_account_id`.
4. Stores `(creator_id, razorpay_contact_id, fund_account_id, kyc_status=pending)`.
5. Razorpay sends KYC result via webhook → Payout Service updates `kyc_status`.
6. Publishes `kyc.status_changed` → Notification Service sends result email.

#### Bulk Payout Flow
1. Admin clicks "Initiate Bulk Payout" → `POST /api/payouts/bulk`.
2. Payout Service calls Wallet Service: `GET /wallet/eligible-for-payout` → gets list of `{ creator_id, fund_account_id, amount }`.
3. Creates a `payout_run` record. For each creator: calls Razorpay `POST /v1/payouts` with fund_account_id + amount (INR paise). Creates `payout_item` with `status=processing`.
4. Razorpay fires `payout.processed` / `payout.failed` webhooks per creator.
5. On `payout.processed`: Payout Service updates item → publishes `payout.completed` → Wallet Service debits creator balance + writes `payout_debit` ledger entry → Notification Service emails creator.
6. On `payout.failed`: marks item failed → publishes `payout.failed` → Notification Service emails creator with failure reason → Admin sees it in failed payouts list.

---

## 5. Database Design (Supabase / PostgreSQL)

### 5.1 Core Tables (high level)

- `users` — id, email, password_hash, role (`learner` | `creator` | `admin`), created_at, is_verified.
- `profiles` — user_id (FK), display_name, username (unique), bio, college, avatar_url, social_links (JSONB), theme_preference, created_at, updated_at.
- `courses` — id, creator_id (FK), title, subtitle, description, category_id, language, level, status (`draft` | `under_review` | `published` | `archived`), thumbnail_url, promo_video_url, price, discounted_price, discount_valid_until, certificate_enabled, created_at, updated_at.
- `sections` — id, course_id (FK), title, position (integer for ordering).
- `lessons` — id, section_id (FK), title, type (`video` | `article` | `quiz` | `assignment`), content_url or content_json, duration_seconds, is_free_preview, position.
- `enrollments` — id, learner_id (FK), course_id (FK), enrolled_at, completed_at, progress_percent.
- `lesson_progress` — learner_id, lesson_id, is_completed, watch_position_seconds, last_accessed_at. (Composite PK on learner_id + lesson_id.)
- `payments` — id, learner_id, course_id, razorpay_order_id, razorpay_payment_id, amount, status, created_at.
- `ledger_entries` — id, creator_id, type (`enrollment_credit` | `refund_debit` | `commission_debit` | `payout_debit`), amount, reference_id, created_at.
- `payouts` — id, creator_id, razorpay_payout_id, amount, status, initiated_at, settled_at.
- `doubts` — id, course_id, lesson_id, learner_id, body, created_at, is_resolved.
- `doubt_replies` — id, doubt_id, author_id, body, created_at.
- `bookmarks` — learner_id, course_id, created_at. (Composite PK.)
- `reviews` — id, course_id, learner_id, rating (1–5), body, created_at.
- `notifications` — id, user_id, type, payload (JSONB), is_read, created_at.
- `support_tickets` — id, user_id, subject, status, assigned_admin_id, created_at, updated_at.
- `ticket_messages` — id, ticket_id, author_id, body, is_internal_note, created_at.
- `badges` — id, name, description, icon_url, rule_key.
- `user_badges` — user_id, badge_id, earned_at.
- `certificates` — id, learner_id, course_id, issued_at, verification_token (unique).
- `kyc_details` — creator_id, razorpay_contact_id, razorpay_fund_account_id, kyc_status, bank_name, account_number_last4, ifsc, upi_id, verified_at.
- `creator_terms_acceptance` — creator_id, accepted_at, commission_rate_at_acceptance, terms_version.
- `platform_settings` — key (PK), value, updated_at, updated_by.

### 5.2 Indexing Strategy

- All FK columns indexed.
- `courses.status` + `courses.created_at` composite index for catalog queries.
- `enrollments(learner_id, course_id)` unique constraint.
- `lesson_progress(learner_id, lesson_id)` composite index.
- Full-text search index on `courses.title`, `courses.description` using PostgreSQL `tsvector` with `GIN` index.

### 5.3 Row-Level Security (RLS)

Supabase RLS policies enforce:
- Learners can only read/write their own progress, bookmarks, and payment data.
- Creators can only read/write their own courses, lessons, and finance data.
- Admins have unrestricted access to all tables.
- Public can read `courses` where `status = 'published'` and `profiles`.

---

## 6. Infrastructure & Scalability

### 6.1 Architecture Overview

```
Browser / Mobile
      │
      ▼
CDN (Cloudflare)
      │
      ├── /  (Next.js SSG pages — frontend/)
      │
      └── /api/* (all API traffic)
                │
                ▼
         api-gateway :4000
         (rate-limit · auth check · routing · correlation IDs)
                │
   ┌────────────┼──────────────────────────────────┐
   │            │            │                      │
   ▼            ▼            ▼                      ▼
auth-service  user-service  course-service  enrollment-service
  :4001         :4002         :4003             :4004
   │
   ▼
search-service  payment-service  wallet-service  payout-service
   :4005            :4006            :4007           :4008
                      │                │                │
                      ▼                ▼                ▼
                  Razorpay API    Supabase DB      Razorpay
                  (checkout)      (ledger)         Payout API

notification-service  support-service  achievement-service  analytics-service
     :4009               :4010              :4011               :4012
       │                                      │                    │
       ▼                                      ▼                    ▼
  Resend / SES                       Supabase Storage        Read Replica
  (emails)                           (certificates)          (Postgres)
  Supabase Realtime
  (in-app push)

All services ──────────────────────────────────► Supabase PostgreSQL (primary)
All async events ───────────────────────────────► BullMQ / Redis (message queue)
```

### 6.2 Video Pipeline

Video content is not hosted on the platform's own infrastructure. Creators provide YouTube or Google Drive links (see `course.md §4.3`). The platform stores only the video ID / URL.

- **YouTube embed**: the frontend uses the YouTube IFrame API to embed the player. The platform hooks into IFrame API events (`onStateChange`, `getCurrentTime`) to track watch progress and save position every 10 seconds.
- **Google Drive embed**: the frontend renders a Google Drive preview iframe. Progress tracking is more limited (time-based estimation rather than event-driven). Suitable for low-traffic content.
- **No transcoding cost**: because the platform does not host video files, there is zero storage or CDN cost for video. YouTube and Google Drive serve as free global CDNs.
- **Future upgrade path**: if the platform later needs self-hosted video (e.g., for private/DRM content), the `video_source` field on a node can be extended to support a third option `hosted`, at which point a transcoding pipeline (AWS MediaConvert → HLS → CloudFront) would be added as an opt-in path without breaking existing YouTube/Drive nodes.

### 6.3 Latency Targets

- API p95 response time: < 200ms for read endpoints, < 500ms for write endpoints.
- Video first-frame time: < 2 seconds on a 10 Mbps connection.
- Database queries: all queries used in hot paths must be covered by indexes and must execute in < 50ms as measured by `EXPLAIN ANALYZE`.
- No N+1 queries — all list endpoints use joins or batch fetching.

### 6.4 Caching Strategy

- **CDN cache**: static assets (JS, CSS, images) cached with long TTLs + content-hash busting.
- **API cache**: course catalog responses cached in Redis (or Supabase's edge functions cache) for 60 seconds. Cache invalidated on course publish/update.
- **DB read replicas**: analytics and report card queries routed to a read replica to avoid contending with write traffic.

### 6.5 Queue / Async Processing

A message queue (e.g., BullMQ on Redis, or Supabase Edge Functions with Deno queues) handles:
- Post-payment enrollment processing.
- Email dispatch (enrollment confirmation, doubt notification, payout alert).
- Badge/achievement evaluation after lesson completion.
- Certificate PDF generation after course completion.
- Video transcoding job dispatch.

---

## 7. Email / Notification Service

Use a cost-effective transactional email provider (e.g., **Resend**, **Brevo**, or **Amazon SES**). These are cheap at low volume and scale to millions of emails/month without infrastructure changes.

Email templates to implement:
- Welcome / email verification.
- Enrollment confirmation (with course link).
- Course completion (with certificate download link).
- New doubt reply notification (to creator and learner).
- Payout processed confirmation (to creator).
- KYC approved / rejected.
- Support ticket update.
- Password reset.

All emails must be HTML + plain-text multipart. The platform logo and brand colors are used in templates. Unsubscribe link in footer (required for CAN-SPAM / DPDP compliance).

---

## 8. Security Considerations

- **Authentication**: JWT access tokens (15-minute expiry) + refresh tokens (30-day expiry, stored in httpOnly cookies). Refresh tokens are rotated on each use.
- **Password hashing**: bcrypt with cost factor 12.
- **HTTPS everywhere**: all endpoints TLS only. HSTS headers.
- **CSRF protection**: SameSite=Strict cookies + CSRF token for state-mutating API calls.
- **Input validation**: all API inputs validated server-side with a schema validation library (Zod / Joi). Never trust client-supplied data.
- **File upload security**: MIME type and magic-byte validation on uploads. Virus scanning on uploaded files (ClamAV or a cloud scanning API).
- **Razorpay webhook verification**: every webhook payload verified with HMAC-SHA256 signature before processing.
- **Rate limiting**: login endpoint: max 5 attempts per 15 minutes per IP. General API: 300 req/min per authenticated user.
- **Secrets management**: all API keys, DB credentials, and webhook secrets stored in environment variables / a secrets manager (never in source code or config files).
- **Audit log**: all admin actions (payout initiation, commission change, user ban) written to an immutable audit log table.

---

## 9. Compliance & Legal

- **Terms & Conditions for Creators**: must be accepted before submitting any course. The T&C explicitly states the platform commission rate, payout schedule, prohibited content policy, and refund policy. Acceptance is recorded with timestamp and the specific T&C version.
- **KYC for Payouts**: required by RBI regulations for Razorpay payouts. Every creator receiving payouts must complete KYC via Razorpay before any payout is disbursed.
- **TDS deduction**: platform deducts TDS (Tax Deducted at Source) on creator earnings as required under Indian income tax law. Downloadable TDS certificates generated quarterly.
- **DPDP (Digital Personal Data Protection) Act compliance**: user data consent collected at signup. Users can request data export and account deletion. PII is never logged in application logs.
- **Refund Policy**: configurable by admin (e.g., 7-day no-questions-asked refund window). Refunds are processed back to the original payment method via Razorpay.
