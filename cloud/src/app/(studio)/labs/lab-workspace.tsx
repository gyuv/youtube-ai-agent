"use client";

import { Check, ClipboardCopy, FileUp, LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import type { CreatorTool, ToolField } from "@/creator/catalog";
import { cn } from "@/lib/utils";
import type { ToolRun } from "@/services/creatorStudio";
import { applyToProjectAction, prefillFromProjectAction, runToolAction } from "./actions";
import { Markdown } from "./markdown";
import { ToolData } from "./tool-data";

interface ChannelOption {
  id: string;
  name: string;
  niche: string;
  learned: boolean;
  youtubeConnected: boolean;
}
interface ProjectOption {
  id: string;
  channelId: string;
  label: string;
  published: boolean;
}

export function LabWorkspace({ tools, initialTool, channels, projects }: { tools: CreatorTool[]; initialTool?: string; channels: ChannelOption[]; projects: ProjectOption[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [toolId, setToolId] = useState(tools.find((t) => t.id === initialTool)?.id ?? tools[0].id);
  const tool = tools.find((t) => t.id === toolId)!;
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolRun | null>(null);
  const [running, startRun] = useTransition();
  const [loading, startLoad] = useTransition();
  const [applying, startApply] = useTransition();

  const channel = channels.find((c) => c.id === channelId);
  const channelProjects = projects.filter((p) => p.channelId === channelId);

  const pickTool = (id: string) => {
    setToolId(id);
    setResult(null);
    const next = new URLSearchParams(params.toString());
    next.set("tool", id);
    router.replace(`?${next}`, { scroll: false });
  };
  const pickChannel = (id: string) => {
    setChannelId(id);
    setProjectId("");
    setResult(null);
  };

  const loadProject = (id: string) => {
    setProjectId(id);
    if (!id) return;
    startLoad(async () => {
      const res = await prefillFromProjectAction(id);
      if (!res.ok) return void toast.error(res.error);
      setValues((v) => ({ ...v, ...Object.fromEntries(Object.entries(res.data).filter(([, val]) => val)) }));
      toast.success(res.data.transcript ? "Loaded the video's idea, title and timed transcript" : "Loaded the video's idea and title");
    });
  };

  const run = () =>
    startRun(async () => {
      setResult(null);
      const input = Object.fromEntries(tool.fields.map((f) => [f.name, values[f.name] ?? ""]));
      const res = await runToolAction(tool.id, channelId, input);
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data);
    });

  const apply = () =>
    startApply(async () => {
      if (!result?.apply || !projectId) return;
      const res = await applyToProjectAction(projectId, result.apply);
      if (res.ok) toast.success("Applied to the video. Open it to review before it renders.");
      else toast.error(res.error);
    });

  if (!channels.length) {
    return <p className="text-sm text-muted-foreground">Add a channel first (Channels → New channel). Every tool adapts to a channel&apos;s niche, voice and stats.</p>;
  }

  const missing = tool.fields.some((f) => f.required && !values[f.name]?.trim());
  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="tablist" aria-label="Tools">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === toolId}
            onClick={() => pickTool(t.id)}
            className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", t.id === toolId ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
          >
            {t.title}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{tool.title}</CardTitle>
              <CardDescription className="mt-1.5">{tool.blurb}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="lab-channel">Channel</Label>
              <Select id="lab-channel" value={channelId} onChange={(e) => pickChannel(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {channel ? (
                <p className="text-xs text-muted-foreground">
                  Adapts to: {channel.niche}
                  {channel.learned ? " · using lessons from its YouTube stats" : ""}
                </p>
              ) : null}
            </div>

            {tool.usesProject ? (
              <div className="grid gap-2">
                <Label htmlFor="lab-project">Start from one of your videos (optional)</Label>
                <div className="flex items-center gap-2">
                  <Select id="lab-project" value={projectId} onChange={(e) => loadProject(e.target.value)} className="min-w-0 flex-1">
                    <option value="">None: type it in</option>
                    {channelProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                  {loading ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
                </div>
              </div>
            ) : null}

            {tool.fields.map((field) => (
              <FieldInput key={field.name} field={field} value={values[field.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))} />
            ))}

            {tool.id === "yt-viral" && !values.collected?.trim() && channel && !channel.youtubeConnected ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">Searching YouTube needs this channel connected to YouTube, or paste collected videos instead.</p>
            ) : null}

            <Button onClick={run} disabled={running || missing || !channelId} className="justify-self-start">
              {running ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {running ? "Working… (up to a minute)" : `Run ${tool.title}`}
            </Button>
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4">
          {!result && !running ? (
            <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">The result appears here, written for {channel?.name ?? "your channel"}.</div>
          ) : null}
          {running ? (
            <div className="flex items-center gap-2 rounded-xl border p-8 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Running the heuristics, then writing it in your channel&apos;s voice…
            </div>
          ) : null}
          {result ? (
            <>
              <ToolData data={result.data} />
              <Card>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton text={result.markdown} />
                    {result.apply && Object.values(result.apply).some((v) => (Array.isArray(v) ? v.length : v)) ? (
                      projectId && project && !project.published ? (
                        <Button size="sm" onClick={apply} disabled={applying}>
                          {applying ? <LoaderCircle className="animate-spin" /> : <Wand2 />} Apply to &ldquo;{project.label.slice(0, 40)}&rdquo;
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pick an unpublished video above to apply this to it.</span>
                      )
                    ) : null}
                  </div>
                  <Markdown text={result.markdown} />
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: ToolField; value: string; onChange: (v: string) => void }) {
  const id = `field-${field.name}`;
  const fileTypes = field.kind === "transcript" ? ".srt,.vtt,.json,.txt" : field.kind === "csv" ? ".csv,.txt" : field.kind === "json" ? ".json" : null;
  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return void toast.error("That file is over 2 MB.");
    file.text().then(onChange, () => toast.error("Couldn't read that file."));
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {field.label}
          {field.required ? <span className="text-red-500"> *</span> : null}
        </Label>
        {fileTypes ? (
          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <FileUp className="size-3.5" /> Upload
            <input type="file" accept={fileTypes} className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        ) : null}
      </div>
      {field.kind === "text" ? (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      ) : (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.kind === "textarea" ? 4 : 8}
          className={cn(field.kind !== "textarea" && "font-mono text-xs")}
        />
      )}
      {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("Couldn't copy"),
        )
      }
    >
      {copied ? <Check /> : <ClipboardCopy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}
