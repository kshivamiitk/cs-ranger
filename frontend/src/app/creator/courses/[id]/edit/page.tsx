"use client";

import { useParams } from "next/navigation";
import { CourseBuilder } from "@/components/creator/CourseBuilder";

export default function EditCoursePage() {
  const params = useParams<{ id: string }>();
  return <CourseBuilder courseId={params.id} />;
}
