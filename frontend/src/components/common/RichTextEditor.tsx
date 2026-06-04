"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, ImagePlus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

function TBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded p-1 transition hover:bg-surface-2 ${active ? "bg-surface-2 text-brand" : "text-fg-dim hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

/**
 * Google-Docs-style WYSIWYG for quiz prompts/options/explanations. Bold/italic/
 * lists + inline images. Images upload to the public course-assets bucket via
 * /courses/uploads/rich-image (counted toward the creator's storage quota) and
 * are embedded as a permanent <img src>. Stores/emits sanitizable HTML.
 */
export function RichTextEditor({
  value, onChange, placeholder, nodeId, minHeight = 40,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  nodeId?: string;
  minHeight?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Track the last HTML we emitted so external value changes (e.g. bulk import)
  // re-sync the editor without clobbering in-progress typing or looping.
  const lastEmitted = useRef<string>(value);

  const editor = useEditor({
    immediatelyRender: false, // required for Next.js SSR (no hydration mismatch)
    extensions: [
      StarterKit,
      Image.configure({ inline: false, HTMLAttributes: { class: "rich-img" } }),
      Placeholder.configure({ placeholder: placeholder || "Write…" }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value || "");
    }
  }, [value, editor]);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editor) return;
    setErr(null);
    setUploading(true);
    try {
      const { url } = await api.courses.uploadRichImage(file, nodeId);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!editor) {
    return <div className="rounded-lg border border-border bg-surface" style={{ minHeight: minHeight + 30 }} />;
  }

  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-brand">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <TBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-3.5 w-3.5" /></TBtn>
        <TBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-3.5 w-3.5" /></TBtn>
        <TBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="h-3.5 w-3.5" /></TBtn>
        <TBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></TBtn>
        <button
          type="button"
          title="Insert image"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded p-1 text-fg-dim transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPickImage} />
      </div>
      <div style={{ minHeight }}>
        <EditorContent editor={editor} className="rich-editor px-3 py-2 text-sm" />
      </div>
      {err && <p className="px-3 pb-1 text-xs text-danger">{err}</p>}
    </div>
  );
}
