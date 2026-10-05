"use client";

import { ChevronDown, Copy, Download, LoaderCircle, RefreshCw, Search, Sparkles, WrapText } from "lucide-react";
import { useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form-controls";
import type { ResearchVideo, Transcript } from "@/services/videoResearch";
import { lookupAction, transcriptAction, videoFromResearchAction, type LookupResult } from "./actions";

const LANGUAGES: Array<[string, string]> = [
  ["", "Automatic"],
  ["en", "English"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
];

const RETRY_SECONDS = 120;
const n = new Intl.NumberFormat("en", { notation: "compact" });

function formatDuration(s: number | null): string {
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80).trim() || "transcript";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Could not copy.");
  }
}

export function ResearchWorkspace({ channels }: { channels: Array<{ id: string; name: string }> }) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(async () => {
      const r = await lookupAction(url);
      if (r.ok) {
        setResult(r.data);
        setError(null);
      } else setError(r.error);
    });
  };

  return (
    <div className="grid gap-6">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube video, Short or playlist link" aria-label="YouTube link" required />
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Search />}
          Analyse
        </Button>
      </form>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="col-span-2 col-start-1">{error}</AlertDescription>
        </Alert>
      ) : null}

      {result?.kind === "video" ? <VideoPanel key={result.video.id} video={result.video} channels={channels} /> : null}
      {result?.kind === "playlist" ? (
        <div className="grid gap-3">
          <div>
            <h2 className="text-lg font-semibold">{result.playlist.title}</h2>
            <p className="text-sm text-muted-foreground">
              {result.playlist.channel} · {result.playlist.videos.length} videos ·{" "}
              {formatDuration(result.playlist.videos.reduce((sum, v) => sum + (v.durationSeconds ?? 0), 0))} total
            </p>
          </div>
          <PlaylistExport playlist={result.playlist} />
          {result.playlist.videos.map((v) => (
            <details key={v.id} className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {v.thumbnail ? <img src={v.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded object-cover" /> : null}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.title}</span>
                <span className="text-xs text-muted-foreground">{formatDuration(v.durationSeconds)}</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t p-3">
                <VideoPanel video={v} channels={channels} compact />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Fetch every playlist transcript in turn and download them as one TXT file. */
function PlaylistExport({ playlist }: { playlist: { title: string; videos: ResearchVideo[] } }) {
  const [progress, setProgress] = useState<string | null>(null);
  const run = async () => {
    const parts: string[] = [];
    let ok = 0;
    for (const [i, v] of playlist.videos.entries()) {
      setProgress(`${i + 1}/${playlist.videos.length}`);
      const r = await transcriptAction(v.id, "");
      parts.push(`# ${v.title}\nhttps://youtu.be/${v.id}\n\n${r.ok ? r.data.text : `(no transcript: ${r.error})`}`);
      if (r.ok) ok += 1;
      if (!r.ok && r.reason === "BLOCKED") {
        toast.error("YouTube is rate-limiting; exported what was fetched so far.");
        break;
      }
    }
    downloadText(`${safeName(playlist.title)}.txt`, parts.join("\n\n---\n\n"));
    toast.success(`Exported ${ok} transcripts.`);
    setProgress(null);
  };
  return (
    <div>
      <Button variant="outline" size="sm" onClick={run} disabled={progress !== null}>
        {progress ? <LoaderCircle className="animate-spin" /> : <Download />}
        {progress ? `Fetching ${progress}` : "Export all transcripts (TXT)"}
      </Button>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

function VideoPanel({ video, channels, compact = false }: { video: ResearchVideo; channels: Array<{ id: string; name: string }>; compact?: boolean }) {
  const [language, setLanguage] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [tError, setTError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [loading, startLoading] = useTransition();
  const [creating, startCreating] = useTransition();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");

  useEffect(() => {
    if (retryIn <= 0) return;
    const t = setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [retryIn]);

  const fetchTranscript = (refresh = false) =>
    startLoading(async () => {
      const r = await transcriptAction(video.id, language, refresh);
      if (r.ok) {
        setTranscript(r.data);
        setTError(null);
      } else {
        setTError(r.error);
        if (r.reason === "BLOCKED") setRetryIn(RETRY_SECONDS);
      }
    });

  const makeVideo = () =>
    startCreating(async () => {
      const topic = `Inspired by "${video.title}"${transcript ? `. Key points from it: ${transcript.text.slice(0, 380)}` : ""}`;
      const r = await videoFromResearchAction(channelId, topic);
      if (r && !r.ok) toast.error(r.error);
    });

  return (
    <Card>
      <CardContent className="grid gap-5">
        {!compact ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {video.thumbnail ? <img src={video.thumbnail} alt="" className="aspect-video w-full rounded-md object-cover sm:w-64" /> : null}
            <div className="min-w-0 flex-1">
              <a href={`https://youtu.be/${video.id}`} target="_blank" rel="noreferrer" className="text-lg font-semibold hover:underline">
                {video.title}
              </a>
              <p className="text-sm text-muted-foreground">{video.channel}</p>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
                <Stat label="Duration">{formatDuration(video.durationSeconds) || "—"}</Stat>
                <Stat label="Published">{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : "—"}</Stat>
                <Stat label="Views">{video.views != null ? n.format(video.views) : "—"}</Stat>
                <Stat label="Likes">{video.likes != null ? n.format(video.likes) : "—"}</Stat>
                <Stat label="Comments">{video.comments != null ? n.format(video.comments) : "—"}</Stat>
                <Stat label="Like rate">{video.views && video.likes != null ? `${((video.likes / video.views) * 100).toFixed(1)}%` : "—"}</Stat>
              </div>
              {video.tags.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {video.tags.slice(0, 20).map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`lang-${video.id}`}>Transcript language</Label>
            <Select id={`lang-${video.id}`} value={language} onChange={(e) => setLanguage(e.target.value)} className="w-44">
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </Select>
          </div>
          <Button onClick={() => fetchTranscript(Boolean(transcript))} disabled={loading || retryIn > 0}>
            {loading ? <LoaderCircle className="animate-spin" /> : transcript ? <RefreshCw /> : <Sparkles />}
            {retryIn > 0 ? `Retry in ${Math.floor(retryIn / 60)}:${String(retryIn % 60).padStart(2, "0")}` : transcript ? "Refetch" : "Get transcript"}
          </Button>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">If there are no captions in that language, YouTube&apos;s own translation is used.</p>

        {tError ? (
          <Alert variant="destructive">
            <AlertDescription className="col-span-2 col-start-1">{tError}</AlertDescription>
          </Alert>
        ) : null}
        {transcript ? <TranscriptView transcript={transcript} title={video.title} /> : null}

        {channels.length ? (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`ch-${video.id}`}>Make a video like this for</Label>
              <Select id={`ch-${video.id}`} value={channelId} onChange={(e) => setChannelId(e.target.value)} className="w-56">
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <Button variant="outline" onClick={makeVideo} disabled={creating || !channelId}>
              {creating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Create video project
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLocaleLowerCase();
  const q = query.toLocaleLowerCase();
  const out: ReactNode[] = [];
  let cursor = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, cursor)) {
    out.push(text.slice(cursor, i), <mark key={i} className="rounded bg-yellow-300/70 text-foreground">{text.slice(i, i + q.length)}</mark>);
    cursor = i + q.length;
  }
  out.push(text.slice(cursor));
  return out;
}

/** Sentences grouped three to a paragraph, like OmniTube's reading mode. */
export function toParagraphs(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i, i + 3).join("").trim());
  return out.filter(Boolean);
}

function TranscriptView({ transcript, title }: { transcript: Transcript; title: string }) {
  const [query, setQuery] = useState("");
  const [paragraphs, setParagraphs] = useState(true);
  const [scale, setScale] = useState(1);
  const words = useMemo(() => transcript.text.split(/\s+/).filter(Boolean).length, [transcript.text]);
  const q = query.trim();
  const matches = q ? transcript.text.toLocaleLowerCase().split(q.toLocaleLowerCase()).length - 1 : 0;
  const blocks = paragraphs ? toParagraphs(transcript.text) : [transcript.text];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{transcript.language}{transcript.translated ? " (translated)" : ""}</Badge>
        {transcript.cached ? <Badge variant="secondary">cached</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {words.toLocaleString()} words · {Math.max(1, Math.ceil(words / 200))} min read
          {q ? ` · ${matches} ${matches === 1 ? "match" : "matches"}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transcript" className="h-8 w-44" aria-label="Search transcript" />
          <Button size="icon-sm" variant={paragraphs ? "secondary" : "ghost"} onClick={() => setParagraphs((p) => !p)} title="Paragraphs" aria-label="Toggle paragraphs">
            <WrapText />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setScale((s) => Math.max(0.8, s - 0.1))} aria-label="Smaller text">A-</Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setScale((s) => Math.min(1.6, s + 0.1))} aria-label="Larger text">A+</Button>
          <Button size="icon-sm" variant="ghost" onClick={() => copy(transcript.text)} title="Copy" aria-label="Copy transcript">
            <Copy />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => downloadText(`${safeName(title)}.txt`, transcript.text)} title="Download TXT" aria-label="Download transcript">
            <Download />
          </Button>
        </div>
      </div>
      <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-muted/30 p-4 leading-relaxed" style={{ fontSize: `${scale * 0.875}rem` }}>
        {blocks.map((b, i) => (
          <p key={i} className="mb-3 last:mb-0">{highlight(b, q)}</p>
        ))}
      </div>
    </div>
  );
}
