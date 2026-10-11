import type { Metadata } from "next";
import { MastermindHub } from "@/components/growth/mastermind-hub";
import { LabPage } from "../labs/lab-page";

export const metadata: Metadata = { title: "Growth Lab" };
export const dynamic = "force-dynamic";
// Tool runs and the mastermind call Gemini (and, for Viral, YouTube search) from server actions on this page.
export const maxDuration = 300;

export default async function Page({ searchParams }: { searchParams: Promise<{ tool?: string }> }) {
  const { tool } = await searchParams;
  return (
    <>
      <MastermindHub />
      <LabPage lab="growth" tool={tool} />
    </>
  );
}
