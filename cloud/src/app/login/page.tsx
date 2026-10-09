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
    <main className="relative grid min-h-screen place-items-center px-4">
      <div className="aurora" aria-hidden />
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 text-center">
          <span className="bg-brand mx-auto grid size-14 place-items-center rounded-2xl text-white shadow-[0_0_48px_-6px_oklch(0.62_0.24_310/80%)]">
            <Clapperboard className="size-7" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Lumen <span className="text-gradient">Cloud</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your zero-cost YouTube studio, on autopilot</p>
        </div>
        <div className="glass rounded-2xl border p-5">
          <LoginForm next={safeNextPath(next)} configError={authConfigError()} />
        </div>
        <PolicyFooter className="mt-10" />
      </div>
    </main>
  );
}
