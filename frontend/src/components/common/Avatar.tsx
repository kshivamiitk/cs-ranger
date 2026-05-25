import { cn, initials } from "@/lib/utils";

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-medium">{initials(name)}</span>
      )}
    </span>
  );
}
