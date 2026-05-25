import type { Badge, Category, Course, CourseNode, Enrollment, LedgerEntry, Notification, Payment, Review, SupportTicket, User } from "./types/index.js";

const thumb = (i: number) => `https://images.unsplash.com/photo-${["1517694712202-14dd9538aa97","1555066931-4365d14bab8c","1551288049-bebda4e38f71","1532619675605-1ede6c2ed2b0","1607799279861-4dd421887fb3","1581090700227-1e37b190418e","1517433670267-08bbd4be890f","1542831371-29b0f74f9713"][i % 8]}?w=900&h=500&fit=crop&auto=format&q=70`;
const ava = (s: string) => `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(s)}`;

export const categories: Category[] = [
  { id: "c1", name: "Data Structures", slug: "data-structures", icon: "🧱" },
  { id: "c2", name: "Algorithms", slug: "algorithms", icon: "⚡" },
  { id: "c3", name: "Web Development", slug: "web-dev", icon: "🌐" },
  { id: "c4", name: "System Design", slug: "system-design", icon: "🏗️" },
  { id: "c5", name: "Mathematics", slug: "mathematics", icon: "📐" },
  { id: "c6", name: "Machine Learning", slug: "machine-learning", icon: "🤖" },
];

export const users: User[] = [
  { id: "u1", email: "you@cs-ranger.dev", displayName: "Arjun Mehta", username: "arjun", avatarUrl: ava("arjun"), bio: "Final-year CS at IIT Bombay.", college: "IIT Bombay", roles: ["learner", "creator"], isVerified: true, createdAt: "2025-08-10T10:00:00Z" },
  { id: "u2", email: "ananya@cs-ranger.dev", displayName: "Ananya Iyer", username: "ananya", avatarUrl: ava("ananya"), bio: "Teaching DSA without the gatekeeping.", college: "BITS Pilani", roles: ["creator", "learner"], isVerified: true, createdAt: "2024-12-01T10:00:00Z" },
  { id: "u3", email: "rohan@cs-ranger.dev", displayName: "Rohan Kapoor", username: "rohan", avatarUrl: ava("rohan"), bio: "Backend nerd.", college: "NIT Trichy", roles: ["creator"], isVerified: true, createdAt: "2024-09-14T10:00:00Z" },
  { id: "u4", email: "sneha@cs-ranger.dev", displayName: "Sneha Reddy", username: "sneha", avatarUrl: ava("sneha"), bio: "ML researcher.", college: "IIIT Hyderabad", roles: ["creator"], isVerified: true, createdAt: "2024-11-20T10:00:00Z" },
  { id: "u5", email: "vikram@cs-ranger.dev", displayName: "Vikram Singh", username: "vikram", avatarUrl: ava("vikram"), bio: "Distributed systems.", college: "IIT Delhi", roles: ["creator"], isVerified: true, createdAt: "2024-07-04T10:00:00Z" },
  { id: "u6", email: "priya@cs-ranger.dev", displayName: "Priya Sharma", username: "priya", avatarUrl: ava("priya"), college: "VIT Vellore", roles: ["learner"], isVerified: true, createdAt: "2025-02-10T10:00:00Z" },
  { id: "u7", email: "kabir@cs-ranger.dev", displayName: "Kabir Khanna", username: "kabir", avatarUrl: ava("kabir"), college: "DTU", roles: ["learner"], isVerified: true, createdAt: "2025-03-15T10:00:00Z" },
  { id: "admin1", email: "admin@cs-ranger.dev", displayName: "Platform Admin", username: "admin", avatarUrl: ava("admin"), roles: ["admin"], isVerified: true, createdAt: "2024-01-01T00:00:00Z" },
];

function makeNodes(mid: string, n: number): CourseNode[] {
  const types: CourseNode["type"][] = ["video", "markdown", "quiz", "pdf", "video", "markdown"];
  return Array.from({ length: n }).map((_, i) => {
    const t = types[i % types.length];
    return { id: `${mid}-n${i + 1}`, moduleId: mid, type: t, title: t === "quiz" ? "Quick Check Quiz" : t === "markdown" ? "Notes" : t === "pdf" ? "Reference PDF" : `Lesson ${i + 1}`, durationSeconds: 300 + i * 60, position: i, isFreePreview: i === 0 } as CourseNode;
  });
}

function makeCourse(id: string, title: string, subtitle: string, creatorId: string, category: string, price: number, ti: number, rating = 4.7, enrolled = 1200): Course {
  const modules = Array.from({ length: 4 }).map((_, mi) => ({ id: `${id}-m${mi + 1}`, courseId: id, title: `Module ${mi + 1}`, position: mi, nodes: makeNodes(`${id}-m${mi + 1}`, 5 + mi) }));
  return { id, creatorId, title, subtitle, description: "Project-driven, hands-on.", category, language: "English", level: "All Levels", tags: ["intuitive", "hands-on"], thumbnail: thumb(ti), status: "published", price, discountedPrice: price > 0 ? Math.floor(price * 0.65) : undefined, certificateEnabled: true, enrollmentCount: enrolled, rating, ratingCount: Math.floor(enrolled * 0.18), durationSeconds: modules.flatMap((m) => m.nodes).reduce((s, n) => s + (n.durationSeconds || 0), 0), modules, createdAt: "2025-02-10T10:00:00Z", updatedAt: "2025-05-01T10:00:00Z" };
}

export const courses: Course[] = [
  makeCourse("crs-dsa-ts", "Data Structures with TypeScript", "From arrays to red-black trees.", "u2", "Data Structures", 1499, 0, 4.9, 5320),
  makeCourse("crs-algo-bc", "Algorithms Bootcamp 2026", "DP, graphs, greedy.", "u2", "Algorithms", 1799, 1, 4.8, 4100),
  makeCourse("crs-react-19", "React 19 from Scratch", "Server components & actions.", "u1", "Web Development", 999, 2, 4.7, 3850),
  makeCourse("crs-sysd-101", "System Design 101", "Diagrams for L5 interviews.", "u5", "System Design", 2499, 3, 4.9, 6210),
  makeCourse("crs-discrete", "Discrete Math for CS", "Logic, combinatorics, graphs.", "u3", "Mathematics", 0, 4, 4.6, 2150),
  makeCourse("crs-ml-pt", "Machine Learning with PyTorch", "Build a transformer.", "u4", "Machine Learning", 2199, 5, 4.8, 2980),
];

export const enrollments: Enrollment[] = [
  { id: "e1", learnerId: "u1", courseId: "crs-dsa-ts", enrolledAt: "2026-03-12T10:00:00Z", progressPercent: 64, lastNodeId: "crs-dsa-ts-m3-n2" },
  { id: "e2", learnerId: "u1", courseId: "crs-sysd-101", enrolledAt: "2026-04-02T10:00:00Z", progressPercent: 32 },
  { id: "e3", learnerId: "u1", courseId: "crs-discrete", enrolledAt: "2026-02-15T10:00:00Z", completedAt: "2026-04-20T10:00:00Z", progressPercent: 100 },
];

export const payments: Payment[] = enrollments.map((e, i) => ({ id: `pay-${i + 1}`, learnerId: e.learnerId, courseId: e.courseId, amount: courses.find((c) => c.id === e.courseId)?.discountedPrice ?? 0, status: "success", razorpayOrderId: `order_${i}`, razorpayPaymentId: `pay_${i}`, createdAt: e.enrolledAt }));

export const ledger: LedgerEntry[] = Array.from({ length: 10 }).map((_, i) => {
  const types: LedgerEntry["type"][] = ["enrollment_credit", "commission_debit"];
  const t = types[i % 2];
  return { id: `led-${i}`, creatorId: "u2", type: t, amount: t === "enrollment_credit" ? 974 : -126, referenceId: `ref-${i}`, createdAt: new Date(Date.now() - i * 86400000).toISOString() };
});

export const notifications: Notification[] = [
  { id: "n1", userId: "u1", type: "doubt_reply", title: "Ananya replied to your doubt", body: "On 'Big-O of mergesort'", href: "/course/crs-dsa-ts/learn/crs-dsa-ts-m2-n3", isRead: false, createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
  { id: "n2", userId: "u1", type: "new_course", title: "New course from Sneha Reddy", body: "Transformers from Scratch is live", href: "/catalog", isRead: false, createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  { id: "n3", userId: "u1", type: "badge", title: "Badge earned: 7-Day Streak", body: "Keep it alive!", href: "/achievements", isRead: false, createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
];

export const badges: Badge[] = [
  { id: "b1", name: "First Steps", description: "Complete your first lesson", icon: "🚀", ruleKey: "first_lesson", earnedAt: "2026-02-16T10:00:00Z", rarity: "common" },
  { id: "b2", name: "Course Crusher", description: "Complete your first course", icon: "🏆", ruleKey: "first_course", earnedAt: "2026-04-20T10:00:00Z", rarity: "rare" },
  { id: "b3", name: "7-Day Streak", description: "Learn 7 days in a row", icon: "🔥", ruleKey: "streak_7", earnedAt: "2026-05-19T10:00:00Z", rarity: "rare" },
  { id: "b4", name: "Quiz Master", description: "100% on 10 quizzes", icon: "🧠", ruleKey: "quiz_master", rarity: "epic" },
  { id: "b5", name: "Polymath", description: "Courses in 5 categories", icon: "🎓", ruleKey: "polymath", rarity: "legendary" },
];

export const supportTickets: SupportTicket[] = [
  { id: "tkt1", userId: "u1", subject: "Cannot access PDFs", status: "in_progress", createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(),
    messages: [
      { id: "msg1", ticketId: "tkt1", authorId: "u1", body: "PDF returns 403", createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
      { id: "msg2", ticketId: "tkt1", authorId: "admin1", body: "Looking into it", createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    ] },
];

export const reviews: Review[] = [
  { id: "r1", courseId: "crs-dsa-ts", learnerId: "u6", rating: 5, body: "Finally clicked!", createdAt: "2026-04-10T10:00:00Z" },
  { id: "r2", courseId: "crs-dsa-ts", learnerId: "u7", rating: 5, body: "Best money I spent.", createdAt: "2026-04-12T10:00:00Z" },
];

export const heatmap = (() => {
  const map: Record<string, number> = {};
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    map[d.toISOString().slice(0, 10)] = Math.floor(Math.random() * 5);
  }
  return map;
})();

export const platformStats = { learners: 84210, courses: 1247, hoursOfContent: 9840, creators: 612 };
