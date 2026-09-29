import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/**
 * Server-side session checks. proxy.ts already gates every page and API route; server actions
 * and route handlers check again so a matcher mistake can never expose a mutation.
 */
export async function isOperator(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function requireOperator(): Promise<void> {
  if (!(await isOperator())) redirect("/login");
}
