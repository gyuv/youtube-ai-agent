"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { secretsMatch } from "@/lib/crypto";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, authConfigError, createSessionToken, safeNextPath } from "@/lib/session";

export type LoginState = { error: string | null };

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const configError = authConfigError();
  if (configError) return { error: `Login is disabled until the server is configured. ${configError}` };

  const password = String(formData.get("password") ?? "");
  if (!secretsMatch(password, process.env.STUDIO_PASSWORD!)) {
    await new Promise((resolve) => setTimeout(resolve, 800)); // slow down guessing
    return { error: "That password isn't right." };
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
