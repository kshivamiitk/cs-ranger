"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";

export default function AdminCategoriesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["categories"], queryFn: () => api.courses.categories() });
  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-2">Categories</h1>
            <p className="mt-1 text-sm text-fg-dim">Used for catalog filters and course classification.</p>
          </div>
          <button className="btn-primary text-sm"><Plus className="h-4 w-4" /> New category</button>
        </div>
        {isLoading ? (
          <div className="mt-6 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="mt-6 card divide-y divide-border p-0">
            {(data || []).length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">No categories yet.</p>
            ) : (data || []).map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-4">
                <span className="text-2xl">{c.icon}</span>
                <div className="flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs font-mono text-fg-dim">/{c.slug}</p>
                </div>
                <button className="text-xs text-fg-dim hover:text-fg"><Pencil className="h-4 w-4" /></button>
                <button className="text-xs text-fg-dim hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
