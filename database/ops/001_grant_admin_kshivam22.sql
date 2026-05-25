-- Grant admin to kshivam22@iitk.ac.in (also ensures learner + creator,
-- since an admin is a learner and creator too). Idempotent.
-- To promote a different user, copy this into a new NNN_*.sql file and change the email.
insert into user_roles (user_id, role)
select u.id, r.role
from users u
cross join (values ('learner'::user_role), ('creator'), ('admin')) as r(role)
where u.email = 'kshivam22@iitk.ac.in'
on conflict (user_id, role) do nothing;
