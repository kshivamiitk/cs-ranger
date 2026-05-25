import Link from "next/link";
import { Logo } from "@/components/common/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <Logo />
      <p className="mt-10 font-display text-7xl font-bold gradient-text">404</p>
      <h1 className="mt-2 heading-2">Looks like you're lost</h1>
      <p className="mt-3 max-w-sm text-fg-dim">The page you're looking for doesn't exist — or it moved. Let's get you back somewhere useful.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="btn-primary">Take me home</Link>
        <Link href="/catalog" className="btn-ghost">Browse courses</Link>
      </div>
    </div>
  );
}
