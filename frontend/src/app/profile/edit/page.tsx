"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { FileUpload } from "@/components/common/FileUpload";
import { api } from "@/lib/api";
import { meQueryOptions } from "@/lib/queries";
import { useApp } from "@/app/providers";

export default function EditProfilePage() {
  const qc = useQueryClient();
  const { setUser } = useApp();
  // Reuses the shared ["me"] cache primed at app bootstrap — no duplicate /users/me fetch.
  const { data: me, isLoading } = useQuery(meQueryOptions);
  const [form, setForm] = useState({ displayName: "", username: "", bio: "", college: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me) setForm({
      displayName: me.display_name || me.displayName || "",
      username: me.username || "",
      bio: me.bio || "",
      college: me.college || "",
    });
  }, [me]);

  const save = useMutation({
    mutationFn: () => api.users.updateMe({ displayName: form.displayName, username: form.username, bio: form.bio, college: form.college }),
    onSuccess: (updated) => {
      // Keep the shared cache and the global app context in sync so the navbar/avatar
      // reflect the change without another round trip.
      qc.setQueryData(meQueryOptions.queryKey, (prev) => ({ ...prev, ...updated }));
      setUser({ ...me, ...updated });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  if (isLoading || !me) return <><Navbar /><div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div></>;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <h1 className="heading-2">Edit profile</h1>
        <p className="mt-1 text-sm text-fg-dim">Your public information.</p>

        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="mt-8 space-y-6">
          <div className="card flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar name={me.display_name || me.displayName || "U"} src={me.avatar_url || me.avatarUrl} size={72} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Profile photo</p>
              <div className="mt-2">
                <FileUpload
                  compact
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  maxBytes={2 * 1024 * 1024}
                  hint="JPG / PNG / WEBP / GIF · max 2 MB"
                  onUpload={async (file, onProgress) => {
                    const result = await api.users.uploadAvatar(file, onProgress);
                    qc.setQueryData(meQueryOptions.queryKey, (prev) => (prev ? { ...prev, avatar_url: result.url } : prev));
                    setUser({ ...me, avatar_url: result.url });
                  }}
                />
              </div>
            </div>
          </div>

          <Section title="Basics">
            <Field label="Display name"><input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="input" /></Field>
            <Field label="Username" hint="3–30 chars, lowercase, alphanumeric + underscore"><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} className="input" /></Field>
            <Field label="Bio"><textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="input min-h-[80px]" /></Field>
            <Field label="College / Institution"><input value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} className="input" /></Field>
          </Section>

          {error && <div className="text-sm text-danger">{error}</div>}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost">Cancel</button>
            <button type="submit" disabled={save.isPending} className="btn-primary">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="mb-4 font-display font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-dim">{hint}</span>}
    </label>
  );
}
