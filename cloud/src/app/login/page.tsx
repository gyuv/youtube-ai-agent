import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { PolicyFooter } from "@/components/policy-footer";
import { authConfigError, safeNextPath } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Lumen Cloud" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Lumen Cloud</h1>
            <p className="text-sm text-muted-foreground">Zero-cost YouTube studio</p>
          </div>
        </div>
        <LoginForm next={safeNextPath(next)} configError={authConfigError()} />
        <PolicyFooter className="mt-10" />
      </div>
    </main>
  );
}
