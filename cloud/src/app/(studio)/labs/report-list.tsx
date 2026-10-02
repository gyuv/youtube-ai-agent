import { timeAgo } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findTool } from "@/creator/catalog";
import { Markdown } from "./markdown";

export interface ReportView {
  id: string;
  toolId: string;
  channel: string;
  automatic: boolean;
  summary: string;
  markdown: string;
  createdAt: Date;
  projectId: string | null;
}

/** Recent Lab runs, automatic and manual, newest first; each expands to the full result. */
export function ReportList({ reports, automaticOn }: { reports: ReportView[]; automaticOn: boolean }) {
  return (
    <Card className="mt-8">
      <CardHeader>
        <div>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription className="mt-1.5">
            {automaticOn
              ? "Creator Labs run on their own for autopilot channels: packaging before each render, and a growth review every week."
              : "Turn on “Run Creator Labs automatically” in a channel's Autopilot settings to have these run on their own."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="grid gap-2">
            {reports.map((r) => (
              <li key={r.id}>
                <details className="rounded-lg border px-3 py-2">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{findTool(r.toolId)?.title ?? r.toolId}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {r.channel} · {r.automatic ? "automatic" : "manual"} · {timeAgo(r.createdAt)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.summary}</span>
                  </summary>
                  <div className="mt-3 border-t pt-3">
                    {r.projectId ? (
                      <a href={`/projects/${r.projectId}`} className="text-xs underline underline-offset-4">
                        Open the video
                      </a>
                    ) : null}
                    <Markdown text={r.markdown} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
