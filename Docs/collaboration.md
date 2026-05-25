# Course Collaboration — Plan

> Two creators on one course, no branching, no merge conflicts. A single-writer lock + an invitation flow. Built to be obvious for the creator and bullet-proof against the worst case (someone holds the lock and walks away from their laptop).

---

## 1. Problem statement

A course is currently owned by exactly one creator (`courses.creator_id`). Multiple creators need to be able to collaborate on the same course — invite, accept, co-edit, leave — without the engineering cost of multi-writer branching/merging.

**Goals**
- One course → one owner + N accepted collaborators.
- Owners invite by searching the existing creator directory; invitees see a notification with Accept / Decline.
- Only one collaborator can actively edit at a time. Everyone else sees the course read-only with a clear "X is editing" indicator.
- The lock must not survive a browser crash, a closed tab, or an abandoned session indefinitely.

**Non-goals**
- Real-time co-editing (Google-Docs / Figma). Single-writer lock only.
- Branching, version trees, merge conflicts. The course is the course.
- Per-lesson / per-module locks. Scope = the whole course. Simpler model, fewer edge cases, and 95% of edit sessions touch multiple modules anyway.

---

## 2. Data model

### 2.1 `course_collaborators` (new)

```sql
create table course_collaborators (
  course_id     uuid not null references courses(id) on delete cascade,
  user_id       uuid not null references users(id)   on delete cascade,
  status        collaborator_status not null default 'pending',
  role          collaborator_role   not null default 'editor',
  invited_by    uuid not null references users(id)   on delete restrict,
  invited_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (course_id, user_id)
);
```

- `collaborator_status` enum: `'pending' | 'accepted' | 'declined' | 'removed'`.
- `collaborator_role` enum: `'editor'` for now. Reserved space for `'viewer'` / `'co-owner'` later.
- The owner (`courses.creator_id`) is **not** stored here — that stays on `courses` for back-compat. The effective edit team is `{ courses.creator_id } ∪ { course_collaborators where status='accepted' }`.
- Indexed on `(user_id, status)` for the "invitations sent to me" listing, and `(course_id, status)` for "people on this course".

### 2.2 `course_edit_locks` (new)

```sql
create table course_edit_locks (
  course_id          uuid primary key references courses(id) on delete cascade,
  held_by            uuid not null references users(id)      on delete cascade,
  acquired_at        timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now(),
  expires_at         timestamptz not null
);
```

- One row per locked course. Absence of a row = unlocked.
- `expires_at = last_heartbeat_at + interval '10 minutes'`. Lock is dead any time `now() > expires_at`.
- A SQL helper `acquire_course_lock(course_id, user_id)` performs the "insert if not held, or steal if expired, or extend if I'm the holder" check atomically. Without it, two browsers racing for the lock could both think they got it.

### 2.3 Why a separate table, not columns on `courses`

- Column changes on the courses table mean RLS policy churn and lots of UPDATEs to a hot row. A small dedicated table is faster to update, easier to index for "all my held locks", and trivially droppable if we ever change the lock strategy.
- The lock row is short-lived (10-min idle TTL). Putting that on `courses` would write to the catalog hot path every minute via heartbeats.

---

## 3. Authorization rules

For every existing write path on `course-service` (PATCH /:id, PATCH /modules/:id, PATCH /nodes/:id, POST /:id/modules, POST /nodes, DELETE /modules/:id, DELETE /nodes/:id, POST /:id/publish, POST /:id/submit-review):

1. The caller must be (a) the course owner, (b) an accepted collaborator on this course, OR (c) admin.
2. The caller must currently hold the lock on this course (owners and collaborators alike — no special bypass).
3. If either check fails → `403 LOCKED` with the current holder's display name in the response so the client can render "Locked by X" without an extra round trip.

The existing single-line check `if (course.creator_id !== req.user!.id) return forbidden` becomes a shared `canEditCourse(db, courseId, userId)` helper used by every write endpoint. One place to fix bugs.

Reads are unchanged — anyone who can already read the course can still read it. Locks govern writes only.

---

## 4. Lock semantics

### 4.1 Acquire

`POST /api/courses/:id/lock`

- Authenticated owner or accepted collaborator.
- Server calls `acquire_course_lock(course_id, user_id)` which is a single SQL statement that returns one of:
  - `{ outcome: 'acquired', held_by: <me>, expires_at }` — got it (fresh, stolen-because-expired, or already mine).
  - `{ outcome: 'held_by_other', held_by: <them>, expires_at, holder_name }` — someone else has it, here's who and how long until you can steal.
- The atomicity matters: two clients calling `/lock` simultaneously must not both succeed.

### 4.2 Heartbeat

`POST /api/courses/:id/lock/heartbeat`

- Bumps `last_heartbeat_at = now()` only if the caller still holds the lock.
- Idle TTL is 10 minutes — frontend heartbeats every ~60s while the editor is open, giving 10× headroom for transient network failures.
- No-op (200) if the lock has expired or been taken — frontend reacts by trying to re-acquire.

### 4.3 Release

`DELETE /api/courses/:id/lock`

- Drops the row only if the caller currently holds it.
- Called explicitly on Save → publish, on "Close editor" / route change, and via `navigator.sendBeacon` on `beforeunload` so closing the tab releases promptly.

### 4.4 Force-release / steal

Anyone with edit rights can take a lock once `now() > expires_at` (no admin override needed for the common case — someone closed their laptop yesterday, the next editor shouldn't be blocked).

For active locks: no manual force-steal in v1. Wait for it to expire. Reduces the "two people thought they were editing" footgun. Admin override can come later if it actually matters.

---

## 5. Endpoints

### Collaboration management
| Method | Path | Who | Body | Purpose |
|---|---|---|---|---|
| `POST` | `/api/courses/:id/collaborators` | Owner | `{ userId }` | Invite — creates `pending` row, fires notification |
| `GET`  | `/api/courses/:id/collaborators` | Owner / collaborator | — | List rows (any status) |
| `POST` | `/api/collaborations/:courseId/respond` | Invitee | `{ accept: bool }` | Move `pending → accepted` or `declined`; notifies owner |
| `DELETE` | `/api/courses/:id/collaborators/:userId` | Owner (any), Self (only own row) | — | Remove collaborator (sets `status='removed'`, soft delete so future invites don't lose audit history) |
| `GET`  | `/api/collaborations/mine` | Self | `?status=pending\|accepted` | Invites and active collaborations for the current user |

### Lock management
| Method | Path | Who | Purpose |
|---|---|---|---|
| `GET`  | `/api/courses/:id/lock`            | Owner / collaborator | Inspect (lock-holder name + expires_at, or unlocked) |
| `POST` | `/api/courses/:id/lock`            | Owner / collaborator | Acquire or extend |
| `POST` | `/api/courses/:id/lock/heartbeat`  | Owner / collaborator | Extend if mine |
| `DELETE` | `/api/courses/:id/lock`          | Owner / collaborator | Release (only if mine) |

All endpoints live in `course-service`. The SQL function `acquire_course_lock` keeps the multi-step lock check inside a single statement (atomic, no transaction dance in JS).

---

## 6. Notifications

Reuses the existing `notifications` table — `type='collab_invite' / 'collab_accepted' / 'collab_declined' / 'collab_removed'`. Synchronous insert in the handler (same pattern as the Doubts notification — works without Redis).

Notification `href` deep-links:
- **Invite** → `/creator/collaborations?focus=<courseId>` — the invitee's "incoming invites" page with the matching row highlighted, Accept / Decline inline.
- **Accept / Decline / Removed** → `/creator/courses/<courseId>/edit` for the owner.

The bell unread-count, the notifications page, and the existing notification pipeline all just work.

---

## 7. Frontend changes

### 7.1 CourseBuilder (edit page)
- On mount: `POST /api/courses/:id/lock`. Two outcomes:
  - **Acquired** → render editor as-is. Spin up a 60s `setInterval` heartbeat. Release on unmount and on `beforeunload` (via `sendBeacon` so the request fires even mid-navigation).
  - **Held by other** → render the editor with all inputs `readOnly` / `disabled`. Show a banner: "🔒 X is editing. You can take over after their lock expires in M minutes." Poll the lock status every 30s so the page becomes editable automatically when the lock clears.
- Save / Publish call the existing endpoints; the backend already checks the lock so no client-side logic change.
- Save & Continue keeps the lock; "Done editing" / "Close" releases it.

### 7.2 Collaborator panel (in CourseBuilder, under the course root selection)
- New section under the existing Basics/Media/Pricing/Settings stack: **Collaborators**.
- Lists current collaborators with their status chips (`Owner`, `Editor`, `Pending invite`).
- "Invite collaborator" button → small modal with a creator search box backed by the existing `/api/search/creators` endpoint. Click a result → POSTs the invite → row appears as `pending`.
- Per-row "Remove" action (owner only, with confirm).
- Self-row shows "Leave course" instead of "Remove".

### 7.3 New `/creator/collaborations` page
- Two sections: **Incoming invites** (the user's `pending` rows) and **My collaborations** (`accepted` rows).
- Each invite card: course title, inviter name, "Accept" + "Decline" buttons.
- Each collaboration card: course title, owner, "Open editor" link, "Leave course" button.

### 7.4 Navbar
- Add a "Collaborations" link under the creator navbar links (between "Doubts" and "Finance").
- Badge with unread invite count, sourced from `/api/collaborations/mine?status=pending` count.

### 7.5 Course detail page (learner side)
- Unchanged. Learners don't see collaboration state. The course is still authored "by `creator.display_name`" — collaborator credits can come in a v2.

---

## 8. Migration plan

Single migration `0021_course_collaboration.sql`:
- The two enums (`collaborator_status`, `collaborator_role`).
- The two tables and their indexes.
- RLS policies (owners + accepted collaborators can read; only owners can invite; invitees can update their own row to set status).
- `acquire_course_lock(uuid, uuid)` SQL function.
- Compatibility shim: a SQL view `course_editors(course_id, user_id, role)` that unions the owner + accepted collaborators so existing analytics queries can adopt it without rewriting joins.

Idempotent the same way `0010_rls.sql` is — drops policies in this migration's namespace before recreating, `if not exists` everywhere, `create or replace` for the function. Re-running `apply.sh` is safe.

---

## 9. Edge cases and failure modes

| Scenario | Outcome |
|---|---|
| Owner invites themselves | Backend short-circuits with 400. UI hides "self" from search results too. |
| Owner invites a non-creator (no `creator` role) | Backend rejects with 400 "User isn't a creator". Same UI filter on search. |
| Invite already pending / already accepted | Idempotent — return 200 with current row. |
| Collaborator hits Publish | Allowed if lock held. Publish event credits the owner (existing behavior); collaborator audit log records the actor. |
| Owner removes themselves | Disallowed (would orphan the course). UI hides the action; backend rejects. |
| Course deleted while invites pending | `ON DELETE CASCADE` cleans up collaborator + lock rows. |
| Lock holder's session goes dark mid-edit | Heartbeat stops → `expires_at` reached after 10 min → next acquirer wins. The previous editor's unsaved local changes are lost; we don't promise crash recovery in v1. |
| Two collaborators race to acquire | Atomicity of `acquire_course_lock` ensures exactly one wins. The loser sees `outcome: 'held_by_other'`. |
| Lock holder loses internet | Existing edits in their browser are unaffected. Save attempts will 403 LOCKED if the lock has expired by the time the network returns; client should display "Your lock expired — save discarded; reload to take over." |
| `sendBeacon` failure on tab close | The lock survives until `expires_at`. Annoying but not broken. |

---

## 10. Future extensions (not in v1)

- **Per-section locking** (e.g. one collaborator edits Curriculum while another edits Pricing). Schema already scoped to enable this by adding a `section` column — but UX cost is significant and the current single-writer model is enough for 99% of cases.
- **Role: viewer** — read-only seat on a private (unpublished) course. Useful when a creator wants feedback before publishing.
- **Role: co-owner** — full ownership rights including transfer + delete. Currently only the original owner has those.
- **Activity feed** — "X edited Module 2" entries on the course's audit log. The hooks exist (`admin_audit_log`); broadening to collaborator actions is straightforward when we want it.
- **Force takeover by admin** — admin can break a held lock with an audit entry. Skipped in v1 because the 10-min idle expiry handles the realistic cases.

---

## 11. What ships in the first PR

In order:

1. Migration `0021_course_collaboration.sql` — schema + RLS + SQL function.
2. `course-service` — collaborator + lock endpoints, write-path authorization helper.
3. Synchronous notification inserts on invite / response / removal.
4. Frontend `api.ts` — typed helpers for both surfaces.
5. `/creator/collaborations` page (incoming invites + active collaborations).
6. CourseBuilder — lock acquire / heartbeat / release on the existing edit page + read-only banner when held by another.
7. Collaborator panel inside CourseBuilder.
8. Navbar link with unread badge.

After this lands and the team has used it a bit, decide whether to layer per-section locking on top.
