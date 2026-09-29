import { Clapperboard, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { requireOperator } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await requireOperator();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Clapperboard className="size-4" />
            </span>
            <span className="hidden sm:inline">Lumen Cloud</span>
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
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
