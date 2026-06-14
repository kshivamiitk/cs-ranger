"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Player } from "./Player";
import { api } from "@/lib/api";
import { flattenCourseNodes } from "@/lib/courseTree";

export default function CoursePlayerPage() {
  const params = useParams<{ id: string; nodeId: string }>();
  // The player needs FULL lesson bodies (markdown, quiz payloads, embeds), so it uses
  // GET /:id rather than the lightweight /detail outline the public course page uses.
  // Distinct cache key keeps the two payloads from clobbering each other.
  const { data: course, isLoading, error } = useQuery({
    queryKey: ["course-content", params.id],
    queryFn: () => api.courses.get(params.id),
    enabled: !!params.id,
  });

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-dim" /></div>;
  if (error || !course) return <div className="p-10 text-center text-fg-dim">Course not found.</div>;

  const allNodes = flattenCourseNodes(course);
  const node = allNodes.find((n) => n.id === params.nodeId) ?? allNodes[0];
  if (!node) return <div className="p-10 text-center text-fg-dim">No content yet in this course.</div>;
  return <Player course={course} initialNodeId={node.id} />;
}
