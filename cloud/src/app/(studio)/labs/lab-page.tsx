import { PageHeader } from "@/components/page-header";
import { LABS, toolsFor, type LabId } from "@/creator/catalog";
import { prisma } from "@/lib/prisma";
import { recentLabReports } from "@/services/labsAutomation";
import { LabWorkspace } from "./lab-workspace";
import { ReportList } from "./report-list";

/** Shared server page for the three Creator tabs. */
export async function LabPage({ lab, tool }: { lab: LabId; tool?: string }) {
  const labTools = toolsFor(lab).map((t) => t.id);
  const [channels, projects, reports] = await Promise.all([
    prisma.channel.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, niche: true, performanceNotes: true, oauthRefreshTokenEnc: true, autoLabs: true, autopilot: true } }),
    prisma.videoProject.findMany({
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: { id: true, channelId: true, title: true, topic: true, status: true },
    }),
    recentLabReports(labTools, 15),
  ]);
  const info = LABS[lab];
  return (
    <>
      <PageHeader title={info.title} description={info.blurb} />
      <LabWorkspace
        tools={toolsFor(lab)}
        initialTool={tool}
        channels={channels.map((c) => ({ id: c.id, name: c.name, niche: c.niche, learned: Boolean(c.performanceNotes), youtubeConnected: Boolean(c.oauthRefreshTokenEnc) }))}
        projects={projects.map((p) => ({ id: p.id, channelId: p.channelId, label: p.title ?? p.topic, published: p.status === "PUBLISHED" }))}
      />
      <ReportList
        automaticOn={channels.some((c) => c.autoLabs && c.autopilot)}
        reports={reports.map((r) => ({ id: r.id, toolId: r.toolId, channel: r.channel.name, automatic: r.automatic, summary: r.summary, markdown: r.markdown, createdAt: r.createdAt, projectId: r.projectId }))}
      />
      <p className="mt-10 text-xs text-muted-foreground">
        Built on{" "}
        <a href="https://github.com/Jakeschincariol/youtube-agent-skill" className="underline underline-offset-4" target="_blank" rel="noreferrer">
          youtube-agent-skill
        </a>{" "}
        by Jake Schincariol (MIT), adapted to your channel with Gemini. Scores are heuristics, not predictions.
      </p>
    </>
  );
}
