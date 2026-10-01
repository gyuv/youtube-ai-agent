import type { Chapter, Cut, HookScore, Outlier, RetentionReport, TitleLint } from "@/creator/tools";
import { HOOK_FIX, mmss } from "@/creator/tools";
import { cn } from "@/lib/utils";

/** The computed half of a tool run, shown as tables above the written result. */

const band = (v: number) => (v >= 72 ? "text-emerald-600 dark:text-emerald-400" : v >= 55 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function HookTable({ scores }: { scores: HookScore[] }) {
  return (
    <Section title="Hooks, scored (hookscore heuristics)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">Hook</th>
              <th className="px-2">Score</th>
              <th className="px-2">Formula</th>
              <th className="px-2">Weakest</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-2 pr-2">{s.hook}</td>
                <td className={cn("px-2 py-2 font-semibold tabular-nums", band(s.verdict))}>
                  {s.verdict} <span className="text-xs font-normal">{s.band}</span>
                </td>
                <td className="px-2 py-2 text-xs">{s.formula}</td>
                <td className="px-2 py-2 text-xs" title={HOOK_FIX[s.weakest]}>
                  {s.weakest.toLowerCase()} ({s.properties[s.weakest]}): {HOOK_FIX[s.weakest]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function TitleCard({ lint, label }: { lint: TitleLint; label: string }) {
  return (
    <Section title={label}>
      <p className="text-sm">
        &ldquo;{lint.title}&rdquo; <span className={cn("ml-2 font-semibold", band(lint.score))}>{lint.score}/100</span>
      </p>
      <ul className="grid gap-1 text-sm">
        {lint.issues.map((i, k) => (
          <li key={k} className="text-red-600 dark:text-red-400">✗ {i.message}</li>
        ))}
        {lint.good.map((g, k) => (
          <li key={k} className="text-emerald-600 dark:text-emerald-400">✓ {g}</li>
        ))}
      </ul>
    </Section>
  );
}

export function ToolData({ data }: { data: Record<string, unknown> }) {
  const blocks: React.ReactNode[] = [];
  if (Array.isArray(data.hookScores)) blocks.push(<HookTable key="hooks" scores={data.hookScores as HookScore[]} />);
  if (data.titleLint) blocks.push(<TitleCard key="t1" lint={data.titleLint as TitleLint} label="Your title, linted" />);
  if (data.recommendedTitleLint) blocks.push(<TitleCard key="t2" lint={data.recommendedTitleLint as TitleLint} label="Recommended title, linted" />);

  const edl = data.edl as { duration: number; cuts: Cut[]; removed: number; out: number } | undefined;
  if (edl)
    blocks.push(
      <Section key="edl" title={`Edit decision list: ${edl.cuts.length} cuts, ${edl.removed.toFixed(1)}s removed, ${edl.out.toFixed(1)}s out of ${edl.duration.toFixed(1)}s`}>
        <ul className="grid max-h-72 gap-1 overflow-y-auto font-mono text-xs">
          {edl.cuts.map((c, i) => (
            <li key={i}>
              {c.kind.padEnd(6)} {mmss(c.start)} → {mmss(c.end)} ({(c.end - c.start).toFixed(2)}s) {c.why}
            </li>
          ))}
          {!edl.cuts.length ? <li>Nothing to cut.</li> : null}
        </ul>
      </Section>,
    );

  const ch = data.chapters as { valid: boolean; chapters: Chapter[] } | undefined;
  if (ch)
    blocks.push(
      <Section key="ch" title={ch.valid ? "Draft chapters (valid for YouTube)" : "Draft chapters: NOT valid yet (needs 0:00 first, 3+, 10 s each)"}>
        <pre className="text-xs">{ch.chapters.map((c) => `${c.label} ${c.draftTitle}`).join("\n")}</pre>
      </Section>,
    );

  const r = data.retention as RetentionReport | undefined;
  if (r)
    blocks.push(
      <Section key="ret" title={`Retention: ${r.start.toFixed(0)}% → ${r.end.toFixed(0)}% over ${r.points} points`}>
        <p className="text-sm">
          Hook leak <strong>{r.hookLeak.toFixed(1)}%</strong> <span className={r.verdict === "healthy" ? "text-emerald-600" : "text-red-600"}>({r.verdict})</span> · slide{" "}
          {r.slide}% per unit
        </p>
        <ul className="grid gap-1 text-sm">
          {r.cliffs.map((c, i) => (
            <li key={i}>
              −{c.lost.toFixed(1)}% at {c.atSeconds !== null ? `${mmss(c.atSeconds)}` : c.from}
              {c.said ? <span className="text-muted-foreground"> — &ldquo;{c.said}&rdquo;</span> : null}
            </li>
          ))}
        </ul>
      </Section>,
    );

  const sw = data.swipe as { outliers: Outlier[]; thin: Array<[string, number]>; formulas: Array<[string, number]> } | undefined;
  if (sw)
    blocks.push(
      <Section key="sw" title={`Outliers: ${sw.outliers.length} videos that beat their own channel's median${data.collected ? ` (from ${String(data.collected)} collected)` : ""}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {sw.outliers.slice(0, 20).map((o, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="py-1.5 pr-2 font-semibold tabular-nums">{o.multiple}×</td>
                  <td className="pr-2">
                    {o.url ? (
                      <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">{o.title}</a>
                    ) : (
                      o.title
                    )}
                    <div className="text-xs text-muted-foreground">
                      {o.channel} · {o.views.toLocaleString("en-IN")} vs {o.median.toLocaleString("en-IN")} median · {o.formula}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sw.thin.length ? <p className="text-xs text-muted-foreground">Skipped channels with under 4 videos: {sw.thin.map(([c, n]) => `${c} (${n})`).join(", ")}</p> : null}
      </Section>,
    );

  const own = data.ownOutliers as { outliers: Outlier[] } | null | undefined;
  if (data.videosWithStats !== undefined)
    blocks.push(
      <Section key="own" title={`Your videos with stats: ${String(data.videosWithStats)}`}>
        {own?.outliers.length ? (
          <ul className="grid gap-1 text-sm">
            {own.outliers.slice(0, 8).map((o, i) => (
              <li key={i}>
                <strong>{o.multiple}×</strong> your median: {o.title} <span className="text-xs text-muted-foreground">({o.formula})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Stats arrive once the autopilot has read them (daily, after videos are published).</p>
        )}
      </Section>,
    );

  return blocks.length ? <div className="grid gap-3">{blocks}</div> : null;
}
