import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://learnrift.site").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/auth/",
          "/bookmarks",
          "/cli-auth",
          "/course/*/learn/",
          "/creator/",
          "/my-courses",
          "/notifications",
          "/onboarding",
          "/profile/",
          "/report-cards",
          "/settings",
          "/transactions",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

