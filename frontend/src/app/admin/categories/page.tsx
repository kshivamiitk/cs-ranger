"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type Category } from "@/lib/api";

export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["categories"], queryFn: () => api.courses.categories() });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["categories"] });

  const create = useMutation({
    mutationFn: () => api.courses.createCategory({ name: name.trim(), icon: icon.trim() || undefined }),
    onSuccess: () => { setName(""); setIcon(""); setAdding(false); setErr(null); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not create category"),
  });
  const update = useMutation({
    mutationFn: (c: Category) => api.courses.updateCategory(c.id, { name: editName.trim(), icon: editIcon.trim() || undefined }),
    onSuccess: () => { setEditing(null); setErr(null); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not update category"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.courses.deleteCategory(id),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not delete category"),
  });

  function startEdit(c: Category) {
    setEditing(c.id); setEditName(c.name); setEditIcon(c.icon || ""); setErr(null);
  }

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-2">Categories</h1>
            <p className="mt-1 text-sm text-fg-dim">Used for catalog filters and course classification.</p>
          </div>
          <button className="btn-primary text-sm" onClick={() => { setAdding((v) => !v); setErr(null); }}>
            <Plus className="h-4 w-4" /> New category
          </button>
        </div>

        {err && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">{err}</p>}

        {adding && (
          <div className="mt-4 card flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-fg-dim">Icon (emoji)</span>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📚" className="input w-20 text-center" maxLength={4} />
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="mb-1 block text-xs text-fg-dim">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interview Prep" className="input w-full"
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); }} />
              <span className="mt-1 block text-xs text-fg-dim">Slug auto-generated from the name.</span>
            </label>
            <button className="btn-primary text-sm disabled:opacity-50" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="mt-6 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="mt-6 card divide-y divide-border p-0">
            {(data || []).length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">No categories yet — add your first above.</p>
            ) : (data || []).map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-4">
                {editing === c.id ? (
                  <>
                    <input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} className="input w-16 text-center" maxLength={4} />
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && editName.trim()) update.mutate(c); }} />
                    <button className="text-success hover:opacity-80 disabled:opacity-50" disabled={!editName.trim() || update.isPending} onClick={() => update.mutate(c)} title="Save">
                      {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button className="text-fg-dim hover:text-fg" onClick={() => setEditing(null)} title="Cancel"><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <span className="text-2xl">{c.icon}</span>
                    <div className="flex-1">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs font-mono text-fg-dim">/{c.slug}</p>
                    </div>
                    <button className="text-fg-dim hover:text-fg" onClick={() => startEdit(c)} title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button className="text-fg-dim hover:text-danger disabled:opacity-50" disabled={remove.isPending}
                      onClick={() => { if (confirm(`Delete category "${c.name}"? Courses in it become uncategorized.`)) remove.mutate(c.id); }} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
