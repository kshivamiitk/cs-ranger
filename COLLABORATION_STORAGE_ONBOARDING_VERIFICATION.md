# Collaboration, Storage, Onboarding & Hardening — Verification Guide

Wave-3 verification: course collaboration / edit locking gap-fill, the Supabase Storage upload pipeline, creator T&C enforcement, 4-step onboarding, catalog filter polish, linked refund tickets, settings mutations, and content moderation.

---

## 1. Feature summary

| Area | What was delivered |
|---|---|
| Collaboration + locking (Part 1) | Already implemented end-to-end before this wave (migration 0021 enums/tables/RLS/`acquire_course_lock`/`course_editors`, collaborator + lock endpoints, `assertCanWriteCourse` on every course write path, CourseBuilder lock lifecycle with heartbeat/poll/sendBeacon, collaborator panel with creator search, collaborations page). This wave filled the gaps: realtime broadcasts on all collaboration notifications, owner notification when a collaborator leaves (`collab_left`), admin-initiated invites/removals audited (`collaborator.invited` / `collaborator.removed`), `holderId` added to the structured 423 lock error, pending-invite badge on the creator nav. |
| Storage pipeline (Part 2) | `shared/storage.ts` (MIME/size validation, path normalisation, Supabase upload/delete/signed URL, `.local-uploads/` dev fallback), migration 0028 (`avatars`, `course-assets`, `node-attachments` buckets + `uploaded_assets` metadata + RLS), multipart endpoints for avatar / course thumbnail / node attachment + attachment list/delete, reusable `FileUpload` component wired into profile editor, onboarding, CourseBuilder thumbnail, NodeEditor attachments, and a real player Resources tab. Lesson PDFs keep the existing signed-upload-URL + quota flow; certificates already use their bucket. |
| Creator T&C (Part 3) | `GET /users/me/creator-terms-status`; publish + submit-for-review blocked server-side with structured `TERMS_ACCEPTANCE_REQUIRED` (currentVersion / acceptedVersion / termsHref); acceptance modal (scrollable terms, checkbox) wired into the builder publish flow with retry, creator-overview banner, status chip on Finance. |
| Onboarding (Part 4) | Migration 0029 (`onboarding_step`, `onboarding_data`), `GET/PATCH /users/me/onboarding` + `/complete`, resumable 4-step wizard (role → profile w/ username check + avatar upload → preferences + notification prefs → creator setup w/ optional terms acceptance), global redirect for incomplete users, role-based completion routing. |
| Catalog (Part 5) | search-service: language / duration-bucket / creator filters (level already existed); catalog page: level/language/duration controls, active-filter chips, reset, URL-synced filters (refresh/share restores state), improved empty state, mobile drawer retained. |
| Refund tickets (Part 6) | Tickets can be linked to a payment (`relatedPaymentId`, ownership-validated); ticket detail returns `refund_context` (amount, course, paid date, window eligibility); `POST /support/:id/refund-decision` records approve/reject with learner notification + audit; payment refunds now audited (`payment.refund`); learner "Request refund" modal on /transactions; admin refund panel inside the support ticket with terminal-state guards (no double refunds — payment-service rejects non-`success` payments). |
| Settings (Part 7) | Real password change (`POST /auth/change-password`, revokes other sessions), self-deactivation (`POST /auth/deactivate`, suspension machinery + typed confirmation), notification preferences load/save, theme Light/Dark/System applied + persisted to localStorage and the profile, profile editing linked to the existing real editor; honest privacy note (no schema support). |
| Moderation (Part 8) | Migration 0030 (`user_reports.target_course` + indexes), `POST /courses/reports` (rate-limited), admin queue `GET /courses/admin/reports` with filters, dismiss / mark-reviewed / suspend-course actions (suspend = `archived`, removed from catalog, creator notified, audited), `/admin/flagged` page + nav link, report buttons on the course detail page and Q&A comments. |

## 2. Files changed

**Migrations** — `database/migrations/0028_uploads.sql`, `0029_onboarding.sql`, `0030_reports.sql`
**Backend new** — `shared/storage.ts`, `course-service/src/uploads.ts`, `course-service/src/moderation.ts`, `user-service/src/uploads.ts`, `user-service/src/onboarding.ts`
**Backend modified** — `shared/index.ts`, `course-service/src/index.ts` (collab notifications/audit, lock meta, terms gate, route registration), `user-service/src/index.ts` (terms status, registrations), `auth-service/src/index.ts` (change-password, deactivate), `search-service/src/index.ts` (filters), `support-service/src/index.ts` (refund linkage/decision; pre-existing typecheck errors fixed), `payment-service/src/index.ts` (refund audit), service `package.json`s (multer) and backend root devDependencies (@types/multer)
**Frontend new** — `components/common/FileUpload.tsx`, `components/creator/CreatorTermsModal.tsx`, `app/onboarding/page.tsx`, `app/admin/flagged/page.tsx`
**Frontend modified** — `lib/api.ts`, `app/providers.tsx` (onboarding redirect), `components/common/Navbar.tsx` (invite badge, Flagged link), `components/creator/CourseBuilder.tsx` (thumbnail upload, terms gate/modal), `components/creator/NodeEditor.tsx` (attachments), player `Player.tsx` (Resources tab, comment report), `app/profile/edit/page.tsx` (avatar upload), `app/creator/{overview,finance}/page.tsx` (terms banner/chip), `app/catalog/page.tsx`, `app/settings/page.tsx`, `app/transactions/page.tsx`, `app/admin/support/page.tsx`, `app/course/[id]/page.tsx` (report button)
**Docs** — `CHECKLIST.md`, this file. `database/seed.sql` was made genuinely idempotent during Supabase setup.

## 3. Migrations added

`0028_uploads.sql` (buckets + `uploaded_assets` + RLS), `0029_onboarding.sql` (profiles onboarding columns), `0030_reports.sql` (`target_course` + report indexes). All idempotent; **already applied** to the configured Supabase project (verified: buckets, `uploaded_assets`, `onboarding_step`, `target_course` all present).

## 4. Backend endpoints added / modified

| Service | Endpoint | Change |
|---|---|---|
| course-service | `POST/DELETE /:id/collaborators*`, `POST /collaborations/:id/respond` | Modified — realtime broadcasts, `collab_left` owner notification, admin audit events |
| course-service | (assertCanWriteCourse) | Modified — 423 meta now includes `holderId` (alongside heldBy/holderName/expiresAt); `LOCK_HELD_BY_OTHER` ≡ the spec's `LOCKED` |
| course-service | `POST /uploads/course-thumbnail`, `POST /uploads/node-attachment`, `GET /nodes/:nodeId/attachments`, `DELETE /uploads/assets/:id`, `GET /uploads/local-file` | **New** — multipart uploads, editor/enrollment authz, signed/local downloads |
| course-service | `POST /:id/submit-review`, `POST /:id/publish` | Modified — `TERMS_ACCEPTANCE_REQUIRED` gate |
| course-service | `POST /reports`, `GET /admin/reports`, `POST /admin/reports/:id/{dismiss,reviewed,suspend-course}` | **New** — moderation |
| user-service | `POST /uploads/avatar`, `GET /uploads/local-file` | **New** |
| user-service | `GET /me/creator-terms-status`, `GET/PATCH /me/onboarding`, `POST /me/onboarding/complete` | **New** |
| auth-service | `POST /change-password`, `POST /deactivate` | **New** |
| search-service | `GET /courses` | Modified — `language`, `duration` (short/medium/long), `creatorId` filters |
| support-service | `POST /` (relatedPaymentId), `GET /:id` (refund_context), `POST /:id/refund-decision` | Modified / **New** |
| payment-service | `POST /:id/refund` | Modified — audit log entry |

## 5. Frontend pages / components changed

See §2. Highlights: `/onboarding` wizard, `/admin/flagged` queue, real uploads everywhere (avatar, thumbnail, attachments), URL-synced catalog filters, refund request + admin refund panel, real settings mutations, terms modal in the publish flow, pending-invite nav badge.

## 6. Automated checks run

| Command | Result |
|---|---|
| `cd frontend && npm run typecheck` | ✅ 0 errors |
| `cd frontend && npm run build` | ✅ passes (exit 0) |
| `cd frontend && npm run lint` | ⚠️ Not runnable — repo ships no ESLint config (unchanged pre-existing situation) |
| `cd backend && npx tsc --noEmit -p <svc>/tsconfig.json` | ✅ clean: `shared`, `support-service` (2 pre-existing errors fixed), plus previously-clean enrollment/achievement/notification/analytics/payout. ❌ pre-existing only: `course-service` 27, `user-service` 3, `auth-service` 1, `search-service` 3, `payment-service` 1 — all in untouched handlers (Express-5 `req.params` unions / `withDb` mock-fallback inference); none of the new wave-3 modules contribute errors. |
| `cd database && ./apply.sh "$DB_URL"` (WITH_SEED=0 re-run) | ✅ 0028–0030 applied; schema verified via information_schema/storage.buckets queries |
| Tests | No test framework in the repo — manual steps below. |

## 7. Manual API verification (curl)

```bash
C='-H "x-user-id: <creator-id>" -H "x-user-role: creator" -H "x-user-roles: creator,learner" -H "Content-Type: application/json"'
A='-H "x-user-id: 00000000-0000-0000-0000-00000000ad01" -H "x-user-role: admin" -H "Content-Type: application/json"'
L='-H "x-user-id: <learner-id>" -H "x-user-role: learner" -H "Content-Type: application/json"'

# Collaboration + lock (existing endpoints; verify the new bits)
eval curl -s -X POST $C -d "'{\"userId\":\"<other-creator-uuid>\"}'" http://localhost:4000/api/courses/<course-id>/collaborators | jq
# invitee gets a collab_invite notification + realtime ping; second editor acquiring the lock:
eval curl -s -X POST -H "x-user-id: <other-creator-uuid>" -H "x-user-role: creator" http://localhost:4000/api/courses/<course-id>/lock | jq   # outcome=held_by_other + holder details
# any write while someone else holds the lock → 423 with meta.holderId/holderName/expiresAt

# Uploads (multipart)
curl -s -X POST -H "x-user-id: <learner-id>" -H "x-user-role: learner" -F "file=@avatar.png" http://localhost:4000/api/users/uploads/avatar | jq
curl -s -X POST -H "x-user-id: <creator-id>" -H "x-user-role: creator" -F "file=@thumb.jpg" -F "courseId=<course-id>" http://localhost:4000/api/courses/uploads/course-thumbnail | jq
curl -s -X POST -H "x-user-id: <creator-id>" -H "x-user-role: creator" -F "file=@notes.zip" -F "nodeId=<node-id>" http://localhost:4000/api/courses/uploads/node-attachment | jq
eval curl -s $L http://localhost:4000/api/courses/nodes/<node-id>/attachments | jq          # enrolled learner sees signed URLs; others → 403

# Creator terms gate
eval curl -s -X POST $C http://localhost:4000/api/courses/<course-id>/publish | jq .error    # → TERMS_ACCEPTANCE_REQUIRED until accepted
eval curl -s $C http://localhost:4000/api/users/me/creator-terms-status | jq

# Onboarding
eval curl -s $L http://localhost:4000/api/users/me/onboarding | jq
eval curl -s -X PATCH $L -d "'{\"step\":1,\"roles\":\"both\"}'" http://localhost:4000/api/users/me/onboarding | jq
eval curl -s -X POST $L http://localhost:4000/api/users/me/onboarding/complete | jq

# Catalog filters
curl -s "'http://localhost:4000/api/search/courses?level=Beginner&language=English&duration=short&sort=rating'" | jq '.meta'

# Refund flow
eval curl -s -X POST $L -d "'{\"subject\":\"Refund request: DSA\",\"body\":\"Bought by mistake\",\"relatedPaymentId\":\"<payment-uuid>\"}'" http://localhost:4000/api/support/ | jq
eval curl -s $A http://localhost:4000/api/support/<ticket-id> | jq .data.refund_context
eval curl -s -X POST $A http://localhost:4000/api/payments/<payment-uuid>/refund | jq        # second call → INVALID_STATE (no double refund)
eval curl -s -X POST $A -d "'{\"approved\":true}'" http://localhost:4000/api/support/<ticket-id>/refund-decision | jq

# Settings security
eval curl -s -X POST $L -d "'{\"currentPassword\":\"wrong\",\"newPassword\":\"NewPass123\"}'" http://localhost:4000/api/auth/change-password | jq .error

# Moderation
eval curl -s -X POST $L -d "'{\"courseId\":\"<course-id>\",\"reason\":\"Plagiarised content from another platform\"}'" http://localhost:4000/api/courses/reports | jq
eval curl -s $A "'http://localhost:4000/api/courses/admin/reports?status=open'" | jq
eval curl -s -X POST $A http://localhost:4000/api/courses/admin/reports/<report-id>/suspend-course | jq
```

## 8. Manual UI verification steps

1. **Collaboration**: Creator A invites Creator B from the builder's collaborator panel (search by name) → B sees the navbar badge + invite on /creator/collaborations → accepts → opens the editor; while A holds the lock B is read-only with the "X is editing" banner; A releases (or lets it expire) → B can take it. A sees accept/decline notifications live.
2. **Uploads**: change your avatar in /profile/edit (appears in the navbar immediately); upload a course thumbnail in the builder Media section then Save; attach a file to a lesson in the builder → it appears under the lesson's Resources tab for an enrolled learner; delete it from the builder.
3. **T&C**: with a fresh creator, click Publish → terms modal blocks until accepted → publish retries automatically; Finance shows "Creator terms … accepted".
4. **Onboarding**: register a new account → you land on /onboarding; refresh mid-way → resumes the same step; duplicate username is rejected; finishing as "creator" routes to the creator dashboard.
5. **Catalog**: set level/language/duration filters → URL updates; refresh → filters persist; chips remove individual filters; empty state offers reset.
6. **Refunds**: as a learner, Request refund on a successful course payment in /transactions; as admin open the ticket in /admin/support → refund panel shows amount/eligibility → Approve → learner sees "Refund processed" notification, transaction flips to refunded; approving again is blocked.
7. **Settings**: change password (other sessions sign out), toggle notification preferences and save, switch theme to System, deactivate a throwaway account (login is then blocked with the suspension message).
8. **Moderation**: report a course from its detail page and a comment from the player → both appear in /admin/flagged → Suspend course → it disappears from the catalog and the creator gets a notification; the action shows in /admin/audit-log.

## 9. Known limitations

- Collaborator role is `editor` only (no `viewer`); declined/removed history is reachable via `GET /collaborations/mine?status=…` but has no dedicated UI tab.
- Lesson-PDF uploads intentionally keep the existing signed-URL + storage-quota flow rather than the new multipart path.
- Static-website assets and per-asset versioning are not part of the upload pipeline; uploads pass through the service (no resumable/chunked uploads), capped at 2 MB (avatars) / 5 MB (thumbnails) / 25 MB (attachments).
- Terms text in the modal is a standard summary rendered from platform settings (commission %); rich-text terms management is future work.
- Privacy toggles aren't implemented (no schema support) — the Settings tab says so explicitly; email change and Google account linking are likewise not offered.
- "Suspend course" maps to status `archived` (no dedicated `suspended` enum value); reactivation is manual via admin course tools.
- Onboarding redirect relies on `has_completed_onboarding` from `/users/me`; admins/seed users are pre-marked complete.
- Report button on comments uses a lightweight `window.prompt` (consistent with existing admin reject prompt) rather than a custom modal.

## 10. Local/dev fallback behaviour

- **No Supabase Storage / no Supabase**: uploads write to `<service>/.local-uploads/<bucket>/…` (never outside the repo) and are served by the authenticated/dev `GET /uploads/local-file` routes; metadata writes are skipped gracefully when the DB is absent.
- **No DB**: report/refund/onboarding endpoints return mock-shaped success or explicit `DB_REQUIRED` errors; nothing crashes.
- **No Razorpay**: refund approval still records the decision; the gateway call is skipped exactly as before.
- **No Redis**: every new notification (collab, refund, moderation, certificates) is written synchronously, so flows work without the event bus; realtime broadcasts no-op without Supabase.

## 11. Security & authorization notes

- Uploads: avatar = self only; thumbnails/attachments require course owner / accepted collaborator / admin (`courseEditorRole`); attachment downloads require enrollment or editor; asset deletion requires uploader/editor/admin; filenames are sanitised and paths are traversal-safe; MIME and size validated server-side (and at the bucket level).
- Refunds: ticket linkage validates payment ownership; money movement stays admin-only in payment-service and is idempotent; decisions and refunds are audit-logged.
- Terms/publish gates, lock enforcement and collaborator checks are all server-side; the structured 423 includes holder details but no sensitive data.
- Password change/deactivate verify the current password and revoke refresh tokens; deactivation reuses the suspension gate on login/refresh.
- Reports are rate-limited per user (10/hour) on top of the gateway limiter; moderation actions are admin-only and audited; suspension notifies the creator.

## 12. Lock race-condition & upload constraint notes

- **Lock acquisition is a single atomic upsert** (`acquire_course_lock`): concurrent acquire calls resolve inside one `INSERT … ON CONFLICT DO UPDATE`, so exactly one caller wins; expired locks are stolen in the same statement (no read-then-write window). Heartbeats only extend rows where `held_by = caller`, and release only deletes the caller's own row — a stale tab can't drop someone else's lock. Server-side `assertCanWriteCourse` re-checks holder + expiry on every write, so a client that lost the lock mid-edit gets a structured 423 rather than silently overwriting; the builder surfaces that as a recoverable error and re-syncs lock state on its next poll.
- **Upload constraints**: avatars ≤ 2 MB (jpeg/png/webp/gif), thumbnails ≤ 5 MB (jpeg/png/webp), node attachments ≤ 25 MB (any MIME), lesson PDFs ≤ 25 MB via the pre-existing flow; the same limits are enforced client-side (FileUpload), in multer (`fileSize`), in `validateUpload`, and at the Supabase bucket definition.
