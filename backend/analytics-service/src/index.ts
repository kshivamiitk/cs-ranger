import { createService, ok, fail, requireAuth, requireRole, withDb } from "@cs-ranger/shared";

const { app, listen } = createService("analytics-service");
const PORT = Number(process.env.PORT_ANALYTICS || 4012);

const cache = new Map<string, { value: unknown; expiresAt: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && c.expiresAt > Date.now()) return Promise.resolve(c.value as T);
  return fn().then((v) => {
    cache.set(key, { value: v, expiresAt: Date.now() + ttlMs });
    return v;
  });
}

/** Creators may only read their own analytics; admins can read anyone's. */
function canViewCreator(req: { user?: { id: string; role: string } }, creatorId: string): boolean {
  return !!req.user && (req.user.id === creatorId || req.user.role === "admin");
}

app.get("/learner/:userId/report-card", requireAuth, async (req, res) => {
  const data = await cached(`learner-${req.params.userId}`, 5 * 60 * 1000, async () =>
    withDb(async (db) => {
      const [{ data: enrollments }, { data: attempts }] = await Promise.all([
        db.from("enrollments").select("course_id, progress_percent, completed_at, courses(title, duration_seconds)").eq("learner_id", req.params.userId),
        db.from("quiz_attempts").select("node_id, score, max_score, attempted_at").eq("learner_id", req.params.userId),
      ]);
      const passRate = attempts && attempts.length ? attempts.filter((a) => (a.score / a.max_score) >= 0.6).length / attempts.length : 0;
      return {
        totals: {
          coursesEnrolled: enrollments?.length || 0,
          completed: enrollments?.filter((e) => e.completed_at).length || 0,
          quizzesAttempted: attempts?.length || 0,
          quizPassRate: passRate,
        },
        enrollments: enrollments || [],
        recentAttempts: attempts?.slice(-10) || [],
      };
    }, () => ({ totals: { coursesEnrolled: 0, completed: 0, quizzesAttempted: 0, quizPassRate: 0 }, enrollments: [], recentAttempts: [] }))
  );
  ok(res, data);
});

app.get("/creator/:creatorId/overview", requireAuth, async (req, res) => {
  if (!canViewCreator(req, String(req.params.creatorId))) return fail(res, 403, "You can only view your own analytics", "FORBIDDEN");
  const data = await cached(`creator-overview-${req.params.creatorId}`, 5 * 60 * 1000, async () =>
    withDb(async (db) => {
      const { data: courses } = await db.from("courses").select("id, enrollment_count, rating_avg, rating_count, price, discounted_price").eq("creator_id", req.params.creatorId).eq("status", "published");
      const { data: balance } = await db.from("creator_balances").select("*").eq("creator_id", req.params.creatorId).maybeSingle();
      const totalStudents = (courses || []).reduce((s, c) => s + (c.enrollment_count || 0), 0);
      const reviewCount = (courses || []).reduce((s, c) => s + (c.rating_count || 0), 0);
      const avgRating = reviewCount > 0 ? (courses || []).reduce((s, c) => s + (c.rating_avg || 0) * (c.rating_count || 0), 0) / reviewCount : 0;
      return {
        courseCount: courses?.length || 0,
        totalStudents,
        avgRating,
        totalRevenue: balance?.total_earned || 0,
        pendingBalance: balance?.pending || 0,
      };
    }, () => ({ courseCount: 0, totalStudents: 0, avgRating: 0, totalRevenue: 0, pendingBalance: 0 }))
  );
  ok(res, data);
});

app.get("/creator/:creatorId/courses/:courseId", requireAuth, async (req, res) => {
  if (!canViewCreator(req, String(req.params.creatorId))) return fail(res, 403, "You can only view your own analytics", "FORBIDDEN");
  const courseId = req.params.courseId;
  const data = await cached(`course-analytics-${courseId}`, 5 * 60 * 1000, async () =>
    withDb(async (db) => {
      const since = new Date(); since.setDate(since.getDate() - 30);
      // Independent reads in parallel.
      const [{ data: course }, { data: enrollments }, { data: nodes }, { data: payments }] = await Promise.all([
        db.from("courses").select("title, enrollment_count, rating_avg, rating_count, price, discounted_price").eq("id", courseId).maybeSingle(),
        db.from("enrollments").select("enrolled_at").eq("course_id", courseId).gte("enrolled_at", since.toISOString()),
        db.from("nodes").select("id, title, modules!inner(course_id)").eq("modules.course_id", courseId),
        db.from("payments").select("amount, status").eq("course_id", courseId),
      ]);
      // Per-node completion counts.
      const nodeIds = nodes?.map((n) => n.id) || [];
      const { data: progress } = nodeIds.length > 0
        ? await db.from("node_progress").select("node_id").in("node_id", nodeIds).eq("is_completed", true)
        : { data: [] };
      const counts = new Map<string, number>();
      for (const p of progress || []) counts.set(p.node_id, (counts.get(p.node_id) || 0) + 1);
      const revenue = (payments || []).filter((p) => p.status === "success").reduce((s, p) => s + (p.amount || 0), 0);
      const refunds = (payments || []).filter((p) => p.status === "refunded").length;
      return {
        course,
        enrollmentTrend: enrollments || [],
        funnel: (nodes || []).map((n) => ({ nodeId: n.id, title: n.title, completions: counts.get(n.id) || 0 })),
        revenue,
        refunds,
      };
    }, () => ({ course: null, enrollmentTrend: [], funnel: [], revenue: 0, refunds: 0 }))
  );
  ok(res, data);
});

// ─── Creator dashboard (range-filtered aggregate) ─────────────────
type DashboardRange = "7d" | "30d" | "90d" | "all";

interface CreatorDashboard {
  range: DashboardRange;
  kpis: {
    revenuePaise: number; enrollments: number; totalStudents: number; activeCourses: number;
    completionRate: number; quizPassRate: number; avgRating: number;
  };
  revenueTrend: { bucket: string; revenuePaise: number }[];
  enrollmentTrend: { bucket: string; enrollments: number }[];
  courses: { id: string; title: string; status: string; enrollment_count: number; rating_avg: number; revenuePaise: number; enrollmentsInRange: number }[];
  recentActivity: { kind: "enrollment" | "completion"; at: string; courseTitle: string; learnerName: string }[];
}

const EMPTY_DASHBOARD = (range: DashboardRange): CreatorDashboard => ({
  range,
  kpis: { revenuePaise: 0, enrollments: 0, totalStudents: 0, activeCourses: 0, completionRate: 0, quizPassRate: 0, avgRating: 0 },
  revenueTrend: [], enrollmentTrend: [], courses: [], recentActivity: [],
});

app.get("/creator/:creatorId/dashboard", requireAuth, async (req, res) => {
  const creatorId = String(req.params.creatorId);
  if (!canViewCreator(req, creatorId)) return fail(res, 403, "You can only view your own analytics", "FORBIDDEN");
  const range: DashboardRange = (["7d", "30d", "90d", "all"] as const).includes(req.query.range as DashboardRange) ? (req.query.range as DashboardRange) : "30d";
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  // Bucket per-day for bounded ranges, per-month for "all" so charts stay readable.
  const bucketOf = (iso: string) => (days ? iso.slice(0, 10) : iso.slice(0, 7));

  const data = await cached(`creator-dashboard-${creatorId}-${range}`, 5 * 60 * 1000, async () =>
    withDb<CreatorDashboard>(async (db) => {
      const { data: courses } = await db.from("courses")
        .select("id, title, status, enrollment_count, rating_avg, rating_count")
        .eq("creator_id", creatorId);
      if (!courses || courses.length === 0) return EMPTY_DASHBOARD(range);
      const courseIds = courses.map((c) => c.id);
      const titleById = new Map(courses.map((c) => [c.id as string, c.title as string]));

      let enrollQ = db.from("enrollments").select("course_id, enrolled_at, completed_at").in("course_id", courseIds);
      if (since) enrollQ = enrollQ.gte("enrolled_at", since);
      let payQ = db.from("payments").select("course_id, amount, created_at").eq("status", "success").in("course_id", courseIds);
      if (since) payQ = payQ.gte("created_at", since);
      let quizQ = db.from("quiz_attempts")
        .select("score, max_score, passed, attempted_at, nodes!inner(modules!inner(courses!inner(creator_id)))")
        .eq("nodes.modules.courses.creator_id", creatorId);
      if (since) quizQ = quizQ.gte("attempted_at", since);
      const recentQ = db.from("enrollments")
        .select("enrolled_at, completed_at, course_id, users!enrollments_learner_id_fkey(profiles(display_name))")
        .in("course_id", courseIds)
        .order("enrolled_at", { ascending: false })
        .limit(10);

      const [enrollRes, payRes, quizRes, recentRes] = await Promise.all([enrollQ, payQ, quizQ, recentQ]);
      const enrollments = enrollRes.data || [];
      const payments = payRes.data || [];
      const attempts = quizRes.data || [];

      const revenuePaise = payments.reduce((s, p) => s + (p.amount || 0), 0);
      const completed = enrollments.filter((e) => e.completed_at).length;
      const passedAttempts = attempts.filter((a) => a.passed ?? (a.max_score > 0 && a.score / a.max_score >= 0.6)).length;
      const ratingCount = courses.reduce((s, c) => s + (c.rating_count || 0), 0);
      const avgRating = ratingCount > 0 ? courses.reduce((s, c) => s + (c.rating_avg || 0) * (c.rating_count || 0), 0) / ratingCount : 0;

      const revenueBuckets = new Map<string, number>();
      for (const p of payments) revenueBuckets.set(bucketOf(p.created_at || ""), (revenueBuckets.get(bucketOf(p.created_at || "")) || 0) + (p.amount || 0));
      const enrollBuckets = new Map<string, number>();
      for (const e of enrollments) enrollBuckets.set(bucketOf(e.enrolled_at || ""), (enrollBuckets.get(bucketOf(e.enrolled_at || "")) || 0) + 1);

      const revenueByCourse = new Map<string, number>();
      for (const p of payments) revenueByCourse.set(p.course_id, (revenueByCourse.get(p.course_id) || 0) + (p.amount || 0));
      const enrollByCourse = new Map<string, number>();
      for (const e of enrollments) enrollByCourse.set(e.course_id, (enrollByCourse.get(e.course_id) || 0) + 1);

      type RecentRow = { enrolled_at: string; completed_at: string | null; course_id: string; users?: { profiles?: { display_name?: string } | null } | { profiles?: { display_name?: string } | null }[] | null };
      const recentActivity = ((recentRes.data || []) as RecentRow[]).map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          kind: (r.completed_at ? "completion" : "enrollment") as "completion" | "enrollment",
          at: r.completed_at || r.enrolled_at,
          courseTitle: titleById.get(r.course_id) || "Course",
          learnerName: u?.profiles?.display_name || "A learner",
        };
      });

      return {
        range,
        kpis: {
          revenuePaise,
          enrollments: enrollments.length,
          totalStudents: courses.reduce((s, c) => s + (c.enrollment_count || 0), 0),
          activeCourses: courses.filter((c) => c.status === "published").length,
          completionRate: enrollments.length > 0 ? Math.round((completed / enrollments.length) * 100) : 0,
          quizPassRate: attempts.length > 0 ? Math.round((passedAttempts / attempts.length) * 100) : 0,
          avgRating: Math.round(avgRating * 10) / 10,
        },
        revenueTrend: Array.from(revenueBuckets.entries()).sort().map(([bucket, v]) => ({ bucket, revenuePaise: v })),
        enrollmentTrend: Array.from(enrollBuckets.entries()).sort().map(([bucket, v]) => ({ bucket, enrollments: v })),
        courses: courses
          .map((c) => ({
            id: c.id as string, title: c.title as string, status: c.status as string,
            enrollment_count: c.enrollment_count || 0, rating_avg: Number(c.rating_avg) || 0,
            revenuePaise: revenueByCourse.get(c.id) || 0, enrollmentsInRange: enrollByCourse.get(c.id) || 0,
          }))
          .sort((a, b) => b.revenuePaise - a.revenuePaise || b.enrollmentsInRange - a.enrollmentsInRange),
        recentActivity,
      };
    }, EMPTY_DASHBOARD(range))
  );
  ok(res, data);
});

app.get("/admin/overview", requireRole("admin"), async (_req, res) => {
  const data = await cached("admin-overview", 5 * 60 * 1000, async () =>
    withDb(async (db) => {
      const [u, courses, pub, rev, comm, signupsToday, signupsWeek, active] = await Promise.all([
        db.from("users").select("id", { count: "exact", head: true }),
        db.from("courses").select("id", { count: "exact", head: true }),
        db.from("courses").select("id", { count: "exact", head: true }).eq("status", "under_review"),
        db.from("payments").select("amount", { count: "exact" }).eq("status", "success"),
        db.from("wallet_ledger").select("amount").eq("type", "commission_debit"),
        db.from("users").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
        db.from("users").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        db.from("node_progress").select("learner_id", { count: "exact", head: true }).eq("is_completed", true).gte("completed_at", new Date(new Date().setDate(1)).toISOString()),
      ]);
      const totalRev = (rev.data || []).reduce((s, p) => s + (p.amount || 0), 0);
      const totalCommission = -((comm.data || []).reduce((s, l) => s + (l.amount || 0), 0));
      return {
        totalUsers: u.count || 0,
        totalCourses: courses.count || 0,
        coursesUnderReview: pub.count || 0,
        totalRevenue30d: totalRev,
        commissionEarned: totalCommission,
        newSignupsToday: signupsToday.count || 0,
        newSignupsWeek: signupsWeek.count || 0,
        activeLearnersMTD: active.count || 0,
      };
    }, () => ({ totalUsers: 0, totalCourses: 0, coursesUnderReview: 0, totalRevenue30d: 0, commissionEarned: 0, newSignupsToday: 0, newSignupsWeek: 0, activeLearnersMTD: 0 }))
  );
  ok(res, data);
});

app.get("/admin/revenue", requireRole("admin"), async (_req, res) => {
  const data = await cached("admin-revenue", 5 * 60 * 1000, async () =>
    withDb(async (db) => {
      const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1);
      const { data } = await db.from("payments").select("amount, created_at").eq("status", "success").gte("created_at", since.toISOString());
      const buckets = new Map<string, number>();
      for (const p of data || []) {
        const k = p.created_at?.slice(0, 7) || "?";
        buckets.set(k, (buckets.get(k) || 0) + (p.amount || 0));
      }
      return Array.from(buckets.entries()).sort().map(([month, revenue]) => ({ month, revenue, commission: Math.floor(revenue * 0.15) }));
    }, () => [])
  );
  ok(res, data);
});

listen(PORT);
