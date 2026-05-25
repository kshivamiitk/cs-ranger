# Learner Completion Engine, Certificates, Realtime & Creator Ops — Verification Guide

How to verify the learner completion engine, certificate PDF generation, realtime notifications, creator analytics dashboard, creator doubts inbox, and the creator annual (TDS) statement.

---

## 1. Feature summary

| Area | What was built |
|---|---|
| Completion engine | Per-node-type completion policy (80% scroll for markdown/PDF, 80% watch for video, quiz pass only for quizzes, manual for static sites), idempotent `POST /enrollments/progress/:nodeId` with validated metadata (`scroll_percent`, `watch_seconds`, `duration_seconds`, `completed_by_rule`, `quiz_attempt_id`), course progress recomputed from the course's actual node set, course completion stamped exactly once and notified. |
| Player | Real scroll + YouTube IFrame watch tracking (Drive dwell-time fallback), 5-second auto-advance with cancel, policy-aware Mark-as-Done with loading/error states, optimistic lesson bookmarks with rollback, timestamped notes tab with seek, quiz review mode, course-completion + certificate claim moment. |
| Certificates | Idempotent claim, `GET /certificates/mine`, ownership-gated PDF download (pdf-lib), Supabase Storage upload when configured + on-the-fly fallback, public verify endpoint unchanged, certificate notification. |
| Realtime notifications | Supabase Realtime broadcast (`user:<id>:notifications`) sent on every notification insert; client hook invalidates + refetches via the API (dedup-free); 60s polling remains the fallback. Bell + notifications page get mark-single-read and read/unread filter. |
| Creator analytics | `GET /analytics/creator/:id/dashboard?range=7d|30d|90d|all` (revenue/enrollment trends, completion + quiz pass rates, top courses, recent activity, 5-min cache) + new `/creator/analytics` page; ownership checks added to creator analytics endpoints. |
| Doubts inbox | Filterable/paginated inbox endpoint (course/status/search/date), reply + resolve/reopen with course-editor authorization, learner notifications on reply/resolve/reopen, new list/detail inbox UI with reply box. |
| Annual statement | `GET /payouts/statements/annual` (+ `/download?format=pdf|csv`) built from `wallet_ledger`/`payout_items`/`tds_records`, FY (Apr–Mar) month breakdown, finance-page section with FY selector and downloads. |
| Markdown | highlight.js code blocks + DOMPurify sanitisation added to the existing KaTeX renderer. |

## 2. Files changed

**New backend** — `backend/shared/pdf.ts`, `backend/shared/realtime.ts`, `backend/enrollment-service/src/completion.ts`
**Modified backend** — `backend/shared/index.ts`, `backend/shared/package.json` (pdf-lib), `backend/enrollment-service/src/index.ts`, `backend/achievement-service/src/index.ts`, `backend/course-service/src/index.ts`, `backend/notification-service/src/index.ts`, `backend/analytics-service/src/index.ts`, `backend/payout-service/src/index.ts`
**New frontend** — `frontend/src/app/course/[id]/learn/[nodeId]/{VideoNode,QuizPanel,NotesTab,CourseCompletionModal}.tsx`, `frontend/src/app/creator/analytics/page.tsx`
**Modified frontend** — `frontend/src/lib/{api.ts,hooks.ts,utils.ts}`, `frontend/src/components/common/{MarkdownView.tsx,NotificationBell.tsx,Navbar.tsx}`, `frontend/src/app/course/[id]/learn/[nodeId]/Player.tsx`, `frontend/src/app/{notifications,achievements}/page.tsx`, `frontend/src/app/creator/{doubts,finance}/page.tsx`, `frontend/src/app/{page.tsx,search/page.tsx}` (pre-existing typecheck fixes), `frontend/package.json` (highlight.js, dompurify)
**Docs** — `CHECKLIST.md` (status rows), this file.

## 3. Migrations added

`database/migrations/0027_completion_engine.sql` (idempotent, safe to re-run):
- `node_progress`: `scroll_percent`, `watch_seconds`, `duration_seconds`, `completed_by_rule`, `quiz_attempt_id`
- `quiz_attempts.passed`
- private `certificates` storage bucket
- guarded `alter publication supabase_realtime add table notifications`

Apply with `cd database && ./apply.sh "$DATABASE_URL"`.

## 4. Backend endpoints added / modified

| Service | Endpoint | Change |
|---|---|---|
| enrollment-service | `POST /progress/:nodeId` | **New** — unified, idempotent progress update (Zod-validated; rejects scroll > 100, negative watch time, unknown keys) |
| enrollment-service | `POST /progress/:nodeId/complete` | Modified — routed through the completion policy (quiz nodes rejected with `QUIZ_PASS_REQUIRED`), recomputes course progress |
| enrollment-service | `POST /quiz/:nodeId/attempt` | Modified — stores `passed` + attempt id, completes node on pass, returns course progress |
| enrollment-service | `GET /quiz/:nodeId/attempts` | **New** — read-only attempt history for review mode |
| achievement-service | `POST /certificates/claim` | **New** — idempotent issue + PDF + notification |
| achievement-service | `GET /certificates/mine` | **New** |
| achievement-service | `GET /certificates/:id/download` | Modified — streams the real PDF, ownership-gated |
| course-service | `GET /doubts/inbox` | Modified — courseId/status/q/date filters, pagination, open/resolved counts in meta |
| course-service | `POST /nodes/:nodeId/comments` | Modified — reply path notifies the parent author (`doubt_reply`) + realtime broadcast |
| course-service | `POST /comments/:id/resolve` | Modified — course-editor authorization + learner notification |
| course-service | `POST /comments/:id/reopen` | **New** |
| notification-service | (createNotif) | Modified — realtime broadcast after every insert |
| analytics-service | `GET /creator/:id/dashboard?range=` | **New** — cached creator dashboard aggregate |
| analytics-service | `GET /creator/:id/overview`, `GET /creator/:id/courses/:courseId` | Modified — self-or-admin ownership check |
| payout-service | `GET /statements/annual`, `GET /statements/annual/download?format=pdf|csv` | **New** — FY statement JSON + PDF/CSV |

## 5. Frontend pages / components changed

- Player (`/course/[id]/learn/[nodeId]`): completion engine, auto-advance banner, notes tab, quiz review, completion/certificate modal, optimistic bookmarks. New sub-components `VideoNode`, `QuizPanel`, `NotesTab`, `CourseCompletionModal`.
- `/notifications`: read/unread filter, mark-single-read; bell: realtime hook + mark-read on click.
- `/achievements`: real certificates section (download + verify + count).
- `/creator/analytics` (new) + nav link; `/creator/doubts` rebuilt as list/detail inbox; `/creator/finance` annual-statement section.
- `lib/api.ts` (typed `enrollments.updateProgress`, `quizAttempts`, `achievements.myCertificates/claim/download`, `analytics.creatorDashboard`, `payouts.annualStatement(+download)`, paginated `courses.doubtsInbox`, `reopenComment`, blob helper), `lib/hooks.ts` (`useRealtimeNotifications`), `lib/utils.ts` (`saveBlob`), `MarkdownView` (highlight.js + DOMPurify).

## 6. Automated commands run and results

| Command | Result |
|---|---|
| `cd frontend && npm run typecheck` | ✅ **0 errors** (the 8 pre-existing `CreatorListing` errors in `app/page.tsx` / `app/search/page.tsx` were fixed as part of this work) |
| `cd frontend && npm run build` | ✅ passes (exit 0) |
| `cd frontend && npm run lint` | ⚠️ Not runnable — repo has no ESLint config; `next lint` halts at its interactive setup prompt (unchanged from before) |
| `cd backend && npx tsc --noEmit -p <svc>/tsconfig.json` | ✅ clean: `shared`, `enrollment-service`, `achievement-service`, `notification-service`, `analytics-service`, `payout-service`. ❌ `course-service`: 27 **pre-existing** strict-mode errors (Express-5 `req.params` unions and `withDb` mock-fallback inference in course CRUD/collaboration/lock/storage handlers, e.g. lines 222, 311–528, 1071–1248) — none are in the doubts/comments code touched here; the service runs via `tsx` and has never had a typecheck script. Untouched services keep their previously documented pre-existing errors (user-service 3, wallet-service 2, payment-service 1, auth-service 1). |
| Tests | No test framework exists in the repo — manual verification below. |

## 7. Manual API verification (curl)

Backend running (`cd backend && npm run dev`); impersonate users with dev headers. `$LEARNER`, `$CREATOR`, `$NODE`, `$COURSE` are real ids from your DB/seed.

```bash
L='-H "x-user-id: <learner-id>" -H "x-user-role: learner" -H "Content-Type: application/json"'
C='-H "x-user-id: <creator-id>" -H "x-user-role: creator" -H "x-user-roles: creator,learner" -H "Content-Type: application/json"'

# Completion engine — idempotent, per-type rules
eval curl -s -X POST $L -d "'{\"scrollPercent\":85}'" http://localhost:4000/api/enrollments/progress/$NODE | jq
# repeat the same call → completed stays true, newlyCompleted=false (no double-counting)
eval curl -s -X POST $L -d "'{\"scrollPercent\":120}'" http://localhost:4000/api/enrollments/progress/$NODE | jq .error   # → VALIDATION
eval curl -s -X POST $L http://localhost:4000/api/enrollments/progress/<quiz-node>/complete | jq .error                    # → QUIZ_PASS_REQUIRED
eval curl -s $L http://localhost:4000/api/enrollments/quiz/<quiz-node>/attempts | jq

# Certificates (after the course shows courseCompleted=true)
eval curl -s -X POST $L -d "'{\"courseId\":\"$COURSE\"}'" http://localhost:4000/api/achievements/certificates/claim | jq
# claiming again → alreadyIssued=true, same certificate id
eval curl -s $L http://localhost:4000/api/achievements/certificates/mine | jq
eval curl -s $L -o /tmp/cert.pdf http://localhost:4000/api/achievements/certificates/<cert-id>/download && file /tmp/cert.pdf   # → PDF document

# Doubts inbox + reply/resolve/reopen
eval curl -s $C "'http://localhost:4000/api/courses/doubts/inbox?status=open&q=recursion&page=1&pageSize=10'" | jq
eval curl -s -X POST $C -d "'{\"body\":\"Answered — see step 3\",\"parentId\":\"<doubt-id>\"}'" http://localhost:4000/api/courses/nodes/$NODE/comments | jq
eval curl -s -X POST $C http://localhost:4000/api/courses/comments/<doubt-id>/resolve | jq
eval curl -s -X POST $C http://localhost:4000/api/courses/comments/<doubt-id>/reopen | jq
# learner now has doubt_reply / doubt_resolved notifications:
eval curl -s $L http://localhost:4000/api/notifications/ | jq '.data[0]'

# Creator dashboard (ownership enforced)
eval curl -s $C "'http://localhost:4000/api/analytics/creator/<creator-id>/dashboard?range=30d'" | jq .data.kpis
eval curl -s $L "'http://localhost:4000/api/analytics/creator/<creator-id>/dashboard'" | jq .error    # → FORBIDDEN

# Annual statement
eval curl -s $C "'http://localhost:4000/api/payouts/statements/annual?fy=2025-26'" | jq
eval curl -s $C -o /tmp/stmt.pdf "'http://localhost:4000/api/payouts/statements/annual/download?fy=2025-26&format=pdf'" && file /tmp/stmt.pdf
```

## 8. Manual UI verification steps

1. **Player** — open an enrolled course at `/course/<id>/learn/<nodeId>`:
   - Markdown/PDF lesson: scroll past 80% → "Completed" chip appears and the auto-advance banner counts down from 5s; Cancel stops it; sidebar tick + percentage update without a reload.
   - YouTube lesson: play past 80% (or to the end) → completion + auto-advance; reload resumes near the saved position.
   - Quiz: failing score does **not** complete the lesson; passing does; "Previous attempts" lists each try and opens a read-only review with correct answers/explanations.
   - Notes tab: add a note with "attach current time", click its timestamp chip → video seeks.
   - Bookmark toggles instantly and shows up on `/bookmarks`.
2. **Completion + certificate** — finish the last lesson → completion modal appears; Claim certificate → Download PDF opens a real certificate; `/achievements` lists it; the verify link resolves publicly.
3. **Notifications** — with Supabase configured, reply to a learner's doubt from the creator inbox: the learner's bell count updates within ~1s without refresh; without Supabase, it updates on the next poll. Mark-single/all read updates the count.
4. **Creator analytics** — `/creator/analytics`: switch 7d/30d/90d/all and watch KPIs/charts/table refetch; a creator with no courses sees the empty state.
5. **Doubts inbox** — `/creator/doubts`: filter by course/status/search, open a doubt, reply (appears in the learner's lesson Q&A thread), resolve, reopen.
6. **Finance** — `/creator/finance`: pick a financial year, check the summary numbers against the ledger, download PDF and CSV.

## 9. Known limitations

- **Video chapters / subtitles (Part 1.9)**: not implemented — the `nodes` schema and course builder have no chapters/subtitles fields, so there is nothing to render; adding them requires builder + schema work that is out of scope here.
- Drive-embedded videos can't expose playback data: watch progress is a visible-tab dwell-time estimate; Mark-as-Done remains the reliable path.
- Streak/badge evaluation on `NODE_COMPLETED` still runs through the Redis event consumer only (pre-existing behaviour); without Redis, streaks don't advance.
- The doubts inbox lists courses the creator **owns**; accepted collaborators answer from the lesson page (reply/resolve authorization does honour collaborators).
- The realtime channel is a public broadcast topic per user id used purely as a refetch hint; payloads carry no notification content. Deployments wanting private channels need Supabase Auth sessions on the client.
- `course-service` retains 27 pre-existing typecheck errors outside the touched code (see §6); other untouched services keep their previously documented errors.

## 10. Local/dev fallback behaviour

- **No Supabase**: progress endpoints return mock-shaped success, certificates claim returns `503 DB_REQUIRED`, statements/dashboard return zeroed structures — nothing crashes.
- **No Supabase Storage**: certificate PDFs are generated on the fly for every download; `pdf_url` simply stays null.
- **No Redis**: course-completed, doubt, doubt-reply, resolve and certificate notifications are written synchronously by the owning service, so flows work end-to-end without the event bus.
- **No Supabase Realtime / env keys**: `useRealtimeNotifications` is a no-op and the existing 60s polling drives the bell.
- **PDF generation** is pure pdf-lib (no network/native deps) and works identically offline.

## 11. Security & authorization notes

- Progress, notes, quiz attempts and bookmarks are always scoped to `req.user.id`; metadata is Zod-validated (scroll 0–100, non-negative bounded watch times, `.strict()` bodies).
- Certificate download requires ownership (learner or admin); the public verify endpoint exposes only learner display name/username, course title, issue date and token.
- Annual statements are self-or-admin only; creator dashboard/per-course analytics now enforce self-or-admin.
- Resolve/reopen requires course owner / accepted collaborator / admin (`courseEditorRole`).
- Markdown rendering is sanitised with DOMPurify in the browser; KaTeX/highlight markup survives the default allow-list.
- Realtime broadcasts contain only `{type, ids}` hints — never notification bodies — and the service key is used server-side only; no secrets are logged or sent to the client.
