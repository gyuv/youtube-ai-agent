import type { Metadata } from "next";
import { LabPage } from "../labs/lab-page";

export const metadata: Metadata = { title: "Edit Lab" };
export const dynamic = "force-dynamic";
// Tool runs call Gemini (and, for Viral, YouTube search) from server actions on this page.
export const maxDuration = 300;

export default async function Page({ searchParams }: { searchParams: Promise<{ tool?: string }> }) {
  const { tool } = await searchParams;
  return <LabPage lab="edit" tool={tool} />;
}
