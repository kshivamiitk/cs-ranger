"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

function publicCoursePath(courseId: string): string {
  return `/course/${courseId}`;
}

function publicCourseUrl(courseId: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL || "https://learnrift.site").replace(/\/$/, "");
  return `${base}${publicCoursePath(courseId)}`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CourseShareButton({
  courseId,
  label = "Copy link",
  copiedLabel = "Copied",
  variant = "button",
  showViewLink = false,
  className,
  buttonClassName,
}: {
  courseId: string;
  label?: string;
  copiedLabel?: string;
  variant?: "button" | "inline";
  showViewLink?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const path = publicCoursePath(courseId);

  async function onCopy() {
    await copyText(publicCourseUrl(courseId));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const inline = variant === "inline";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          inline ? "inline-flex items-center gap-1 text-xs text-fg-dim hover:text-fg" : "btn-ghost",
          buttonClassName,
        )}
      >
        {copied ? <Check className={inline ? "h-3 w-3" : "h-4 w-4"} /> : <Copy className={inline ? "h-3 w-3" : "h-4 w-4"} />}
        {copied ? copiedLabel : label}
      </button>
      {showViewLink && (
        <Link href={path} className={cn(inline ? "inline-flex items-center gap-1 text-xs text-brand" : "btn-ghost")}>
          <ExternalLink className={inline ? "h-3 w-3" : "h-4 w-4"} />
          View
        </Link>
      )}
    </span>
  );
}
