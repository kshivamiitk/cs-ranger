-- ============================================================
-- Seed data — matches frontend/src/lib/mock-data.ts so the UI looks identical
-- whether hitting the mock layer or a fresh Postgres.
-- Idempotent: re-runnable.
-- ============================================================

-- Disable triggers for bulk insert (we'll fix derived counters at the end)
set session_replication_role = replica;

-- ====== Categories ======
insert into categories (id, name, slug, icon, position) values
  ('11111111-0000-0000-0000-000000000001', 'Data Structures',   'data-structures',  '🧱', 0),
  ('11111111-0000-0000-0000-000000000002', 'Algorithms',        'algorithms',       '⚡', 1),
  ('11111111-0000-0000-0000-000000000003', 'Web Development',   'web-dev',          '🌐', 2),
  ('11111111-0000-0000-0000-000000000004', 'System Design',     'system-design',    '🏗️', 3),
  ('11111111-0000-0000-0000-000000000005', 'Mathematics',       'mathematics',      '📐', 4),
  ('11111111-0000-0000-0000-000000000006', 'Machine Learning',  'machine-learning', '🤖', 5),
  ('11111111-0000-0000-0000-000000000007', 'Databases',         'databases',        '🗄️', 6),
  ('11111111-0000-0000-0000-000000000008', 'DevOps',            'devops',           '🛠️', 7)
on conflict (name) do nothing;

-- ====== Users ======
insert into users (id, email, password_hash, is_verified, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'you@cs-ranger.dev',    '$2y$12$placeholder', true, '2025-08-10T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000002', 'ananya@cs-ranger.dev', '$2y$12$placeholder', true, '2024-12-01T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000003', 'rohan@cs-ranger.dev',  '$2y$12$placeholder', true, '2024-09-14T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000004', 'sneha@cs-ranger.dev',  '$2y$12$placeholder', true, '2024-11-20T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000005', 'vikram@cs-ranger.dev', '$2y$12$placeholder', true, '2024-07-04T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000006', 'priya@cs-ranger.dev',  '$2y$12$placeholder', true, '2025-02-10T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000007', 'kabir@cs-ranger.dev',  '$2y$12$placeholder', true, '2025-03-15T10:00:00Z'),
  ('00000000-0000-0000-0000-00000000ad01', 'admin@cs-ranger.dev',  '$2y$12$placeholder', true, '2024-01-01T00:00:00Z')
on conflict (id) do nothing;

insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'learner'),
  ('00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0000-000000000002', 'creator'),
  ('00000000-0000-0000-0000-000000000002', 'learner'),
  ('00000000-0000-0000-0000-000000000003', 'creator'),
  ('00000000-0000-0000-0000-000000000004', 'creator'),
  ('00000000-0000-0000-0000-000000000005', 'creator'),
  ('00000000-0000-0000-0000-000000000006', 'learner'),
  ('00000000-0000-0000-0000-000000000007', 'learner'),
  ('00000000-0000-0000-0000-00000000ad01', 'admin')
on conflict do nothing;

insert into profiles (user_id, display_name, username, bio, college, avatar_url, has_completed_onboarding) values
  ('00000000-0000-0000-0000-000000000001', 'Arjun Mehta',    'arjun',  'Final-year CS at IIT Bombay. Currently obsessed with compilers.',  'IIT Bombay',       'https://api.dicebear.com/9.x/glass/svg?seed=arjun',  true),
  ('00000000-0000-0000-0000-000000000002', 'Ananya Iyer',    'ananya', 'Teaching DSA the way I wish I was taught — without the gatekeeping.', 'BITS Pilani',   'https://api.dicebear.com/9.x/glass/svg?seed=ananya', true),
  ('00000000-0000-0000-0000-000000000003', 'Rohan Kapoor',   'rohan',  'Backend nerd. Built two startups before graduating.',              'NIT Trichy',       'https://api.dicebear.com/9.x/glass/svg?seed=rohan',  true),
  ('00000000-0000-0000-0000-000000000004', 'Sneha Reddy',    'sneha',  'ML researcher → educator. PyTorch, transformers, lots of math.',   'IIIT Hyderabad',   'https://api.dicebear.com/9.x/glass/svg?seed=sneha',  true),
  ('00000000-0000-0000-0000-000000000005', 'Vikram Singh',   'vikram', 'Distributed systems at scale. Ex-Flipkart.',                       'IIT Delhi',        'https://api.dicebear.com/9.x/glass/svg?seed=vikram', true),
  ('00000000-0000-0000-0000-000000000006', 'Priya Sharma',   'priya',  null, 'VIT Vellore', 'https://api.dicebear.com/9.x/glass/svg?seed=priya', true),
  ('00000000-0000-0000-0000-000000000007', 'Kabir Khanna',   'kabir',  null, 'DTU',         'https://api.dicebear.com/9.x/glass/svg?seed=kabir', true),
  ('00000000-0000-0000-0000-00000000ad01', 'Platform Admin', 'admin',  null, null,          'https://api.dicebear.com/9.x/glass/svg?seed=admin', true)
on conflict (user_id) do nothing;

-- ====== Courses ======
-- Helper-less single-statement inserts; module/node fan-out follows.
insert into courses (id, creator_id, title, subtitle, description, category_id, language, level, tags, thumbnail_url, status, price, discounted_price, certificate_enabled, enrollment_count, rating_avg, rating_count, duration_seconds, published_at, created_at, updated_at) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Data Structures with TypeScript', 'From arrays to red-black trees — with every line explained.', 'A hands-on, project-driven journey designed by a student who recently learned this material.', '11111111-0000-0000-0000-000000000001', 'English', 'All Levels', '{intuitive,hands-on,interview-ready}', 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=900&h=500&fit=crop&auto=format&q=70', 'published', 1499, 974, true, 5320, 4.9, 957, 10800, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Algorithms Bootcamp 2026',          'DP, graphs, greedy, and the rare technique interviewers love.','—', '11111111-0000-0000-0000-000000000002', 'English', 'All Levels', '{intuitive,hands-on}', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=900&h=500&fit=crop&auto=format&q=70', 'published', 1799, 1169, true, 4100, 4.8, 738, 12600, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'React 19 from Scratch',             'Server components, actions, and the new mental model.',         '—', '11111111-0000-0000-0000-000000000003', 'English', 'All Levels', '{react,server-components}', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&h=500&fit=crop&auto=format&q=70', 'published',  999, 649, true, 3850, 4.7, 693, 9000, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 'System Design 101',                 'Build the diagrams that get you through L5 interviews.',        '—', '11111111-0000-0000-0000-000000000004', 'English', 'All Levels', '{system-design,interviews}', 'https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?w=900&h=500&fit=crop&auto=format&q=70', 'published', 2499, 1624, true, 6210, 4.9, 1118, 14400, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'Discrete Math for CS',              'Logic, combinatorics, graph theory — intuition first.',         '—', '11111111-0000-0000-0000-000000000005', 'English', 'All Levels', '{math,proofs}', 'https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=900&h=500&fit=crop&auto=format&q=70', 'published',    0, null, true, 2150, 4.6, 387, 9000, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'Machine Learning with PyTorch',     'Build a transformer from scratch by the end of week 6.',        '—', '11111111-0000-0000-0000-000000000006', 'English', 'All Levels', '{ml,pytorch,transformers}', 'https://images.unsplash.com/photo-1581090700227-1e37b190418e?w=900&h=500&fit=crop&auto=format&q=70', 'published', 2199, 1429, true, 2980, 4.8, 536, 14400, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000003', 'SQL Mastery for Backend Devs',      'Window functions, indexes, and queries that scale.',            '—', '11111111-0000-0000-0000-000000000007', 'English', 'All Levels', '{sql,databases}', 'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?w=900&h=500&fit=crop&auto=format&q=70', 'published',  799, 519, true, 1840, 4.7, 331, 7200, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000005', 'Docker & Kubernetes — Practical',   'Ship containers, not slides.',                                  '—', '11111111-0000-0000-0000-000000000008', 'English', 'All Levels', '{docker,k8s,devops}', 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=900&h=500&fit=crop&auto=format&q=70', 'published', 1299, 844, true, 1620, 4.6, 291, 7200, '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z', '2025-05-01T10:00:00Z')
on conflict (id) do nothing;

-- Modules + nodes — generated en masse for each course
do $$
declare
  c record;
  m_id uuid;
  i int;
  j int;
  n_types node_type[] := array['video','markdown','quiz','pdf','video','markdown']::node_type[];
  n_type node_type;
begin
  for c in select id from courses where id::text like '22222222%' loop
    -- Idempotency: module/node ids are generated, so re-running would duplicate
    -- the curriculum. Skip any course that already has modules.
    if exists (select 1 from modules where course_id = c.id) then
      continue;
    end if;
    for i in 1..4 loop
      m_id := gen_random_uuid();
      insert into modules (id, course_id, title, position) values
        (m_id, c.id, format('Module %s: %s', i, (array['Foundations','Core Patterns','Advanced Topics','Real-World Projects'])[i]), i - 1)
        on conflict do nothing;
      for j in 1..(4 + i) loop
        n_type := n_types[((j - 1) % array_length(n_types,1)) + 1];
        insert into nodes (module_id, type, title, position, duration_seconds, is_free_preview, video_url, video_provider, markdown, pdf_url, quiz_payload)
        values (
          m_id,
          n_type,
          case n_type
            when 'quiz'::node_type then 'Quick Check Quiz'
            when 'markdown'::node_type then 'Notes: Key Patterns'
            when 'pdf'::node_type then 'Reference PDF'
            else format('Lesson %s: Intuition & Examples', j)
          end,
          j - 1,
          case when n_type = 'quiz'::node_type then 300 else 480 + (j * 87 % 600) end,
          j = 1,
          case when n_type = 'video'::node_type then 'https://www.youtube.com/embed/dQw4w9WgXcQ' end,
          case when n_type = 'video'::node_type then 'youtube' end,
          case when n_type = 'markdown'::node_type then E'## Concept\n\nThe key intuition is invariants make complex problems tractable.' end,
          case when n_type = 'pdf'::node_type then 'https://example.com/sample.pdf' end,
          case when n_type = 'quiz'::node_type then '{"timerSeconds":300,"questions":[{"id":"q1","prompt":"What is the time complexity of binary search?","options":["O(n)","O(log n)","O(n log n)","O(1)"],"correctIndex":1,"explanation":"Each step halves the search space."}]}'::jsonb end
        );
      end loop;
    end loop;
  end loop;
end $$;

-- ====== Enrollments (Arjun's learning journey) ======
insert into enrollments (id, learner_id, course_id, enrolled_at, completed_at, progress_percent) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '2026-03-12T10:00:00Z', null,                    64),
  ('33333333-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', '2026-04-02T10:00:00Z', null,                    32),
  ('33333333-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000005', '2026-02-15T10:00:00Z', '2026-04-20T10:00:00Z', 100),
  ('33333333-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', '2026-05-01T10:00:00Z', null,                    12)
on conflict (id) do nothing;

-- ====== Payments for the paid courses ======
insert into razorpay_orders (learner_id, course_id, razorpay_order_id, amount, status) values
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'order_dev_1', 97400, 'success'),
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'order_dev_2', 162400, 'success'),
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'order_dev_3', 64900, 'success')
on conflict do nothing;

insert into payments (learner_id, course_id, razorpay_order_id, razorpay_payment_id, amount, status, created_at) values
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'order_dev_1', 'pay_dev_1', 97400,  'success', '2026-03-12T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'order_dev_2', 'pay_dev_2', 162400, 'success', '2026-04-02T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'order_dev_3', 'pay_dev_3', 64900,  'success', '2026-05-01T10:00:00Z')
on conflict do nothing;

-- ====== Wallet ledger for Ananya ======
do $$
declare i int;
begin
  -- Idempotency: ledger rows have generated ids, so guard on the seed marker.
  if exists (select 1 from wallet_ledger where creator_id = '00000000-0000-0000-0000-000000000002' and reference_id = 'seed-1') then
    return;
  end if;
  for i in 1..10 loop
    insert into wallet_ledger (creator_id, type, amount, reference_id, created_at)
    values ('00000000-0000-0000-0000-000000000002',
            (case when i % 2 = 0 then 'commission_debit'::ledger_type else 'enrollment_credit'::ledger_type end),
            (case when i % 2 = 0 then -12600 else 97400 end),
            'seed-' || i,
            now() - (i || ' days')::interval);
  end loop;
end $$;

insert into creator_balances (creator_id, pending, total_earned, total_paid_out, total_commission, updated_at) values
  ('00000000-0000-0000-0000-000000000002', 840000, 12742000, 8170000, 2248000, now())
on conflict (creator_id) do update set
  pending = excluded.pending,
  total_earned = excluded.total_earned,
  total_paid_out = excluded.total_paid_out,
  total_commission = excluded.total_commission;

insert into kyc_details (creator_id, razorpay_contact_id, razorpay_fund_account_id, kyc_status, bank_name, account_number_last4, ifsc, verified_at) values
  ('00000000-0000-0000-0000-000000000002', 'cont_dev_1', 'fa_dev_1', 'approved', 'HDFC Bank', '4823', 'HDFC0000123', now())
on conflict (creator_id) do nothing;

insert into payout_runs (id, initiated_by, initiated_at, total_amount, creator_count, notes) values
  ('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad01', '2026-04-01T00:00:00Z', 3250000, 1, 'April monthly payout'),
  ('44444444-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000ad01', '2026-05-01T00:00:00Z', 4120000, 1, 'May monthly payout')
on conflict (id) do nothing;

insert into payout_items (run_id, creator_id, amount, status, razorpay_payout_id, created_at, settled_at) values
  ('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 3250000, 'processed', 'rp_p_1', '2026-04-01T00:00:00Z', '2026-04-01T03:14:00Z'),
  ('44444444-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 4120000, 'processed', 'rp_p_2', '2026-05-01T00:00:00Z', '2026-05-01T02:48:00Z')
on conflict (razorpay_payout_id) do nothing;

-- ====== Reviews ======
insert into reviews (course_id, learner_id, rating, body, created_at) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 5, 'I have failed at DSA twice. This finally clicked. Ananya explains the why, not just the how.', '2026-04-10T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 5, 'The TypeScript angle made everything concrete. Best 1499 I''ve spent.',                          '2026-04-12T10:00:00Z'),
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 4, 'Solid. Wanted more on segment trees but the rest was great.',                                    '2026-03-30T10:00:00Z')
on conflict (course_id, learner_id) do nothing;

-- ====== Badges ======
insert into badges (id, rule_key, name, description, icon, rarity, position) values
  ('55555555-0000-0000-0000-000000000001', 'first_lesson',     'First Steps',     'Complete your first lesson',           '🚀', 'common',    0),
  ('55555555-0000-0000-0000-000000000002', 'first_course',     'Course Crusher',  'Complete your first full course',      '🏆', 'rare',      1),
  ('55555555-0000-0000-0000-000000000003', 'streak_7',         '7-Day Streak',    'Learn 7 days in a row',                '🔥', 'rare',      2),
  ('55555555-0000-0000-0000-000000000004', 'night_owl',        'Night Owl',       'Complete a lesson after midnight',     '🦉', 'common',    3),
  ('55555555-0000-0000-0000-000000000005', 'quiz_master_10',   'Quiz Master',     'Score 100% on 10 quizzes',             '🧠', 'epic',      4),
  ('55555555-0000-0000-0000-000000000006', 'hours_100',        'Century Club',    'Watch 100 hours of content',           '💯', 'epic',      5),
  ('55555555-0000-0000-0000-000000000007', 'polymath',         'Polymath',        'Complete courses in 5 categories',     '🎓', 'legendary', 6),
  ('55555555-0000-0000-0000-000000000008', 'founder',          'Founder''s Friend','Joined in launch month',              '🌟', 'legendary', 7)
on conflict (rule_key) do nothing;

insert into user_badges (user_id, badge_id, earned_at) values
  ('00000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', '2026-02-16T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', '2026-04-20T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003', '2026-05-19T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', '2026-03-22T02:14:00Z'),
  ('00000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000008', '2025-08-10T10:00:00Z')
on conflict do nothing;

insert into user_streaks (user_id, current_streak, longest_streak, last_activity_date)
values ('00000000-0000-0000-0000-000000000001', 7, 21, current_date)
on conflict (user_id) do update set current_streak = 7, longest_streak = 21, last_activity_date = current_date;

-- ====== Certificates ======
insert into certificates (id, learner_id, course_id, verification_token, issued_at) values
  ('66666666-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000005', 'v-1a2b3c4d', '2026-04-20T10:00:00Z')
on conflict do nothing;

-- ====== Notifications ======
-- Idempotency: notifications have no natural unique key, so guard on a sentinel row.
insert into notifications (user_id, type, title, body, href, is_read, created_at)
select * from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'doubt_reply', 'Ananya replied to your doubt',  'On ''Big-O of mergesort''',        '/course/22222222-0000-0000-0000-000000000001/learn/x', false, now() - interval '12 minutes'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'new_course',  'New course from Sneha Reddy',   'Transformers from Scratch is live','/catalog',                                              false, now() - interval '3 hours'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'badge',       'Badge earned: 7-Day Streak',    'Keep the streak alive!',           '/achievements',                                         false, now() - interval '8 hours'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'enrollment',  'Enrollment confirmed',          'Dynamic Programming Decoded',      '/my-courses',                                           true,  now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payout',      'Payout processed',              '₹32,500 sent to your bank',        '/creator/finance',                                      true,  now() - interval '5 days')
) as v(user_id, type, title, body, href, is_read, created_at)
where not exists (
  select 1 from notifications
  where user_id = '00000000-0000-0000-0000-000000000001' and title = 'Ananya replied to your doubt'
);

-- ====== Support tickets ======
insert into support_tickets (id, user_id, subject, status, created_at, updated_at) values
  ('77777777-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Cannot access downloaded PDFs', 'in_progress', now() - interval '3 days', now() - interval '1 day')
on conflict (id) do nothing;

-- Idempotency: guard on the ticket already having messages.
insert into ticket_messages (ticket_id, author_id, body, created_at)
select * from (values
  ('77777777-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'The PDF in module 2 returns 403 when I click download.', now() - interval '3 days'),
  ('77777777-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-00000000ad01'::uuid, 'Looking into this — can you confirm the course ID?',     now() - interval '2 days')
) as v(ticket_id, author_id, body, created_at)
where not exists (select 1 from ticket_messages where ticket_id = '77777777-0000-0000-0000-000000000001');

-- ====== Bookmarks ======
insert into bookmarks (learner_id, course_id) values
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000008')
on conflict do nothing;

-- ====== Audit log seed ======
-- Insert as superuser bypasses the immutability trigger; for real runs, use the admin path.
-- Idempotency: append-only table, so guard on a sentinel seed row.
insert into admin_audit_log (admin_id, action, target_type, target_id, metadata)
select * from (values
  ('00000000-0000-0000-0000-00000000ad01'::uuid, 'course.approve',     'course', '22222222-0000-0000-0000-000000000003', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000000ad01'::uuid, 'payout.bulk',        'payout_run', '44444444-0000-0000-0000-000000000002', '{"creators":1,"amount":4120000}'::jsonb),
  ('00000000-0000-0000-0000-00000000ad01'::uuid, 'commission.update',  'setting', 'commission_rate', '{"from":0.12,"to":0.15}'::jsonb)
) as v(admin_id, action, target_type, target_id, metadata)
where not exists (
  select 1 from admin_audit_log
  where admin_id = '00000000-0000-0000-0000-00000000ad01' and action = 'course.approve' and target_id = '22222222-0000-0000-0000-000000000003'
);

-- Re-enable triggers
set session_replication_role = default;

-- Force a one-shot refresh of derived counters
update courses set updated_at = updated_at;   -- triggers search_vector refresh on any rows missing it
