import { z } from "zod";

// Chapters must be strictly ascending so the player can map
// "current time → chapter" without sorting or de-duplicating client-side.
export const VideoChapters = z
  .array(
    z.object({
      title: z.string().min(1).max(120),
      seconds: z.number().int().min(0),
    }),
  )
  .max(100)
  .refine(
    (chapters) => chapters.every((c, i) => i === 0 || c.seconds > chapters[i - 1].seconds),
    { message: "Chapter timestamps must be strictly increasing" },
  );

export const VideoSubtitles = z
  .array(
    z.object({
      label: z.string().min(1).max(80),
      lang: z.string().min(2).max(10),
      url: z.string().url().max(500),
      format: z.enum(["vtt", "srt"]),
    }),
  )
  .max(20);

// PATCH /nodes/:id is otherwise free-form column updates; only the structured
// video extras need shape validation. null clears the field.
export const NodeVideoExtras = z.object({
  video_chapters: VideoChapters.nullable().optional(),
  video_subtitles: VideoSubtitles.nullable().optional(),
});
