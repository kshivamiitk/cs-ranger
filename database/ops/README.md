# database/ops — operational queries

One-off, **idempotent** SQL for operational data changes (role grants, data fixes,
backfills) — things that aren't schema (`../migrations/`) or demo data (`../seed.sql`).

Convention:
- Every operational DB change is a numbered file here (`NNN_short_name.sql`), never an
  ad-hoc query pasted into a shell.
- Files must be **safe to re-run** (`on conflict do nothing`, `if not exists`, guarded
  updates). `apply.sh` runs every file in order, so re-running is a no-op when nothing changed.

Run all ops files (uses `DATABASE_URL_DIRECT` from the repo `.env`):

```bash
./apply.sh
# or a single file:
psql "$DATABASE_URL_DIRECT" -f 001_grant_admin_kshivam22.sql
```

## Making someone an admin (canonical way)

Since migration `0012_admin_flag.sql`, admin is controlled by the **`profiles.is_admin`** flag.
A trigger keeps `user_roles` in sync (admin ⇒ also learner + creator). Just flip the flag —
in SQL or the Supabase table editor — and the user becomes admin on their **next login**:

```sql
update profiles set is_admin = true
where user_id = (select id from users where email = 'THEIR_EMAIL');
-- revoke: set is_admin = false  (removes admin only; keeps learner/creator)
```

No app code or restart needed. (The old `001_grant_admin_*.sql` user_roles-insert approach
still works and is idempotent, but `is_admin` is now the source of truth.)
