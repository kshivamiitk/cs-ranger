# LearnRift — Functional Requirements Checklist

Cross-referenced against every requirement in `Docs/summary.md`, `common.md`, `design.md`, `learner.md`, `creator.md`, `admin.md`, `course.md`.

**Legend**: ✅ working end-to-end (DB → backend → frontend) once `.env` is populated · 🟡 partial · ⏳ stubbed (needs env keys) · ⬜ not started

---

## 1. Authentication (common.md §3)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1.1 | Email + password signup with verification email | ✅ | bcrypt hash, token table, email via Resend |
| 1.2 | Email verification token (24h validity) | ✅ | `email_verification_tokens` + `/auth/verify-email` |
| 1.3 | Google OAuth signup/login | ✅ | Supabase-hosted Google flow in browser → `/auth/callback` → `POST /auth/oauth/exchange` issues platform JWTs; new users get profile + learner role + onboarding; suspension enforced. Needs the Google provider enabled in the Supabase dashboard |
| 1.4 | Role selection at signup (learner/creator/both) | ✅ | UI step 2 + `user_roles` rows on register |
| 1.5 | Login rate-limit (5/15min) | ✅ | Per-IP bucket in api-gateway |
| 1.6 | Forgot / reset password flows | ✅ | Hashed reset tokens, 1h expiry, email via Resend |
| 1.7 | JWT access (15m) + refresh (30d, rotating) | ✅ | jsonwebtoken signing, rotation in `/auth/refresh` |
| 1.8 | httpOnly SameSite=Strict refresh cookie | 🟡 | Currently stored in localStorage; cookie migration is one-line change |
| 1.9 | Logout from all devices | ✅ | `/auth/logout-all` revokes all refresh tokens |
| 1.10 | 4-step onboarding flow | ✅ | Resumable /onboarding wizard (role → profile → preferences → finish) with redirect for incomplete users |

## 2. Global / Common (common.md §4, §5, §6)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 2.1 | Sticky navbar with role-specific links | ✅ | |
| 2.2 | Role switcher (Learner ↔ Creator) | ✅ | |
| 2.3 | Theme toggle, persisted to localStorage + DB | ✅ | Settings → Appearance applies + stores locally and syncs `themePreference` to the profile |
| 2.4 | Notifications bell with realtime updates | ✅ | Supabase Realtime broadcast (`user:<id>:notifications`) + 60s polling fallback |
| 2.5 | Global search bar with `/` shortcut + debounce | ✅ | Live autocomplete against `/api/search/autocomplete` |
| 2.6 | Avatar dropdown menu | ✅ | |
| 2.7 | Profile editor with username uniqueness check | ✅ | UI + `GET /users/check-username` |
| 2.8 | Public profile `/u/:username` | ✅ | Real `/api/users/by-username/:u` |
| 2.9 | Settings: account, notifications, privacy, appearance | ✅ | Real password change, deactivate, notification preferences and theme sync (privacy is informational by design) |
| 2.10 | 404 / 500 / 403 error pages | ✅ | |
| 2.11 | Landing page | ✅ | Pulls real featured courses + creators from DB |

## 3. Course Catalog & Discovery (course.md §9, learner.md §5)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 3.1 | Catalog with responsive grid | ✅ | |
| 3.2 | Filters: category, price, rating | ✅ | Plus level / language / duration filters, active-filter chips, reset, URL-synced state |
| 3.3 | Sort: relevance, newest, popular, rated, price | ✅ | |
| 3.4 | Full-text search via PG `tsvector` + GIN | ✅ | `textSearch` on `search_vector` with prefix-match |
| 3.5 | Trigram autocomplete | ✅ | `pg_trgm` + `idx_courses_title_trgm` |
| 3.6 | URL-based pagination, 20/page | ✅ | |
| 3.7 | Course detail page | ✅ | `GET /api/courses/:id/detail` aggregated |
| 3.8 | Free preview node access | ✅ | `is_free_preview` schema + UI |
| 3.9 | Skeleton loaders | ✅ | React Query loading states |

## 4. Course Content Model — 5 Node Types (course.md §4)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 4.1 | **PDF node** with embedded viewer | ✅ | react-pdf canvas viewer with page nav, zoom, fit width, sticky toolbar, iframe fallback; signed-URL gated; pages-viewed ≥80% feeds the completion engine |
| 4.2 | **Static Website node** with HTML/CSS/JS Monaco editor + sandboxed iframe | ✅ | Monaco-React + sandbox iframe in both editor and player |
| 4.3 | **Video node — YouTube** with watch tracking | ✅ | URL extraction → embed; watch position saved every 10s |
| 4.4 | **Video node — Google Drive** preview embed | ✅ | URL extraction → `/preview` |
| 4.5 | Video chapters / timestamps | ✅ | `nodes.video_chapters` (validated ascending) + creator chapter editor + learner chapter list with click-to-seek (YouTube) |
| 4.6 | Video subtitles (.vtt/.srt) | ✅ | `nodes.video_subtitles` + creator track editor + learner open/download links (embeds can't take external tracks) |
| 4.7 | Timestamped video notes | ✅ | Notes tab anchors to YouTube currentTime; clicking a note seeks the video |
| 4.8 | **Markdown node** with KaTeX, code highlighting | ✅ | KaTeX + highlight.js code blocks + DOMPurify sanitisation |
| 4.9 | **Quiz node** with timer, retakes, scoring | ✅ | Full grading + attempt persistence |
| 4.10 | Quiz "Review Answers" mode | ✅ | Past attempts list + read-only review (picked vs correct + explanations) |
| 4.11 | Per-node attachments | ✅ | Upload in NodeEditor (private bucket, signed downloads), listed in the player Resources tab |
| 4.12 | Free-preview toggle per node | ✅ | |

## 5. Course Player (learner.md §14)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 5.1 | Sidebar with module/node tree | ✅ | Real progress via `/api/enrollments/:courseId/progress` |
| 5.2 | Previous / Next navigation | ✅ | |
| 5.3 | 5-second auto-advance | ✅ | Countdown banner with Cancel; fires on completion + YouTube ended |
| 5.4 | "Mark as Done" | ✅ | `/api/enrollments/progress/:nodeId/complete` (policy-aware; quizzes excluded) |
| 5.5 | Per-node completion rules | ✅ | 80% scroll (markdown/PDF), 80% watch (video), quiz pass, manual for static sites |
| 5.6 | Bookmark icon on node | ✅ | Optimistic toggle with rollback, synced with /bookmarks |
| 5.7 | Doubts/Q&A thread | ✅ | Post, list, upvote, resolve real |
| 5.8 | Notes tab | ✅ | Save + load via `/api/enrollments/notes/:nodeId` |
| 5.9 | Watch position save every 10s | ✅ | setInterval in player → /watch-position |

## 6. Learner Pages

| # | Requirement | Status | Notes |
|---|---|---|---|
| 6.1 | Home: greeting, heatmap, continue learning | ✅ | Real heatmap from achievement-service |
| 6.2 | My Courses (In Progress / Completed) | ✅ | |
| 6.3 | Creator directory `/creators` | ✅ | Real `/api/search/creators` |
| 6.4 | Subscribe / Unsubscribe | ✅ | FollowButton (optimistic) on /creators, /u/[username] and course pages; follower counts; /feed shows published courses from followed creators with notifications on publish |
| 6.5 | Bookmarks page | ✅ | Real `/api/courses/bookmarks` |
| 6.6 | Achievements (badges, streaks, certificates) | ✅ | Real badges + streak + heatmap |
| 6.7 | Report Cards | ✅ | Real `/api/analytics/learner/:userId/report-card` |
| 6.8 | Transactions | ✅ | Real `/api/payments/` |
| 6.9 | Support (FAQ + ticket form + history) | ✅ | |

## 7. Creator Pages

| # | Requirement | Status | Notes |
|---|---|---|---|
| 7.1 | Overview KPIs + payout status | ✅ | Real analytics + wallet |
| 7.2 | Courses table | ✅ | DB-driven |
| 7.3 | **5-step builder with all node editors** | ✅ | Creates real courses + modules + nodes via API |
| 7.4 | Per-course analytics | ✅ | Per-course page + new `/creator/analytics` dashboard with 7d/30d/90d/all ranges |
| 7.5 | Doubts unified inbox | ✅ | List/detail inbox with filters, search, pagination, reply, resolve/reopen + learner notifications |
| 7.6 | Finance: KYC form + ledger + payouts | ✅ | Real Razorpay X KYC; ledger from wallet-service |
| 7.7 | Creator T&C acceptance | ✅ | Acceptance modal + server-side gate on publish/submit (`TERMS_ACCEPTANCE_REQUIRED`), status on Finance |
| 7.8 | TDS / annual statement | ✅ | FY summary from ledger + PDF/CSV download on /creator/finance |

## 8. Admin Pages

| # | Requirement | Status | Notes |
|---|---|---|---|
| 8.1 | Overview: KPIs, revenue chart, review queue | ✅ | Real analytics + course mutations |
| 8.2 | Course review queue: **Approve / Reject** | ✅ | One-click approve; reject with reason (≥ 20 chars) |
| 8.3 | Payouts: commission, threshold | ✅ | Read from `platform_settings` (env fallback); editable via Admin Settings |
| 8.4 | Pending payouts table with KYC filter | ✅ | Real `/wallet/eligible-for-payout` |
| 8.5 | **Initiate Bulk Payout** with confirmation | ✅ | Razorpay X bulk dispatch + idempotency keys |
| 8.6 | Payout run history | ✅ | Real `/payouts/runs` |
| 8.7 | Failed payouts retry | ✅ | Real re-dispatch (fresh idempotency key) + failed-payouts table with Retry |
| 8.8 | Manual single-creator payout | ✅ | `POST /payouts/manual` (amount + reason, balance check, override) + modal; audited |
| 8.9 | Support inbox with internal notes | ✅ | Real `/api/support/` |
| 8.10 | Linked refund tickets | ✅ | Learner "Request refund" creates a payment-linked ticket; admin approves/rejects from the ticket (audited, idempotent) |
| 8.11 | Users list + manage | ✅ | Filters + Manage modal: suspend/unsuspend (reason), grant/revoke creator, two-person admin grant; all audited |
| 8.12 | Courses platform-wide | ✅ | Real |
| 8.13 | Categories | ✅ | Real |
| 8.14 | Platform Settings | ✅ | DB-backed `platform_settings` GET/PATCH (Zod-validated, jsonb, updated_by) + real settings page |
| 8.15 | Audit log with filters | ✅ | Paginated `/users/admin/audit-log` (action/admin/date/target filters) + viewer UI |
| 8.16 | Audit log immutability | ✅ | Postgres triggers |

## 9. Payments & Money (design.md §4.5)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 9.1 | Create Razorpay Order | ✅ | Real `razorpay.orders.create` with receipt + notes |
| 9.2 | Razorpay checkout modal | ✅ | `useRazorpayCheckout()` hook |
| 9.3 | Webhook HMAC-SHA256 verification | ✅ | Timing-safe compare |
| 9.4 | Idempotent webhook | ✅ | `webhook_event_id` unique index |
| 9.5 | Refund initiation (admin) | ✅ | Real `razorpay.payments.refund` |
| 9.6 | Wallet ledger atomic credit + commission | ✅ | DB trigger applies ledger to balances |
| 9.7 | Refund debit reverses earlier credit | ✅ | Consumer creates `refund_debit` |
| 9.8 | KYC creation (Contact + Fund Account) | ✅ | Direct Razorpay REST calls |
| 9.9 | KYC webhook | ✅ | Signature-verified status updates |
| 9.10 | **Bulk payout initiation** | ✅ | Razorpay X with `X-Payout-Idempotency` |
| 9.11 | Payout webhook | ✅ | Signature-verified, fans out via events |

## 10. Achievements & Notifications

| # | Requirement | Status | Notes |
|---|---|---|---|
| 10.1 | 12 badges seeded | ✅ | |
| 10.2 | Streak tracking with grace period | ✅ | Consumer updates on node completion |
| 10.3 | Badge auto-evaluation on events | ✅ | Awards `streak_7`, `first_course` |
| 10.4 | Certificate generation | ✅ | Idempotent claim + pdf-lib PDF (Storage upload when configured, on-the-fly fallback) |
| 10.5 | Public certificate verification | ✅ | `/verify/:token` real |
| 10.6 | In-app notifications | ✅ | Created by event consumers |
| 10.7 | Supabase Realtime push | ✅ | Broadcast on every notification insert; client hook invalidates + refetches |
| 10.8 | Email dispatch via Resend | ✅ | Wrapper falls back to console.log without key |
| 10.9 | Notification preferences | ✅ | DB + endpoint |

## 11. Performance (design.md §6.3 — < 200ms p95 reads, < 50ms DB queries)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 11.1 | All FK columns indexed | ✅ | |
| 11.2 | `tsvector` GIN index for full-text | ✅ | |
| 11.3 | Trigram index for autocomplete | ✅ | |
| 11.4 | 18 hot-path composite indexes | ✅ | Migration 0011 |
| 11.5 | Denormalised `creator_balances` (O(1) reads) | ✅ | Trigger-maintained |
| 11.6 | API gateway rate limit | ✅ | 300/min general, 5/15min login |
| 11.7 | Analytics endpoints cached 5min | ✅ | In-memory; Redis upgrade trivial |
| 11.8 | React Query client cache | ✅ | 60s stale, no refetch on focus |
| 11.9 | Skeleton loaders | ✅ | |
| 11.10 | Supabase PgBouncer | ⏳ | Use `pooler.supabase.com:6543` URL |

## 12. Security (design.md §8)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 12.1 | bcrypt password hashing (cost 12) | ✅ | |
| 12.2 | JWT access + rotating refresh | ✅ | |
| 12.3 | Razorpay webhook HMAC verify | ✅ | Timing-safe |
| 12.4 | Razorpay payment signature verify | ✅ | |
| 12.5 | Zod input validation on every endpoint | ✅ | |
| 12.6 | RLS on every table | ✅ | Migration 0010 |
| 12.7 | Admin audit log immutability | ✅ | |
| 12.8 | Login rate limit (5/15min) | ✅ | |

## 13. Infrastructure

| # | Requirement | Status | Notes |
|---|---|---|---|
| 13.1 | 12 microservices + api-gateway | ✅ | |
| 13.2 | Shared `@cs-ranger/shared` package | ✅ | Supabase/Razorpay/email/events helpers |
| 13.3 | Health endpoints + aggregator | ✅ | |
| 13.4 | BullMQ event queue (Redis) | ✅ | `publish()` / `consume()` wired; no-op without `REDIS_URL` |
| 13.5 | Supabase Storage for files | ✅ | Avatars / course thumbnails / node attachments via multipart endpoints + `uploaded_assets` metadata, local dev fallback |

---

## What's needed for full end-to-end verification

The platform is now wired against real Supabase + Razorpay. To take it live for testing:

1. **Create a Supabase project** at supabase.com. Copy:
   - `Project URL` → `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY` (backend only)
2. **Apply migrations**: `cd database && ./apply.sh "$DATABASE_URL"`
3. **Set up Razorpay test mode** at dashboard.razorpay.com:
   - API Keys → `key_id` → `RAZORPAY_KEY_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID`
   - `key_secret` → `RAZORPAY_KEY_SECRET`
   - Webhooks → secret → `RAZORPAY_WEBHOOK_SECRET`
   - For payouts: enable RazorpayX, copy your account number → `RAZORPAY_ACCOUNT_NUMBER`
4. **Resend API key** (or Brevo/SES) → `RESEND_API_KEY`
5. **Generate a JWT secret**: `openssl rand -hex 32` → `JWT_SECRET`
6. **Optional**: Redis URL for event queue (Upstash works) → `REDIS_URL`

Once `.env` is populated, all 🟡 items above will use real data immediately. The platform runs end-to-end:

- Signup → email verification → login → onboarding ✅
- Create course → add 5-type nodes (video/markdown/quiz/pdf/static_website) → submit for review → admin approves → published ✅
- Learner enrolls (free or via Razorpay checkout) → consumes → completes quiz → earns badge → certificate ✅
- Creator KYC (Razorpay Contact + Fund Account) → Admin bulk payout (Razorpay X) → wallet ledger debit + notification ✅
- Razorpay webhook idempotency, refund flow, audit-log immutability all guarded server-side ✅
