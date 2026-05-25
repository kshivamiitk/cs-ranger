"use client";

import type { Heatmap as HeatmapData } from "@/types";

const COLORS = [
  "rgba(148, 163, 184, 0.12)",
  "rgba(167, 139, 250, 0.35)",
  "rgba(167, 139, 250, 0.55)",
  "rgba(167, 139, 250, 0.78)",
  "rgba(34, 211, 238, 0.95)",
];

export function Heatmap({ data }: { data: HeatmapData }) {
  // 52 weeks × 7 days, aligned to Sunday
  const today = new Date();
  const cells: { date: string; value: number }[] = [];
  for (let i = 365; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, value: data[key] || 0 });
  }
  // group into weeks (columns)
  const weeks: typeof cells[] = [];
  let week: typeof cells = [];
  cells.forEach((c, idx) => {
    week.push(c);
    if (week.length === 7 || idx === cells.length - 1) {
      weeks.push(week);
      week = [];
    }
  });

  const total = cells.reduce((s, c) => s + c.value, 0);
  const activeDays = cells.filter((c) => c.value > 0).length;

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-display text-sm font-semibold">Learning Heatmap</p>
          <p className="text-xs text-fg-dim">{activeDays} active days · {total} lessons in the last year</p>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-fg-dim">
          <span>Less</span>
          {COLORS.map((c, i) => (
            <span key={i} className="h-3 w-3 rounded-sm" style={{ background: c }} />
          ))}
          <span>More</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-[3px]">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {w.map((d) => (
                <span
                  key={d.date}
                  title={`${d.date}: ${d.value} lesson${d.value === 1 ? "" : "s"}`}
                  className="h-3 w-3 rounded-sm"
                  style={{ background: COLORS[Math.min(4, d.value)] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
