# Broadcast email failure — "0 emails sent · 42 failed"

_Diagnosed 2026-06-22. Admin → Broadcast sends in-app notifications fine, but every email fails._

## Symptom
- Admin broadcast reports **`42 accounts targeted · 42 in-app notifications · 0 emails sent · 42 failed`**.
- **In-app notifications succeed every time** — only the **email channel** fails.
- It has failed on every recent attempt (multiple tries over the last few hours).
- The UI hints: _"Email requires `RESEND_API_KEY` configured on the server."_

## What is NOT the problem (ruled out by live testing)
- **The code is fine.** The broadcast path (`/admin/broadcast` → `sendBulkEmail` → Resend `batch.send`) works correctly.
- **The local `.env` Resend key is valid and live-working.** Tested directly against Resend's API:
  - `POST /emails` (single) → **HTTP 200**
  - `POST /emails/batch` (what broadcast uses) → **HTTP 200**
  - Batch **with `reply_to`** (exactly as the code sends) → **HTTP 200**
  - The real `sendBulkEmail` SDK call (`resend` 4.8.0) → `error: null`, real message IDs.
- **The sender domain `learnrift.site` is verified** (single + batch sends from `support@learnrift.site` succeed).
- **The recipient list is not empty.** Live DB: **42 active users, all 42 verified** → 42 valid email targets in one batch.
- **Not an account-wide quota / domain / suspension issue.** Resend quota and domain verification are *account-level* — if production shared the working credentials, the live test above would have failed too. It didn't.

## Root cause (CONFIRMED)
The running `cs-notification-service` process had the **placeholder** value
**`RESEND_API_KEY=re_YOUR_API_KEY`** baked into its PM2 environment — not the
real key. Every Resend call with that placeholder is rejected (invalid key) →
all 42 emails fail. In-app notifications don't touch Resend, so they kept working.

Why the real key wasn't being picked up:
- The VM's `~/cs-ranger/.env` **does** contain the real, working key (`re_M2Xv…` —
  verified live against Resend). So the file was fine; the **process** was stale.
- **Env only reaches PM2 services when they are (re)started with `--update-env`,
  AND the variable is *exported* in the shell.** `deploy.sh` does this correctly:
  `set -a; source .env; set +a` (lines 87–89) — `set -a` auto-exports.
- A **manual `source .env` without `set -a` does NOT export** the vars (they
  become shell-only variables). So `pm2 restart --update-env` never saw
  `RESEND_API_KEY`, and the process kept its old placeholder value.
- The placeholder kept surviving restarts/reboots because PM2 resurrects its
  saved dump (this VM has crash-loops/reboots), so it must be corrected **and
  `pm2 save`d**.

Supporting evidence:
- Production email worked 6 days ago (the "Thanks for joining LearnRift" broadcast
  sent `38 emails`) — so the working key was loaded then; the placeholder crept in
  since (a restart/resurrect with stale env).
- A truly *missing* key can't cause this — the code's dev fallback would report
  everything as **sent** (`failed: 0`), not failed. A present-but-placeholder key
  is what produces "all failed".
- The error was previously **swallowed** (`if (res.error) failed += …` dropped
  `res.error.message`, bare `catch {}` dropped exceptions). **Fixed** in commit
  `1b2e6b0` ("corrected email sharing"): the real Resend error is now logged and
  returned as `emailError`.

## The fix (on the production VM)
```bash
cd ~/cs-ranger
set -a; source .env; set +a                        # set -a = EXPORT (the missing piece)
pm2 restart cs-notification-service --update-env
pm2 env 10 | grep RESEND                            # MUST show re_M2Xv… NOT re_YOUR_API_KEY
pm2 save                                            # persist so a reboot can't restore the placeholder
```
Then send a test broadcast — expect `42 sent`. If it still fails, the reason is
now visible (commit `1b2e6b0`):
```bash
pm2 logs cs-notification-service --lines 50 | grep "bulk chunk"
```
- `API key is invalid` → process still on the placeholder (re-check the export)
- `domain is not verified` → `learnrift.site` not verified in that key's Resend account
- `Too many requests` → rate/quota limit

## Watch out
- **Resend free tier = 100 emails/day.** Repeated full-audience blasts (3 × 42 = 126 in 31 min was already attempted) can hit that cap even after the key is fixed — a later failure may be quota, not the key.
- Email only goes to **verified** addresses (`is_verified = true`). `EMAIL_VERIFICATION=FALSE` in env means new signups may not get verified, which would silently shrink the email audience over time (separate concern from this failure).

## Key files
- `backend/shared/email.ts` — `sendBulkEmail()` (Resend client, chunked `batch.send`, error surfacing).
- `backend/notification-service/src/index.ts` — `POST /admin/broadcast` (recipient resolution, verified-only filter, audit log, `emailError` in response).
- `frontend/src/app/admin/broadcast/page.tsx` — admin UI that renders `emailSent` / `emailFailed`.
- `ecosystem.config.cjs` + `deploy.sh` — how env reaches the pm2-managed services (deploy-time only).
