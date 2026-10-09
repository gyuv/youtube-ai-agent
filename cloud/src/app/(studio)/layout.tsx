import { Clapperboard, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { PolicyFooter } from "@/components/policy-footer";
import { Button, buttonVariants } from "@/components/ui/button";
import { requireOperator } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await requireOperator();
  return (
    <div className="relative min-h-screen">
      <div className="aurora" aria-hidden />
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5">
        <div className="glass mx-auto flex h-14 max-w-7xl items-center gap-3 rounded-2xl border px-3 sm:gap-4 sm:px-4">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 font-semibold tracking-tight">
            <span className="bg-brand relative grid size-8 place-items-center rounded-xl text-white shadow-[0_0_24px_-4px_oklch(0.62_0.24_310/80%)] transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-105">
              <Clapperboard className="size-4" />
            </span>
            <span className="hidden sm:inline">
              Lumen <span className="text-gradient">Cloud</span>
            </span>
          </Link>
          <AppNav />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/projects/new" className={buttonVariants({ size: "sm" })}>
              <Plus />
              <span className="hidden sm:inline">New video</span>
            </Link>
            <form action={logout}>
              <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
      <PolicyFooter className="mx-auto max-w-7xl border-t border-white/5 px-4 py-6 sm:px-6" />
    </div>
  );
}
