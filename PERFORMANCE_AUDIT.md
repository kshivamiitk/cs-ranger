# CS-Ranger — API Fetch Performance Audit

**Date:** 2026-05-21
**Scope:** Reduce API fetch latency across the app — fewer round trips, no request
waterfalls, no duplicate profile fetching, less over-fetching, lighter backend
payloads, better request caching/deduplication — without rewriting the product.

This document records what was found, what was changed, why each change reduces
API fetch time, how to verify it locally, and what's left.

---

## 0. Method

The repository was inspected before any edits: the api-gateway, all 13 backend
services, the shared utilities (`withDb`, `createService`, logger, auth middleware),
the React Query provider, the auth/profile bootstrap, the axios client, and every
hot-path page (home, catalog, search, course detail, player, creator overview/courses,
achievements, report-cards, profile/edit). The DB migrations were read to confirm
whether the "hot-path indexes" claim is real.

**What was already good (verified, not assumed):**

- `database/migrations/0011_performance_indexes.sql` genuinely covers the hot paths
  (catalog sort/filter, module→node, per-learner enrollment, comments, unread
  notifications), plus a GIN `search_vector` index and a `pg_trgm` index on
  `courses.title` from `0003_courses.sql`. **Indexes are real and appropriate — left as-is.**
- `analytics-service` has a real, used in-memory cache (5-min TTL) and uses
  `head`/`count` queries and `Promise.all`. **Left as-is.**
- `enrollment-service` list and `/:courseId/progress` already use explicit-column
  selects and `Promise.all`. **Left as-is.**

So the slowness is concentrated in the **frontend** (waterfalls, duplicate fetches,
no debounce/cancel, over-fetching) and a **few backend over-fetches / N+1s**.

---

## 1. Top API-slowness problems found

| # | Problem | Where | Impact |
|---|---------|-------|--------|
| 1 | **Duplicate `/users/me`** — bootstrap loads the profile into context (plain fetch, no cache); `/profile/edit` re-fetches it via React Query `["me"]`. Two sources of truth, two network calls. | `app/providers.tsx`, `app/profile/edit/page.tsx` | Extra `/users/me` per profile visit |
| 2 | **No debounce / no cancellation on search** — `SearchBar` autocomplete and `catalog` search fire one request *per keystroke*, none cancelled. | `components/common/SearchBar.tsx`, `app/catalog/page.tsx` | ~1 request per character typed |
| 3 | **Course detail over-fetch + data leak** — `/:id/detail` returned **full node bodies** (markdown, static-site HTML, video URLs, **quiz `correctIndex` answers**) to the *public* course page, which only renders the curriculum outline. | `course-service GET /:id/detail`, `app/course/[id]/page.tsx` | Large payload on a public page; quiz answers exposed |
| 4 | **Creator pages over-fetch + correctness bug** — `creator/overview` & `creator/courses` fetched the **entire published catalog** and filtered by `creator_id` on the client. Because the backend forces `status=published`, a creator's **drafts/under-review courses never appeared**. | `app/creator/overview/page.tsx`, `app/creator/courses/page.tsx`, `course-service GET /` | Whole-catalog fetch + missing courses |
| 5 | **Learner dashboard: 3 calls + dead widgets** — home fired 3 separate achievement-service calls (streak/heatmap/badges), and they were gated on `user?.id` which is `undefined` (the profile is keyed on `user_id`), so those widgets silently never loaded. | `app/home/page.tsx` | 3 round trips that didn't even render |
| 6 | **No request-timing visibility** — gateway and services set `req.startTime` but nothing ever logged a duration. | `api-gateway`, `shared/utils/server.ts` | Can't see which endpoint is slow |
| 7 | **`user-service /me` sequential queries** — profile then roles, awaited one after the other, on the hottest endpoint (every app load). | `user-service GET /me` | 2 serial DB round trips |
| 8 | **Notification preferences sequential upserts in a loop** | `notification-service PUT /preferences` | N round trips for N prefs |
| 9 | **`COMMENT_CREATED` N+1** — node → module → course as 3 serial queries. | `notification-service` consumer | 3 serial round trips per comment event |
| 10 | **`courses GET /` `select("*")`** — drags `description`, `tags`, `search_vector`, `promo_video_url` over the wire for card lists. | `course-service GET /` | Heavier list payloads |
| 11 | **`mark all read` invalidated the entire React Query cache** | `components/common/NotificationBell.tsx` | Refetches every active query app-wide |

A separate **pre-existing build blocker** was found and fixed (see §5): `login/page.tsx`
exported `Field`/`GoogleIcon`, which the other auth pages imported — Next.js forbids
arbitrary named exports from page files, so `next build` failed before any of this work
could be verified.

---

## 2. Implemented fixes (before → after)

### 2.1 Auth / profile / session — kill the duplicate `/users/me`
- **New** `frontend/src/lib/queries.ts` → `meQueryOptions` (`["me"]`, `staleTime: 5min`).
- `providers.tsx` now bootstraps via `queryClient.fetchQuery(meQueryOptions)` instead of a
  bare `api.users.me()`, so the profile lands in the **shared `["me"]` cache**.
- `profile/edit/page.tsx` uses `useQuery(meQueryOptions)` → **cache hit, no second fetch**;
  on save it updates both the cache and the app context (`setUser`) so the navbar/avatar
  reflect changes with **zero extra round trips**.
- **Backend** `user-service GET /me`: profile + roles now run in **`Promise.all`** (was
  sequential) → one round-trip latency instead of two on every app load.

### 2.2 Course catalog / search — debounce + cancel
- **New** `frontend/src/lib/hooks.ts` → `useDebouncedValue` (no new dependency).
- `SearchBar` autocomplete: debounced 250ms + **AbortSignal** threaded through
  `api.search.autocomplete(q, signal)`; React Query cancels the in-flight request when the
  term changes. Was: one request per keystroke, none cancelled.
- `catalog`: search box debounced 350ms; `api.search.courses(params, signal)` cancels
  superseded requests; `placeholderData: (prev) => prev` keeps results on screen during
  refetch (no skeleton flash on every filter change). Categories cached 1h (`staleTime`).

### 2.3 Course detail vs. player — split outline from full content
- **Backend** `course-service GET /:id/detail`: modules now select an **outline only** —
  `nodes(id, type, title, position, duration_seconds, is_free_preview)` — instead of
  `nodes(*)`. This removes lesson bodies (markdown / static_website / video_url) **and the
  quiz answers (`quiz_payload.correctIndex`)** from this unauthenticated response.
- **Frontend** player route (`course/[id]/learn/[nodeId]/page.tsx`) now fetches full lesson
  content via `api.courses.get(id)` (`GET /:id`) under a distinct `["course-content", id]`
  cache key. The public detail page stays light; the player gets exactly the bodies it needs.
  *(The player's behavior is unchanged — it already loaded full content; it just no longer
  shares a cache entry with the lightweight public page.)*

### 2.4 Learner dashboard
- **New backend** `achievement-service GET /:userId/summary` → `{ streak, badges:{earned,locked},
  heatmap }` in **one** `Promise.all` round trip (head/count queries for badge totals).
- `home/page.tsx`: 3 calls (streak + heatmap + badges) collapsed to **1** (`summary`);
  fixed the `user?.id` → `user?.user_id` bug so the widgets actually render; added stable
  **skeletons** for "Continue learning" and "Recommended" so the dashboard paints
  progressively instead of popping in. Enrollments cache key aligned with `my-courses`
  (`["my-enrollments", userId]`) so the two pages **share one fetch**.

### 2.5 Creator overview / dashboard
- **New backend** `course-service GET /mine` (`requireAuth`, scoped to `creator_id`, **all
  statuses**, summary columns).
- `creator/overview` & `creator/courses` now call `api.courses.mine()` under a shared
  `["creator-courses", creatorId]` key. This **removes the whole-catalog over-fetch + the
  client-side filter** and **fixes the bug** where drafts/under-review courses were invisible.

### 2.6 Notifications
- **Duplicate fetch removed:** the navbar bell fetched `api.notifications.list(1)` under
  `["notifications-recent"]` while the `/notifications` page fetched the **same** `list(1)` under
  `["notifications", 1]`. Both now use `["notifications", 1]` → one shared fetch instead of two.
- `NotificationBell`: `staleTime: 30s` on both the unread-count (still polled every 60s, but
  a focus/route-change inside 30s reuses cache) and the recent list (only fetched on open,
  fresh for 30s).
- **Cache-nuke removed:** the `/notifications` page's "mark all read" called
  `qc.invalidateQueries()` with **no args**, invalidating *every* active query app-wide. Both the
  bell and the page now invalidate only `["unread-count"]` + `["notifications"]`.
- **Backend** `PUT /preferences`: single **batched upsert** instead of a per-row loop.
- **Backend** `COMMENT_CREATED` consumer: node→module→course collapsed into **one nested
  read** instead of three serial queries.

### 2.6b Creators directory
- `app/creators/page.tsx` had an **un-debounced** search box feeding the query key directly —
  one `api.search.creators()` request per keystroke. Now debounced 300ms with an `AbortSignal`
  (cancels stale requests) and `placeholderData` (no list flicker), matching the catalog/navbar.

### 2.7 Backend query efficiency
- `course-service GET /` now selects `COURSE_SUMMARY_COLS` (explicit list columns) instead of
  `select("*")`. The same constant is reused by `GET /mine` (DRY).

### 2.8 Instrumentation (so improvements are measurable)
- **Gateway** logs one line per request on `res.finish`:
  `{ method, path, status, durationMs, requestId, userId, slow }`. No bodies, tokens, headers,
  or query strings are logged.
  - **Path is captured at request start** (before `http-proxy-middleware` rewrites `req.url`), so
    the gateway logs the real incoming path (`/api/courses/categories`) rather than the rewritten
    `/categories`. `req.path` already excludes the query string.
  - **`/health` is skipped** to avoid load-balancer/liveness-probe log spam.
- **Every service** (via `shared/utils/server.ts`) logs the same shape for in-service handler
  time, so service time can be isolated from gateway/proxy overhead via the shared `requestId`.
  Also captures path up-front and skips `/health`.
- **Frontend** axios client logs `[api] METHOD url → status Nms` in **development only**
  (`NODE_ENV !== "production"`), `console.warn` over 500ms. Never logs bodies/tokens/data.

**Production-safety verified** by smoke test: a request to `/api/auth/reset-password?token=SECRET123`
logged `path:"/api/auth/reset-password"` with the token string appearing **0 times** in the logs;
`/health` produced **0** request-log lines; and one `requestId` correlated the gateway line
(6.7ms total) with the service line (1.1ms), exposing ~5.6ms of proxy overhead.

---

## 3. Files changed

**Frontend**
- `frontend/src/lib/api.ts` — dev timing interceptor; `AbortSignal` on `search.*`;
  `courses.mine()`; `achievements.summary()`.
- `frontend/src/lib/queries.ts` *(new)* — shared `meQueryOptions`.
- `frontend/src/lib/hooks.ts` *(new)* — `useDebouncedValue`.
- `frontend/src/app/providers.tsx` — prime `["me"]` cache at bootstrap.
- `frontend/src/app/profile/edit/page.tsx` — reuse `["me"]`; sync context on save.
- `frontend/src/components/common/SearchBar.tsx` — debounce + signal.
- `frontend/src/app/catalog/page.tsx` — debounce + signal + `placeholderData` + category cache.
- `frontend/src/app/course/[id]/learn/[nodeId]/page.tsx` — full-content endpoint + new cache key.
- `frontend/src/app/home/page.tsx` — aggregated summary, `user_id` fix, skeletons.
- `frontend/src/app/my-courses/page.tsx` — shared enrollment cache key.
- `frontend/src/app/creator/overview/page.tsx` — `courses.mine()`, drop client filter.
- `frontend/src/app/creator/courses/page.tsx` — `courses.mine()`, drop client filter.
- `frontend/src/components/common/NotificationBell.tsx` — staleTime + scoped invalidation + unified `["notifications",1]` key.
- `frontend/src/app/notifications/page.tsx` — shared notification cache key + scoped invalidation (was nuke-all).
- `frontend/src/app/creators/page.tsx` — debounced search + AbortSignal + placeholderData.
- `frontend/src/components/common/Navbar.tsx` — fix 3 pre-existing `user.roles` type errors.
- `frontend/src/components/auth/AuthFields.tsx` *(new)* — extracted `Field`/`GoogleIcon`.
- `frontend/src/app/(auth)/login|signup|forgot-password|reset-password/page.tsx` — import from
  the new shared module (unblocks `next build`).

**Backend**
- `backend/api-gateway/src/index.ts` — request timing log.
- `backend/shared/utils/server.ts` — per-service request timing log.
- `backend/course-service/src/index.ts` — `COURSE_SUMMARY_COLS`; `GET /mine`; trimmed
  `/:id/detail` node columns; trimmed `GET /`.
- `backend/user-service/src/index.ts` — `/me` profile+roles in parallel.
- `backend/notification-service/src/index.ts` — batched preferences upsert; collapsed
  `COMMENT_CREATED` N+1.
- `backend/achievement-service/src/index.ts` — `GET /:userId/summary`.

---

## 4. Why these reduce API fetch time

- **Fewer round trips, in parallel:** home went 3 achievement calls → 1; `/me` two serial DB
  queries → one parallel pair; `COMMENT_CREATED` 3 serial reads → 1; preferences N upserts → 1.
- **Deduplication:** `["me"]` is fetched once and reused (bootstrap + profile/edit);
  enrollments share one cache key across home and my-courses; creator pages share
  `["creator-courses", id]`.
- **Cancellation + debounce:** typing in search now fires ~1 request per pause instead of one
  per character, and superseded requests are aborted — the network isn't saturated with
  responses nobody will read.
- **Smaller payloads:** the public course page no longer ships every lesson body + quiz answer;
  list endpoints ship summary columns, not `select("*")`.
- **Right-sized caching:** stable data (profile 5min, categories 1h, notifications 30s) stops
  refetching on every mount/focus; `mark all read` no longer nukes the whole cache.

---

## 5. Verification — commands and results

> Backend services have **no `build`/`typecheck`/`test` npm script** (they run via
> `tsx watch`, which transpiles without type-checking). There is also **no committed ESLint
> config**, so `npm run lint` (`next lint`) is interactive and cannot run non-interactively —
> this is pre-existing. Local backend runs use the **mock-data fallback** because Supabase/Redis
> aren't configured here (`withDb` returns mock data; `publish/consume` are no-ops). All of this
> is reported honestly below.

### Frontend
```
cd frontend
npx tsc --noEmit        # PASS — 0 errors (also fixed 3 pre-existing Navbar errors)
npm run build           # PASS — "Compiled successfully", all 36 routes built,
                        #        types validated during build
npm run lint            # NOT RUNNABLE — no committed ESLint config; next lint prompts
                        #        interactively. Build's internal lint step passed.
```
The first `npm run build` **failed** on a **pre-existing** issue unrelated to this work:
`(auth)/login/page.tsx` exported `Field`/`GoogleIcon`, imported by 3 other auth pages — Next.js
forbids arbitrary named exports from page files. Fixed by extracting them to
`components/auth/AuthFields.tsx` (markup identical). Build then passed.

### Backend (per-workspace `tsc --noEmit`, compared to baseline before changes)
```
cd backend
npx tsc --noEmit -p <service>/tsconfig.json
```
| service | baseline errors | after |
|---|---|---|
| shared | 0 | 0 |
| api-gateway | 0 | 0 |
| course-service | 1 | 1 |
| user-service | 3 | 3 |
| notification-service | 2 | 2 |
| achievement-service | 6 | 6 |
| enrollment-service | 0 | 0 |
| analytics-service | 0 | 0 |
| search-service | 2 | 2 |

**No regressions.** The pre-existing errors are all the same class: `withDb<T>(fn, fallback)`
infers `T` from the camelCase mock-data fallback, which doesn't structurally match the
snake_case Supabase row shape. They are type-only (runtime is correct; `tsx` ignores them).
The two new errors my explicit-column selects introduced in `course-service` were resolved
with an explicit `as unknown as Course[]` cast (documented inline), keeping it at baseline `1`.

### Runtime smoke test — instrumentation (gateway on a free port, mock fallback)
```
PORT_COURSE=4003 npx tsx course-service/src/index.ts &
PORT_GATEWAY=4100 npx tsx api-gateway/src/index.ts &
curl -s http://localhost:4100/health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4100/api/courses/categories   # 200
```
Observed logs (same `requestId` correlates gateway ↔ service):
```
api-gateway  msg=request method=GET path=/categories status=200 durationMs=5.5  requestId=571f6ad1…
course-svc   msg=request method=GET path=/categories status=200 durationMs=0.5  requestId=571f6ad1…
```
This confirms: gateway timing log works, per-service timing log works, correlation id flows
end-to-end, and the gateway proxy + pathRewrite work. (A **pre-existing, unrelated** server was
already squatting on `:4000` during testing — that's why the first attempt on `:4000` returned a
404 with helmet headers; re-running on `:4100` was clean.)

---

## 6. How to inspect slow endpoints locally

1. **Backend:** run the stack (`cd backend && npm run dev`). Every request prints a JSON line:
   `{"msg":"request","method":"GET","path":"…","status":200,"durationMs":N,"requestId":"…"}`.
   - Gateway lines show **total** time (proxy + service). Service lines show **service-only**
     time. Subtract to find proxy overhead, or grep one `requestId` across both.
   - Find slow calls: `npm run dev 2>&1 | grep '"slow":true'` (gateway > 500ms, service > 200ms).
2. **Frontend:** in dev, open the browser console and watch `[api] METHOD url → status Nms`
   lines; anything > 500ms is a `console.warn`. Use the Network panel's waterfall to confirm
   calls now fan out in parallel rather than chaining.

---

## 7. Remaining bottlenecks / follow-ups (not done, with rationale)

- **`GET /:id` (player content) is not enrollment-gated.** It returns full lesson bodies +
  quiz answers to any authenticated user. This is **pre-existing** (the old `/detail` leaked the
  same data to the *public*; that part is now fixed). Proper fix: gate `/:id` behind an
  enrollment/preview check (cross-service call or a claim), which is a security task beyond this
  performance pass. **Highest-value follow-up.**
- **`admin/courses` & `admin/overview` review queue** call `api.courses.list()`, which only
  returns `status=published` — so the "under review" queue is effectively empty. Pre-existing
  correctness bug; left untouched to avoid scope creep. Fix: an admin-scoped status filter on
  `GET /` (or a dedicated admin endpoint).
- **Catalog cards show "Creator" instead of the real name.** `search-service /courses` selects
  `creator_id` but not the joined profile, so `CourseCard` falls back to a placeholder. A small
  `profiles(display_name, avatar_url)` embed would fix it at minimal cost — deferred because it
  slightly increases the list payload and is a display bug, not a latency one.
- **`enrollment-service /:courseId/progress`** returns *all* of a learner's completed node ids
  (not scoped to the course). Fine for typical learners; could be scoped via a join if a power
  user accumulates thousands of completions.
- **Backend lacks a `typecheck`/`test` script and a committed ESLint config.** Adding
  `"typecheck": "tsc --noEmit"` per workspace (and cleaning up the 25 `withDb` type-fictions)
  would let CI catch type drift. Out of scope for a perf pass.
- **Notification combined endpoint:** a `/summary` (count + recent) was considered but **not**
  adopted — the count is polled every 60s while the list is only needed on open, so combining
  would *increase* bytes on the common (closed-bell) path. Splitting + `staleTime` is the better
  trade-off here.
