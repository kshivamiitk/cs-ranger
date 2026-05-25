import { describe, expect, it } from "vitest";
import { VideoChapters, VideoSubtitles, NodeVideoExtras } from "../course-service/src/validation";

describe("VideoChapters validation", () => {
  it("accepts an ascending chapter list starting at 0", () => {
    const result = VideoChapters.safeParse([
      { title: "Introduction", seconds: 0 },
      { title: "Setting up", seconds: 95 },
      { title: "Deep dive", seconds: 240 },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an empty list", () => {
    expect(VideoChapters.safeParse([]).success).toBe(true);
  });

  it("rejects out-of-order timestamps", () => {
    const result = VideoChapters.safeParse([
      { title: "Intro", seconds: 0 },
      { title: "Later", seconds: 120 },
      { title: "Earlier", seconds: 60 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("strictly increasing");
  });

  it("rejects duplicate timestamps", () => {
    const result = VideoChapters.safeParse([
      { title: "A", seconds: 30 },
      { title: "B", seconds: 30 },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects negative or fractional seconds and empty titles", () => {
    expect(VideoChapters.safeParse([{ title: "Bad", seconds: -5 }]).success).toBe(false);
    expect(VideoChapters.safeParse([{ title: "Bad", seconds: 1.5 }]).success).toBe(false);
    expect(VideoChapters.safeParse([{ title: "", seconds: 0 }]).success).toBe(false);
  });
});

describe("VideoSubtitles validation", () => {
  it("accepts vtt and srt tracks with valid URLs", () => {
    const result = VideoSubtitles.safeParse([
      { label: "English", lang: "en", url: "https://cdn.example.com/captions/en.vtt", format: "vtt" },
      { label: "हिन्दी", lang: "hi", url: "https://cdn.example.com/captions/hi.srt", format: "srt" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects unknown formats and non-URL sources", () => {
    expect(VideoSubtitles.safeParse([{ label: "English", lang: "en", url: "https://x.test/en.sub", format: "sub" }]).success).toBe(false);
    expect(VideoSubtitles.safeParse([{ label: "English", lang: "en", url: "not-a-url", format: "vtt" }]).success).toBe(false);
  });

  it("rejects entries missing a label or language", () => {
    expect(VideoSubtitles.safeParse([{ label: "", lang: "en", url: "https://x.test/en.vtt", format: "vtt" }]).success).toBe(false);
    expect(VideoSubtitles.safeParse([{ label: "English", lang: "e", url: "https://x.test/en.vtt", format: "vtt" }]).success).toBe(false);
  });
});

describe("NodeVideoExtras (PATCH /nodes/:id guard)", () => {
  it("passes a patch without video extras untouched", () => {
    expect(NodeVideoExtras.safeParse({ title: "Renamed lesson", position: 3 }).success).toBe(true);
  });

  it("allows null to clear chapters or subtitles", () => {
    expect(NodeVideoExtras.safeParse({ video_chapters: null, video_subtitles: null }).success).toBe(true);
  });

  it("rejects a patch with malformed chapters", () => {
    const result = NodeVideoExtras.safeParse({ video_chapters: [{ title: "x", seconds: 10 }, { title: "y", seconds: 5 }] });
    expect(result.success).toBe(false);
  });
});
