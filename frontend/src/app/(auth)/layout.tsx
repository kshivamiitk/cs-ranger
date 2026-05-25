import { Logo } from "@/components/common/Logo";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[40rem] w-[40rem] rounded-full bg-brand/20 blur-[120px]" />
        <div className="absolute -right-32 bottom-0 h-[40rem] w-[40rem] rounded-full bg-brand-accent/20 blur-[120px]" />
      </div>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/" className="text-sm text-fg-dim hover:text-fg">← Back home</Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col items-stretch justify-center px-6 pb-16 pt-8">
        {children}
      </main>
    </div>
  );
}
