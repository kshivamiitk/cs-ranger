import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://learnrift.site").replace(/\/$/, "");

type SearchCoursesResponse = {
  data?: Array<{ id?: string; updated_at?: string; published_at?: string }>;
};

const staticRoutes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
  { path: "/creators", priority: 0.7, changeFrequency: "daily" },
  { path: "/pricing", priority: 0.7, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.5, changeFrequency: "monthly" },
  { path: "/legal", priority: 0.4, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/digital-delivery-policy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/creator-terms", priority: 0.4, changeFrequency: "yearly" },
  { path: "/learner-terms", priority: 0.4, changeFrequency: "yearly" },
  { path: "/grievance", priority: 0.4, changeFrequency: "yearly" },
];

export const revalidate = 3600;

async function courseEntries(): Promise<MetadataRoute.Sitemap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${SITE_URL}/api/search/courses?sort=newest&limit=60`, {
      next: { revalidate },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as SearchCoursesResponse;
    return (payload.data || [])
      .filter((course): course is { id: string; updated_at?: string; published_at?: string } => Boolean(course.id))
      .map((course) => ({
        url: `${SITE_URL}/course/${course.id}`,
        lastModified: course.updated_at || course.published_at || new Date(),
        changeFrequency: "weekly",
        priority: 0.8,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    ...staticRoutes.map((route) => ({
      url: `${SITE_URL}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...(await courseEntries()),
  ];
}
