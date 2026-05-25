# Admin Governance — Verification Guide

How to verify the DB-backed platform settings, audit log viewer, admin user management and payout governance features. The repo has no automated test framework (no jest/vitest config in either workspace), so this documents the automated checks that do exist plus exact manual verification steps.

---

## 1. Automated checks run

| Check | Command | Result |
|---|---|---|
| Frontend typecheck | `cd frontend && npm run typecheck` | 8 **pre-existing** errors in `src/app/page.tsx` + `src/app/search/page.tsx` (camelCase props used on `CreatorListing`, untouched by this work). **No errors in any new/changed file** (`lib/api.ts`, `admin/settings`, `admin/audit-log`, `admin/users`, `admin/payouts`, `Navbar`). |
| Frontend lint | `cd frontend && npm run lint` | Not runnable — the repo ships no ESLint config (`.eslintrc*` / `eslint.config.*`), so `next lint` stops at its interactive first-time setup prompt. Left unconfigured to avoid changing project tooling. |
| Backend typecheck (per changed workspace) | `cd backend && npx tsc --noEmit -p <svc>/tsconfig.json` | `shared` ✅ clean · `payout-service` ✅ clean · `user-service` 3 pre-existing errors (`index.ts:68/126/136` — by-username & list endpoints' mock-fallback typing) · `auth-service` 1 pre-existing (`index.ts:35` — `jwt.sign` `expiresIn` typing vs `@types/jsonwebtoken`) · `wallet-service` 2 pre-existing (`index.ts:29/39` — ledger endpoint mock-fallback typing) · `payment-service` 1 pre-existing (`index.ts:339` — payments list mock-fallback typing). All remaining errors are in untouched handlers; backend services run via `tsx` and have never had a typecheck script, which is why these strict-mode mismatches predate this change. |

New code introduced by this feature set typechecks clean.

## 2. Database migration

```bash
cd database && ./apply.sh "$DATABASE_URL"
```

New migration `0026_admin_governance.sql` adds:
- `users.is_suspended / suspended_at / suspension_reason`
- missing `platform_settings` keys: `payout_schedule`, `refund_auto_approval`, `feature_flags`
- `admin_role_requests` (two-person admin grant) + RLS

It is idempotent (`if not exists` / `on conflict do nothing`) and safe to re-run.

## 3. Manual API verification (dev headers)

Start the backend (`cd backend && npm run dev`). In dev the gateway forwards `x-user-id` / `x-user-role` headers, so an admin can be impersonated directly. Without Supabase credentials every endpoint falls back to mock/dev behaviour (still returns the correct shapes); with credentials it is fully DB-backed.

```bash
ADMIN='-H "x-user-id: 00000000-0000-0000-0000-00000000ad01" -H "x-user-role: admin" -H "x-user-roles: admin" -H "Content-Type: application/json"'

# Platform settings
eval curl -s $ADMIN http://localhost:4000/api/users/admin/platform-settings | jq .data.settings
eval curl -s -X PATCH $ADMIN -d "'{\"commission_rate\":0.2,\"site_name\":\"CS-Ranger\"}'" \
  http://localhost:4000/api/users/admin/platform-settings | jq
# → expect changedKeys to list only what changed; a commission.update row lands in admin_audit_log

# Validation errors are friendly
eval curl -s -X PATCH $ADMIN -d "'{\"commission_rate\":2}'" \
  http://localhost:4000/api/users/admin/platform-settings | jq .error

# Audit log (filters: actionType/adminId/targetType/dateFrom/dateTo, snake_case also accepted)
eval curl -s $ADMIN "'http://localhost:4000/api/users/admin/audit-log?page=1&pageSize=10&actionType=commission.update'" | jq

# Admin user list with filters
eval curl -s $ADMIN "'http://localhost:4000/api/users/admin/users?role=creator&status=active&q=ananya'" | jq

# Suspend / unsuspend (replace <user-id>)
eval curl -s -X POST $ADMIN -d "'{\"reason\":\"ToS violation - spam courses\"}'" \
  http://localhost:4000/api/users/admin/users/<user-id>/suspend | jq
# Suspending again → 400 INVALID_STATE "User is already suspended"
# Suspended user's login → 403 SUSPENDED "Your account has been suspended. Contact support."

# Roles
eval curl -s -X POST $ADMIN -d "'{\"reason\":\"Trusted partner onboarding\"}'" \
  http://localhost:4000/api/users/admin/users/<user-id>/grant-creator | jq
eval curl -s -X POST $ADMIN -d "'{\"reason\":\"No longer publishing content\"}'" \
  http://localhost:4000/api/users/admin/users/<user-id>/revoke-creator | jq
# → 409 PENDING_BALANCE if the creator still has unpaid earnings (pass "override": true to force)

# Two-person admin grant
eval curl -s -X POST $ADMIN -d "'{\"reason\":\"New operations hire requires platform admin access\"}'" \
  http://localhost:4000/api/users/admin/users/<user-id>/request-admin | jq
# Approving with the SAME admin → 400 "A different admin must approve this request (two-person rule)"
eval curl -s -X POST -H "x-user-id: <other-admin-id>" -H "x-user-role: admin" -H "Content-Type: application/json" \
  http://localhost:4000/api/users/admin/admin-requests/<request-id>/approve | jq

# Payout governance
eval curl -s -X POST $ADMIN -d "'{\"creatorId\":\"<creator-id>\",\"amountInr\":750,\"reason\":\"Off-cycle dispute settlement\"}'" \
  http://localhost:4000/api/payouts/manual | jq
eval curl -s $ADMIN http://localhost:4000/api/payouts/failed | jq
eval curl -s -X POST $ADMIN http://localhost:4000/api/payouts/<payout-item-id>/retry | jq
```

Each mutation above writes a row to `admin_audit_log` (`settings.update`, `commission.update`, `terms.update`, `user.suspend`, `user.unsuspend`, `user.grant_creator`, `user.revoke_creator`, `user.admin_grant_requested`, `user.grant_admin`, `payout.bulk`, `payout.manual`, `payout.retry`) — confirm via the audit-log endpoint or `/admin/audit-log` in the UI.

## 4. Manual UI verification

Run `cd frontend && npm run dev`, log in as an admin (`profiles.is_admin = true` or seed admin), then:

1. **/admin/settings** — values load from the DB; edit commission %, min payout, payout schedule, refund auto-approval, feature flags; Save shows a spinner, then "Settings saved"; reload to confirm persistence; enter an invalid value (commission 200%) to see the friendly backend validation error.
2. **/admin/audit-log** — entries from step 1 appear newest-first; filter by action type and date range; expand the Details JSON; pagination works; clearing filters resets to page 1.
3. **/admin/users** — filter by role/status, search by name; open **Manage** on a user; suspend with a reason → status chip flips to *Suspended* after refetch; attempt to log in as that user → blocked; unsuspend; grant/revoke creator; "Request Admin" files a two-person request.
4. **/admin/payouts** — the Payout settings card mirrors `/admin/settings` (no hardcoded 15%); "Manual payout" on an eligible creator row asks for amount + reason and shows success/failure; the Failed payouts table lists failures with a Retry action.

## 5. Session invalidation path (suspension)

- Suspending a user revokes **all active refresh tokens** (`refresh_tokens.revoked_at`) — the same mechanism as `/auth/logout-all` — so no new access token can be minted.
- Login (`POST /auth/login`) and refresh (`POST /auth/refresh`) reject suspended accounts with `403 SUSPENDED`.
- Already-issued **access tokens cannot be revoked** (stateless 15-minute JWTs); they expire naturally within 15 minutes. This is the documented mock/limitation of "immediate" session invalidation.

## 6. Known limitations

- Razorpay/RazorpayX are not called when `RAZORPAY_*` env vars are absent — manual payout, retry and bulk runs use the safe mocked branch (dev payout IDs + immediate ledger settlement), mirroring the existing bulk-payout behaviour.
- Suspension blocks login/refresh and pauses nothing else automatically (catalog visibility, enrollment blocking and payout holds for suspended creators are not yet enforced).
- `payout_schedule` is stored and displayed but no scheduler triggers automatic runs yet — runs remain admin-initiated.
- Settings reads are cached in-process for ~30 s per service, so a change can take up to 30 s to be picked up by other services.
- Audit log entries do not record the admin's IP address (the gateway does not forward it to services today).
- Pre-existing typecheck errors and the missing ESLint config listed in §1 were left untouched.
