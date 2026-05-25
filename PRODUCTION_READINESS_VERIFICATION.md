# Production Readiness Verification

Wave: "feature-complete prototype" → production-ready, testable, observable, socially engaging MVP.
Scope: test infrastructure, type/lint/CI gates, Google OAuth, creator subscriptions + follow feed, PDF viewer upgrade, video chapters & subtitles, scheduled payout runner, observability, documentation.

---

## 1. Summary of implemented production-readiness work

| Area | What was delivered |
|---|---|
| Test infrastructure | Vitest on both packages. Backend: 53 unit tests across 7 files (storage validation, platform-setting defaults, PDF money formatting, completion-engine rules, onboarding/refund schemas, video chapter/subtitle schemas, payout-window logic, metrics store). Frontend: 13 component/unit tests across 3 files (utils, FileUpload, CreatorTermsModal) with React Testing Library + jsdom. No Supabase/Razorpay/Resend network calls — fully deterministic. |
| Type/lint/CI gates | All 14 backend workspaces typecheck clean (`tsc --noEmit`), frontend typechecks clean, `next lint` passes with zero warnings. Root `package.json` orchestration scripts (`typecheck`, `lint`, `test`, `build`, `ci`) and a GitHub Actions workflow that runs entirely without secrets. |
| Google OAuth | Real Supabase-hosted Google sign-in in the browser (`signInWithOAuth`, PKCE) → `/auth/callback` waits for the Supabase session → `POST /auth/oauth/exchange` verifies the Supabase access token server-side and issues platform JWTs. New users get a user row (verified), learner role, profile with collision-safe username, avatar from Google metadata, and onboarding-incomplete state. Suspended users are rejected (403 SUSPENDED). Friendly disabled state when Supabase env is missing. No OAuth secrets in the frontend. |
| Subscriptions / follow feed | `FollowButton` (optimistic, with rollback) on the creators directory, public creator profile and course detail page; follower counts; `GET /users/me/subscriptions` and paginated `GET /users/me/feed` (published courses from followed creators); `/feed` page with skeleton/empty/error states and a navbar link; followers get a notification when a followed creator's course is published/approved (republish-safe, capped batch). |
| PDF viewer | `SecurePdfViewer` upgraded: sticky toolbar with page x/y, prev/next, zoom in/out, fit width; loading & error states; mobile-responsive widths; `<iframe>` fallback on the same enrollment-gated signed URL when react-pdf / the pdf.js worker fails; pages-viewed progress (`onProgress`) feeds the completion engine (≥ 80 % viewed completes the lesson). Private signed-URL protection unchanged. |
| Video chapters & subtitles | `nodes.video_chapters` / `nodes.video_subtitles` (jsonb, migration 0031) with Zod validation (strictly ascending chapter timestamps; vtt/srt tracks with valid URLs) on create and patch; creator chapter/subtitle editors in the lesson editor; learner chapter list with click-to-seek (YouTube) and subtitle open/download links; watch tracking untouched. |
| Scheduled payouts | Bulk payout logic extracted to a reusable runner; schedule read from `platform_settings.payout_schedule` (`manual` / `monthly_1st` / `monthly_1st_15th`); UTC window keys with a partial unique index on `payout_runs.scheduled_window` so a window can never be disbursed twice (concurrent calls included); `GET /payouts/scheduler/status` + `POST /payouts/scheduler/run-due` (admin); one-shot cron worker entrypoint (`npm run payout:run-due`); audit log entries for admin-triggered runs; admin Payouts page card with window status, last/next run, "Run due payouts now" and a mock-mode warning. |
| Observability | Request-ID propagation already existed; added per-service in-memory metrics (request totals, 4xx/5xx, latency buckets, average latency) exposed at `GET /metrics`, `GET /health/details` with Supabase/Redis connectivity probes (booleans + latency only), an admin-only gateway aggregate `GET /api/ops`, and an `/admin/ops` dashboard page with auto-refresh. No URLs, hostnames or keys in any payload. |
| Documentation | This file, plus `CHECKLIST.md` rows updated (1.3 OAuth, 4.1 PDF, 4.5/4.6 chapters/subtitles, 6.4 subscribe). |

---

## 2. Files changed

### Created

**Test & CI infrastructure**
- `backend/vitest.config.ts`
- `backend/tests/storage.test.ts`
- `backend/tests/settings-and-pdf.test.ts`
- `backend/tests/completion.test.ts`
- `backend/tests/validation-schemas.test.ts`
- `backend/tests/video-chapters.test.ts`
- `backend/tests/payout-scheduler.test.ts`
- `backend/tests/observability.test.ts`
- `backend/support-service/src/validation.ts` (RefundDecision schema extracted for testability)
- `frontend/vitest.config.mts`, `frontend/vitest.setup.ts`
- `frontend/src/lib/utils.test.ts`
- `frontend/src/components/common/FileUpload.test.tsx`
- `frontend/src/components/creator/CreatorTermsModal.test.tsx`
- `frontend/.eslintrc.json`
- `package.json` (repo root orchestration scripts)
- `.github/workflows/ci.yml`

**OAuth / subscriptions / feed**
- `frontend/src/components/auth/GoogleAuthButton.tsx`
- `frontend/src/app/auth/callback/page.tsx`
- `frontend/src/components/common/FollowButton.tsx`
- `frontend/src/app/feed/page.tsx`

**Chapters / subtitles / payouts / observability**
- `database/migrations/0031_video_chapters_subtitles.sql`
- `database/migrations/0032_payout_scheduler.sql`
- `backend/course-service/src/validation.ts`
- `backend/payout-service/src/scheduler.ts`
- `backend/payout-service/src/bulk.ts`
- `backend/payout-service/src/scheduler-worker.ts`
- `backend/shared/observability.ts`
- `frontend/src/app/admin/ops/page.tsx`

**Documentation**
- `PRODUCTION_READINESS_VERIFICATION.md`

### Modified

**Backend**
- `backend/package.json` (test/typecheck/payout:run-due scripts, vitest dev-dependency)
- `backend/payout-service/package.json` (`scheduler:run-due` script)
- `backend/auth-service/src/index.ts` (jwt SignOptions typing fix; `POST /oauth/exchange`)
- `backend/user-service/src/index.ts` (withDb generics; `GET /me/subscriptions`, `GET /me/feed`)
- `backend/user-service/src/onboarding.ts` (export `OnboardingPatch` for tests)
- `backend/wallet-service/src/index.ts`, `backend/payment-service/src/index.ts`, `backend/search-service/src/index.ts` (pre-existing typecheck fixes; search mock-fallback `p.meta.total` bug fix)
- `backend/course-service/src/index.ts` (pre-existing typecheck fixes; follower notifications on publish/approve; chapter/subtitle validation on node create/patch)
- `backend/payout-service/src/index.ts` (bulk logic moved to `bulk.ts`; scheduler status/run-due endpoints)
- `backend/shared/utils/server.ts` (metrics recording, `GET /metrics`, `GET /health/details`)
- `backend/shared/index.ts` (export observability module)
- `backend/api-gateway/src/index.ts` (`GET /api/ops` admin aggregate)

**Frontend**
- `frontend/package.json` (test scripts, vitest/RTL dev-dependencies)
- `frontend/src/lib/api.ts` (oauthExchange; subscriptions/feed; video chapter/subtitle types; payout scheduler; admin ops; new types)
- `frontend/src/app/(auth)/login/page.tsx`, `frontend/src/app/(auth)/signup/page.tsx` (real Google button)
- `frontend/src/components/common/Navbar.tsx` (Feed link for learners, Ops link for admins)
- `frontend/src/app/creators/page.tsx`, `frontend/src/app/u/[username]/page.tsx`, `frontend/src/app/course/[id]/page.tsx` (FollowButton / follower count)
- `frontend/src/components/common/SecurePdfViewer.tsx` (toolbar, zoom, page nav, fallback, progress)
- `frontend/src/app/course/[id]/learn/[nodeId]/Player.tsx` (PDF pages-viewed → completion engine)
- `frontend/src/app/course/[id]/learn/[nodeId]/VideoNode.tsx` (chapters with seek, subtitle links)
- `frontend/src/components/creator/NodeEditor.tsx` (chapter & subtitle editors)
- `frontend/src/components/creator/CourseBuilder.tsx` (persist chapters/subtitles on save)
- `frontend/src/app/admin/payouts/page.tsx` (scheduled payouts card)
- `frontend/src/app/creator/collaborations/page.tsx` (Suspense boundary around `useSearchParams` — pre-existing production-build blocker)
- `CHECKLIST.md` (rows 1.3, 4.1, 4.5, 4.6, 6.4)

---

## 3. Migrations added

| Migration | Contents | Applied to Supabase |
|---|---|---|
| `0031_video_chapters_subtitles.sql` | `nodes.video_chapters jsonb`, `nodes.video_subtitles jsonb` (idempotent `add column if not exists`) | ✅ verified (`information_schema.columns`) |
| `0032_payout_scheduler.sql` | `payout_runs.initiated_by` made nullable (system runs), `payout_runs.scheduled_window text`, partial unique index `uq_payout_runs_scheduled_window` (idempotency lock) | ✅ verified (columns + index present) |

Both are idempotent and were applied with `psql -f` against the project's `DATABASE_URL_DIRECT`.

---

## 4. Backend endpoints added / modified

| Endpoint | Service | Change |
|---|---|---|
| `POST /auth/oauth/exchange` | auth-service | **New.** Verifies a Supabase access token (`auth.getUser` with the service-role client), finds-or-creates the platform user (verified, learner role, profile with username-collision fallback, onboarding incomplete), enforces suspension, returns platform access/refresh JWTs. Publishes USER_REGISTERED only for new users. |
| `POST /auth/oauth/google` | auth-service | Modified stub message (points to the real flow). |
| `GET /users/me/subscriptions` | user-service | **New.** Creators the caller follows, with profiles. |
| `GET /users/me/feed` | user-service | **New.** Paginated `course_published` feed items from followed creators. |
| `POST /courses/nodes`, `PATCH /courses/nodes/:id` | course-service | Modified. Accept + validate `video_chapters` (strictly ascending) and `video_subtitles` (vtt/srt, URL); patch rejects malformed payloads with 400. |
| `POST /courses/:id/publish`, `POST /courses/:id/approve` | course-service | Modified. Notify followers (`new_course` notification, republish-safe sentinel, batch capped at 500). |
| `POST /payouts/bulk` | payout-service | Modified. Same request/response contract; logic extracted to the shared runner; returns 409 if a scheduled window was already claimed. |
| `GET /payouts/scheduler/status` | payout-service | **New (admin).** Schedule, current window + processed flag, next window, last scheduled run, mock-mode flag. |
| `POST /payouts/scheduler/run-due` | payout-service | **New (admin).** Runs the current window if due; idempotent; audited. |
| `GET /metrics` | every service (via `createService`) | **New.** Request totals, 4xx/5xx, latency buckets, average latency since process start. |
| `GET /health/details` | every service (via `createService`) | **New.** Status (`ok`/`degraded`), uptime, Supabase/Redis connectivity (configured/ok/latency only), metrics snapshot. |
| `GET /api/ops` | api-gateway | **New (admin-only).** Aggregates every service's `/health/details`; 403 unless the JWT carries the admin role. |

Worker entrypoint (not an HTTP endpoint): `backend/payout-service/src/scheduler-worker.ts`, run with `npm run payout:run-due` from `backend/` (cron-friendly one-shot; exits 0/1).

---

## 5. Frontend pages / components changed

| Page / component | Change |
|---|---|
| `GoogleAuthButton` | Real Supabase OAuth launch; disabled with a friendly note when Supabase isn't configured. Used on login + signup. |
| `/auth/callback` | Waits for the Supabase session, exchanges it for platform JWTs, fetches `/users/me`, sets role view, redirects (onboarding-aware). |
| `FollowButton` | Optimistic follow/unfollow against the `my-subscriptions` cache with rollback; hidden for self/logged-out. |
| `/feed` | Paginated activity feed of followed creators' published courses. Navbar "Feed" link added. |
| `/creators`, `/u/[username]`, `/course/[id]` | Follow buttons + follower count chip. |
| `SecurePdfViewer` | Toolbar (page x/y, prev/next, zoom, fit width), current-page tracking, pages-viewed progress callback, iframe fallback. |
| Learn `Player` | `onPdfProgress` feeds the existing completion channel (≥ 80 % viewed). |
| `VideoNode` | Chapters card (click-to-seek on YouTube; reference list on Drive), Subtitles card (open/download links). |
| `NodeEditor` / `CourseBuilder` | Chapter editor (m:ss + title, ordering warning) and subtitle editor (label/lang/url/format); persisted on course save. |
| `/admin/payouts` | "Scheduled payouts" card: schedule, window status, last/next run, run-due button, mock-mode warning. |
| `/admin/ops` | New ops dashboard: per-service status, uptime, request/error counters, latency distribution, Supabase/Redis connectivity. Navbar "Ops" link added. |
| `/creator/collaborations` | Wrapped in `<Suspense>` (pre-existing `useSearchParams` prerender failure that blocked `next build`). |

---

## 6. Test setup and commands

**Backend** (`backend/vitest.config.ts`)
- Node environment, tests in `backend/tests/**/*.test.ts`.
- Alias `^(\.{1,2}\/.*)\.js$ → $1` so the services' ESM `.js`-suffixed imports resolve to `.ts` sources under Vitest.
- Pure unit tests of validation schemas and business logic — no HTTP servers, no Supabase/Razorpay/Resend, no network. Deterministic.
- Run: `cd backend && npm test` (or `npm run test:watch`).

**Frontend** (`frontend/vitest.config.mts` + `frontend/vitest.setup.ts`)
- jsdom environment, React Testing Library + `@testing-library/jest-dom`, explicit `afterEach(cleanup)`.
- `@` alias → `src`.
- Run: `cd frontend && npm test`.

**Root**
- `npm run test` runs backend then frontend suites.
- `npm run ci` = typecheck (frontend + all backend workspaces) → lint → tests (backend + frontend) → production build.

Current totals: **53 backend tests (7 files) + 13 frontend tests (3 files) — 66 tests, all passing.**

---

## 7. CI workflow details

`.github/workflows/ci.yml` — runs on push to main/master and on pull requests, with per-ref concurrency cancellation. **No secrets are required**: every step works against the dev/mock fallbacks.

- **frontend job** (Node 20, `npm ci` with lockfile cache): `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
- **backend job** (Node 20, `npm ci`): `npm run typecheck` (loops all 14 workspaces, fails fast) → `npm run test`.

The root `npm run ci` script mirrors the workflow locally.

---

## 8. OAuth setup notes

One-time setup to make the Google button live (no code changes needed):

1. **Google Cloud Console** → create an OAuth 2.0 Client ID (Web application).
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase Dashboard → Authentication → Providers → Google**: enable, paste the Client ID + Client Secret.
3. **Supabase Dashboard → Authentication → URL Configuration**: set Site URL to the deployed frontend URL and add `<site-url>/auth/callback` to Additional Redirect URLs (for local dev: `http://localhost:3000/auth/callback`).
4. Env (already wired): frontend needs `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`; auth-service needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. **The Google client secret lives only in the Supabase dashboard — never in this repo or the frontend.**

Flow: `GoogleAuthButton` → `supabase.auth.signInWithOAuth({ provider: "google", redirectTo: <origin>/auth/callback })` → Supabase handles Google → `/auth/callback` waits for the session → `POST /auth/oauth/exchange` with the Supabase access token → backend verifies the token, finds-or-creates the user, rejects suspended accounts, issues platform JWTs → client stores tokens, loads `/users/me`, routes to `/onboarding` (new users) or the role home.

If Supabase env is missing the button renders disabled with an explanatory note instead of failing.

---

## 9. Follow / feed verification

- Follow state is **persisted** in the existing `subscriptions` table; counts come from `creator_stats`.
- `FollowButton` performs optimistic updates with rollback and invalidates subscriber count + feed queries.
- `GET /users/me/feed` returns only **real published courses by creators the caller follows** (no fabricated data); paginated; `/feed` renders skeleton/empty/error states and links to `/creators` when empty.
- Publishing (or admin-approving) a course inserts `new_course` notifications for followers — a sentinel check on the notification href prevents duplicate spam on republish; the batch is capped at 500 followers.
- Verified: backend + frontend typecheck clean; manual flow to exercise once services run: follow a creator on `/creators`, publish one of their courses from a creator account, check the follower's bell + `/feed`.

## 10. PDF / video verification

- PDF: signed URL still minted only by `GET /courses/nodes/:nodeId/pdf-view-url` (auth + enrollment gated, 1 h TTL, refreshed before expiry). The viewer renders to canvas (no text/annotation layers, right-click/drag blocked). Toolbar: page x/y, prev/next (scroll-to-page), zoom 50–250 %, fit width. Loading and error states preserved. If react-pdf or the CDN worker fails, the same signed URL is shown in an `<iframe>` so the lesson keeps working — protected URLs are never bypassed or made public.
- PDF completion: the deepest page whose top entered the reading box is reported as percent-viewed and merged into the existing scroll-percent channel; ≥ 80 % marks the node complete (server-side rule unchanged). Paging with the toolbar counts the same as scrolling.
- Chapters/subtitles are **visible to learners**, not just stored: chapters render under the player and seek the YouTube player on click (Drive embeds expose no seek API, so the list is shown as a reference); subtitle tracks render as open/download links (YouTube/Drive embeds cannot ingest external caption tracks).
- Validation: out-of-order or duplicate chapter timestamps and malformed subtitle entries are rejected with 400 on both create and patch (covered by 11 unit tests).
- Watch tracking is unchanged (verified by reading the diff — the YouTube tick/report logic was not touched).

## 11. Scheduled payout verification

- Schedule source: `platform_settings.payout_schedule` (`manual` default).
- Window keys are UTC (`monthly_1st:YYYY-MM-01`, `monthly_1st_15th:YYYY-MM-01|15`). Pure window logic covered by 8 unit tests (same-window idempotent keys, half-month split, December rollover, manual → null).
- **Cannot double-run**: the run row is inserted with `scheduled_window` *before* any disbursement; the partial unique index makes a second claim for the same window fail (Postgres 23505), and the runner backs off without dispatching. A friendly pre-check also reports "already processed" without attempting the insert.
- `POST /payouts/scheduler/run-due` (admin) and the cron worker (`npm run payout:run-due` in `backend/`) share the same code path; calling either more often than the schedule is a no-op.
- Mock branch: when Razorpay/RazorpayX env is absent, payouts settle instantly through the wallet ledger (existing behaviour), and the admin card + scheduler status surface a clear mock-mode warning.
- Audit: admin-triggered scheduled runs write `payout.scheduled_run` to the immutable audit log; manual bulk keeps `payout.bulk`. Worker runs (no admin) are traceable via `payout_runs.scheduled_window` with `initiated_by NULL`.

## 12. Observability verification

- Request IDs: generated/propagated at the gateway (pre-existing) and echoed in service logs.
- Every service (via shared `createService`) now records request totals, 4xx/5xx counts and latency buckets, and serves `GET /metrics` and `GET /health/details`; the latter probes Supabase (1-row query) and Redis (`PING`) and reports `configured/ok/latencyMs` only.
- Gateway `GET /api/ops` (admin-only, 403 otherwise) aggregates all 12 services + gateway uptime.
- `/admin/ops` shows per-service status chips, uptime, request/error counters, latency distribution bars and dependency chips, refreshing every 30 s.
- No secrets leaked: payloads contain service names, ports, counters, booleans and latency numbers only — no URLs, hostnames, keys or env values. Logging continues to omit bodies/headers/tokens.
- Covered by 4 unit tests (latency bucketing, counter behaviour, snapshot isolation).

---

## 13. Known limitations

1. **OAuth** needs the Google provider enabled in the Supabase dashboard (Section 8); until then the button is disabled by design. Account linking is by email — a Google sign-in with the same email as a password account logs into that account (verified e-mail trust model).
2. **Subtitles** are open/download links, not in-player captions — YouTube/Drive iframes cannot load external tracks. **Chapter seek** works for YouTube only; Drive has no seek API.
3. **PDF iframe fallback** exposes the browser's native viewer (with its download button) — only when the hardened canvas viewer cannot start, and still behind the 1-hour enrollment-gated signed URL. The pdf.js worker loads from cdnjs; fully offline deployments will always use the fallback.
4. **Scheduled payouts**: the worker is a one-shot process that something external (cron, GitHub Action, systemd timer) must invoke — there is no in-process scheduler. Worker-initiated runs are not in `admin_audit_log` (it requires an admin id); they are traceable in `payout_runs`. Windows are computed in UTC, not IST.
5. **Metrics** are in-memory per process: they reset on restart and are not aggregated across replicas; there is no Prometheus exposition format. Per-service `/metrics` and `/health/details` are reachable through the gateway without auth (they contain only counters/booleans); the aggregated `/api/ops` is admin-only.
6. **Tests** are unit/component level. There are no end-to-end tests against a real browser, real Supabase or Razorpay test mode (intentionally, so CI needs no secrets).
7. **Mock mode**: without Razorpay env, payouts settle instantly in the ledger; without Supabase env, services fall back to mock data — useful for dev, but means a misconfigured production env degrades silently to mocks (the `/admin/ops` connectivity chips make this visible).
8. Pre-existing items unchanged: refresh tokens in `localStorage` (CHECKLIST 1.8), course edit-locking is TTL-based single-writer (a lock that expires mid-edit can allow interleaved writes), creator PDF uploads are capped at 25 MB / storage quota via `reserve_storage`.
9. Follower publish notifications are capped at 500 followers per publish and are inserted without realtime fan-out (recipients see them on next bell refresh).

## 14. Exact commands run and pass/fail results

All commands run on 2026-05-23 from the repo root (or the package shown).

| Command | Result |
|---|---|
| `cd frontend && npx tsc --noEmit` | ✅ 0 errors |
| `cd frontend && npm run lint` | ✅ "No ESLint warnings or errors" |
| `cd frontend && npm test` | ✅ 3 files, 13 tests passed |
| `cd frontend && npm run build` | ✅ exit 0 — compiled successfully, 44/44 static pages (after fixing the pre-existing `/creator/collaborations` Suspense issue; the first run failed on that page) |
| `cd backend && npm run typecheck` | ✅ all 14 workspaces (shared, gateway, 12 services + payout) — 0 errors |
| `cd backend && npm test` | ✅ 7 files, 53 tests passed |
| `npm run ci` (repo root) | ✅ typecheck → lint → test → build all green end-to-end (re-run after the Suspense fix) |
| `psql … -f database/migrations/0031_video_chapters_subtitles.sql` / `0032_payout_scheduler.sql` | ✅ applied to the Supabase project; columns + unique index verified via `information_schema` / `pg_indexes` |

## 15. Remaining risks before real launch

1. **Payments/payouts not exercised end-to-end against Razorpay test mode** — webhook delivery (publicly reachable URL + correct `RAZORPAY_WEBHOOK_SECRET`) is required for payment capture and payout settlement; this needs a staging dry run with real test keys.
2. **Single-instance assumptions**: the gateway rate limiter, in-memory metrics and BullMQ-without-Redis fallback all assume one process per service. Horizontal scaling needs Redis (`REDIS_URL`) and an external metrics store.
3. **Email deliverability**: Resend domain/sender verification must be completed or verification/reset/notification emails will not arrive.
4. **Google OAuth consent screen** must be verified/published in Google Cloud for non-test users.
5. **Operational hygiene**: confirm Supabase backups/PITR, set `JWT_SECRET` to a strong value everywhere, rotate any keys that were used during development, and double-check bucket privacy (node-pdfs, certificates remain private).
6. **Load**: no load testing has been done; the latency buckets in `/admin/ops` give a per-service signal but catalog/search hot paths should be load-tested with realistic data volumes.
7. **Edit-lock expiry race** on collaborative course editing (TTL-based) can interleave writes if a lock expires while an editor is still typing — acceptable for MVP, document for creators.
8. **Storage quota race**: `reserve_storage` + storage triggers should be exercised under concurrent uploads in staging.
9. **Scheduled payouts in production** require the cron entry for `npm run payout:run-due` (or reliance on an admin clicking "Run due payouts now"); without either, automatic schedules silently do nothing.
10. **Mock fallbacks can mask outages**: if Supabase credentials are wrong in production the services keep serving mock data instead of failing loudly — watch the Supabase connectivity chip on `/admin/ops` after every deploy.
