"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { formatINR, formatCompact } from "@/lib/utils";

export default function AdminCoursesPage() {
  // All statuses (draft / under_review / published / archived) — not the published-only catalog list.
  const { data, isLoading } = useQuery({ queryKey: ["admin-courses"], queryFn: () => api.courses.adminList({}) });

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">All Courses</h1>
        <p className="mt-1 text-sm text-fg-dim">{(data || []).length} total · platform-wide management</p>

        {isLoading ? (
          <div className="mt-6 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="mt-6 card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr><th className="p-3">Course</th><th className="p-3">Status</th><th className="p-3">Students</th><th className="p-3">Price</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {(data || []).length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-fg-dim">No courses yet.</td></tr>
                ) : (data || []).map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3 font-medium">{c.title}</td>
                    <td className="p-3"><span className={`chip capitalize ${c.status === "published" ? "border-success/30 text-success" : "border-border"}`}>{c.status}</span></td>
                    <td className="p-3 tabular-nums">{formatCompact(c.enrollment_count || 0)}</td>
                    <td className="p-3 tabular-nums">{!c.price || c.price === 0 ? "Free" : formatINR(c.discounted_price || c.price)}</td>
                    <td className="p-3 text-right"><button className="text-xs text-brand">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
