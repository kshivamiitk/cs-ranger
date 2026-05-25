export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className || ""}`}>
      <div
        className="h-full rounded-full bg-brand-gradient transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
