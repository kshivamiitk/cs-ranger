"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Github, Linkedin, Twitter, Globe, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { CourseCard } from "@/components/common/CourseCard";
import { FollowButton } from "@/components/common/FollowButton";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/utils";

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const { data, isLoading } = useQuery({ queryKey: ["profile", params.username], queryFn: () => api.users.byUsername(params.username) });

  const creatorId = data?.profile?.user_id || data?.profile?.id || "";
  const { data: followers } = useQuery({
    queryKey: ["subscriber-count", creatorId],
    queryFn: () => api.users.subscriberCount(creatorId),
    enabled: !!creatorId && !!data?.roles?.includes("creator"),
  });

  if (isLoading) return <><Navbar variant="public" /><div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div></>;
  if (!data) return <><Navbar variant="public" /><div className="p-10 text-center text-fg-dim">User not found.</div></>;

  const { profile, roles, courses } = data;
  const isCreator = roles?.includes("creator");
  const displayName = profile.display_name || profile.displayName || "User";

  return (
    <>
      <Navbar />
      <main>
        <div className="h-48 bg-mesh-1 md:h-64" />
        <div className="mx-auto max-w-5xl px-4 md:px-6">
          <div className="-mt-16 flex flex-col items-start gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex items-end gap-4">
              <Avatar name={displayName} src={profile.avatar_url || profile.avatarUrl} size={96} className="ring-4 ring-bg" />
              <div>
                <h1 className="heading-2">{displayName}</h1>
                <p className="text-fg-dim">@{profile.username}{profile.college ? ` · ${profile.college}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isCreator && (
                <>
                  <span className="chip">{formatCompact(followers?.count ?? 0)} follower{(followers?.count ?? 0) === 1 ? "" : "s"}</span>
                  <FollowButton creatorId={creatorId} />
                </>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_280px]">
            <section>
              {profile.bio && <p className="text-sm text-fg-dim">{profile.bio}</p>}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {profile.social_links?.github && <SocialLink icon={<Github className="h-3.5 w-3.5" />} href={profile.social_links.github}>GitHub</SocialLink>}
                {profile.social_links?.twitter && <SocialLink icon={<Twitter className="h-3.5 w-3.5" />} href={profile.social_links.twitter}>Twitter</SocialLink>}
                {profile.social_links?.linkedin && <SocialLink icon={<Linkedin className="h-3.5 w-3.5" />} href={profile.social_links.linkedin}>LinkedIn</SocialLink>}
                {profile.social_links?.website && <SocialLink icon={<Globe className="h-3.5 w-3.5" />} href={profile.social_links.website}>Website</SocialLink>}
              </div>

              {isCreator && (
                <>
                  <h2 className="mt-10 heading-3">Published courses</h2>
                  {(courses || []).length === 0 ? (
                    <div className="card mt-4 text-center text-fg-dim">No published courses yet.</div>
                  ) : (
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      {(courses || []).map((c) => <CourseCard key={c.id} course={c} />)}
                    </div>
                  )}
                </>
              )}
            </section>

            <aside className="space-y-4">
              <div className="card">
                <h3 className="text-xs font-bold uppercase tracking-widest text-fg-dim">Roles</h3>
                <div className="mt-2 flex flex-wrap gap-1">
                  {roles?.map((r) => <span key={r} className="chip capitalize">{r}</span>)}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function SocialLink({ icon, children, href }: { icon: React.ReactNode; children: React.ReactNode; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-fg-dim hover:text-fg hover:border-brand transition">
      {icon} {children}
    </a>
  );
}
