/**
 * TypeScript ports of the six heuristic tools from youtube-agent-skill (MIT, Jake Schincariol):
 * hookscore.py, title.py, deadair.py, chapters.py, retention.py and swipe.py. Same thresholds and
 * weights as the originals; pure functions, safe to import from client components.
 */
import { HOOKS } from "./vendor";

const words = (t: string, re = /[a-z0-9'%$.]+/g) => t.toLowerCase().match(re) ?? [];
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const count = (re: RegExp, t: string) => (t.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length;

// ─────────────────────────────────────────────────────────────
// hookscore
// ─────────────────────────────────────────────────────────────

const FILLER = new Set("basically actually literally just really very so kind sort like guys hey welcome today video subscribe channel".split(" "));
const VAGUE = new Set("amazing incredible insane crazy huge massive game changer secret powerful ultimate best revolutionary mind blowing unbelievable".split(" "));
const CONCRETE = /\b(\d[\d,.]*\s?(%|k|m|x|s|m|h)?|\$\d|\d+\s?(second|minute|hour|day|week|month|year)s?)\b/gi;
const YOU = /\b(you|your|you're|youre|yourself)\b/gi;
const STAKE = /\b(lose|lost|wasting|waste|quit|fail|broke|cost|risk|before|stop|never|die|dying|dead)\b/gi;
const CURIOSITY = /\b(why|how|what|which|until|before|but|nobody|almost|except|reason|actually)\b/gi;

export const HOOK_FIX: Record<HookProperty, string> = {
  SPECIFICITY: "swap one adjective for a number, a name or a date",
  ADDRESS: "say 'you' in the first six words",
  STAKES: "name what it costs them to keep doing it the current way",
  CURIOSITY: "cut the half of the sentence that answers itself",
  BREVITY: "9 to 24 words. Read it out loud and stop where you run out of breath",
};
export type HookProperty = "SPECIFICITY" | "ADDRESS" | "STAKES" | "CURIOSITY" | "BREVITY";

function specificity(t: string) {
  const w = words(t);
  if (!w.length) return 0;
  const proper = t.split(/\s+/).slice(1).filter((x) => /^[A-Z]/.test(x)).length;
  return clamp(34 + count(CONCRETE, t) * 22 - w.filter((x) => VAGUE.has(x)).length * 16 - w.filter((x) => FILLER.has(x)).length * 5 + Math.min(18, 6 * proper));
}
const address = (t: string) => clamp(26 + count(YOU, t) * 20 + (new RegExp(YOU.source, "i").test(t.split(/\s+/).slice(0, 6).join(" ")) ? 30 : 0));
const stakes = (t: string) => clamp(22 + count(STAKE, t) * 26 + (new RegExp(CONCRETE.source, "i").test(t) ? 14 : 0));
const curiosity = (t: string) =>
  clamp(24 + count(CURIOSITY, t) * 17 + (t.trim().endsWith("?") ? 18 : 0) + (/\b(because|so that|which means)\b/i.test(t) ? -18 : 0));
function brevity(t: string) {
  const n = words(t).length;
  if (!n) return 0;
  if (n >= 9 && n <= 24) return 100;
  return n < 9 ? Math.max(30, 100 - (9 - n) * 11) : Math.max(10, 100 - (n - 24) * 7);
}

export function classifyFormula(text: string): { name: string; matched: number } {
  let best = "Unclassified";
  let hits = 0;
  for (const f of HOOKS.hooks) {
    const n = f.match.filter((p) => new RegExp(p, "i").test(text)).length;
    if (n > hits) [best, hits] = [f.name, n];
  }
  return { name: best, matched: hits };
}

export interface HookScore {
  hook: string;
  properties: Record<HookProperty, number>;
  verdict: number;
  band: "STRONG" | "WORKABLE" | "WEAK";
  formula: string;
  weakest: HookProperty;
}

/** Five properties 0-100; the verdict is 60% the mean and 40% the weakest (a hook leaks at its weakest). */
export function scoreHook(hook: string): HookScore {
  const properties = { SPECIFICITY: specificity(hook), ADDRESS: address(hook), STAKES: stakes(hook), CURIOSITY: curiosity(hook), BREVITY: brevity(hook) };
  const vals = Object.values(properties);
  const verdict = Math.round(0.6 * (vals.reduce((a, b) => a + b, 0) / vals.length) + 0.4 * Math.min(...vals));
  const weakest = (Object.keys(properties) as HookProperty[]).reduce((a, b) => (properties[b] < properties[a] ? b : a));
  return { hook: hook.trim(), properties, verdict, band: verdict >= 72 ? "STRONG" : verdict >= 55 ? "WORKABLE" : "WEAK", formula: classifyFormula(hook).name, weakest };
}

// ─────────────────────────────────────────────────────────────
// title + thumbnail linter
// ─────────────────────────────────────────────────────────────

const T_VAGUE = new Set("amazing incredible insane crazy huge massive ultimate best powerful secret revolutionary mindblowing epic perfect complete everything".split(" "));
const STOP = new Set("the a an of for to in on and or is are with your you my i this that it how what why".split(" "));

export interface TitleLint {
  title: string;
  chars: number;
  score: number;
  issues: Array<{ kind: string; message: string }>;
  good: string[];
}

export function lintTitle(title: string, thumb?: string): TitleLint {
  const t = title.trim();
  const n = t.length;
  const issues: TitleLint["issues"] = [];
  const good: string[] = [];
  const tw = (s: string) => words(s, /[a-z0-9']+/g);
  if (n > 100) issues.push({ kind: "length", message: `${n} characters - YouTube's hard limit is 100` });
  else if (n > 60) issues.push({ kind: "length", message: `${n} characters - desktop search cuts near 60` });
  else good.push(`${n} characters, inside the 60-character desktop cut`);
  if (n > 40) {
    const head = t.slice(0, 40).replace(/\s+\S*$/, "");
    issues.push({ kind: "mobile", message: `a mobile feed shows about "${head}..." - check the subject survives` });
  }
  const caps = t.split(/\s+/).filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (caps.length > 2) issues.push({ kind: "shouting", message: `${caps.length} all-caps words - two is the ceiling before it reads as spam` });
  else if (caps.length) good.push(`${caps.length} all-caps word for emphasis`);
  const vague = [...new Set(tw(t).filter((w) => T_VAGUE.has(w)))].sort();
  if (vague.length) issues.push({ kind: "vague", message: `${vague.join(", ")} - swap for a number, a name or a date` });
  const nums = t.match(/\d[\d,.]*%?/g) ?? [];
  if (nums.length) good.push(`carries a concrete figure (${nums.slice(0, 3).join(", ")})`);
  else issues.push({ kind: "no-number", message: "no number, date or name - the most reliable single fix" });
  if (t.endsWith("?")) good.push("open question in the title");
  if (!tw(t).slice(0, 3).some((w) => !STOP.has(w))) issues.push({ kind: "front-load", message: "the first three words are all filler - move the subject forward" });
  if (thumb?.trim()) {
    const titleWords = new Set(tw(t).filter((w) => !STOP.has(w)));
    const shared = [...new Set(tw(thumb).filter((w) => !STOP.has(w) && titleWords.has(w)))].sort();
    if (shared.length) issues.push({ kind: "duplicate", message: `thumbnail repeats the title on ${shared.join(", ")} - the thumbnail should say what the title does not` });
    else good.push("thumbnail and title carry different words");
    if (tw(thumb).length > 4) issues.push({ kind: "thumb-length", message: `${tw(thumb).length} words on the thumbnail - three is the ceiling at feed size` });
  }
  return { title: t, chars: n, score: clamp(100 - 14 * issues.length + 4 * good.length), issues, good };
}

// ─────────────────────────────────────────────────────────────
// transcripts: srt / vtt / whisper json / studio word timings
// ─────────────────────────────────────────────────────────────

export interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTs(s: string): number {
  const p = s.trim().replace(",", ".").split(":");
  return p.length === 3 ? Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]) : Number(p[0]) * 60 + Number(p[1]);
}

export function parseTranscript(raw: string): Cue[] {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const d = JSON.parse(text) as { segments?: unknown[] } | unknown[];
      const segs = (Array.isArray(d) ? d : (d.segments ?? [])) as Array<{ start: number; end: number; text?: string }>;
      return segs.map((s) => ({ start: Number(s.start), end: Number(s.end), text: (s.text ?? "").trim() })).filter((c) => c.text);
    } catch {
      return [];
    }
  }
  const cues: Array<{ start: number; end: number; lines: string[] }> = [];
  let cur: (typeof cues)[number] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\s*(\d[\d:.,]+)\s*-->\s*(\d[\d:.,]+)/);
    if (m) {
      cur = { start: parseTs(m[1]), end: parseTs(m[2]), lines: [] };
      cues.push(cur);
    } else if (cur && line.trim() && !/^\d+$/.test(line.trim())) {
      cur.lines.push(line.trim());
    }
  }
  return cues.filter((c) => c.lines.length).map((c) => ({ start: c.start, end: c.end, text: c.lines.join(" ") }));
}

/** Studio scenes (narration + edge-tts word timings) as transcript cues, one per sentence. */
export function cuesFromScenes(
  scenes: Array<{ durationSeconds: number; narrationText: string; words: Array<{ word: string; startMs: number; endMs: number }> }>,
  tailSeconds = 0.25,
): Cue[] {
  const cues: Cue[] = [];
  let offset = 0;
  for (const scene of scenes) {
    if (scene.words.length) {
      let sentence: typeof scene.words = [];
      const flush = () => {
        if (!sentence.length) return;
        cues.push({ start: offset + sentence[0].startMs / 1000, end: offset + sentence.at(-1)!.endMs / 1000, text: sentence.map((w) => w.word).join(" ") });
        sentence = [];
      };
      for (const w of scene.words) {
        sentence.push(w);
        if (/[.!?]$/.test(w.word) || sentence.length >= 14) flush();
      }
      flush();
    } else if (scene.narrationText.trim()) {
      cues.push({ start: offset, end: offset + scene.durationSeconds, text: scene.narrationText.trim() });
    }
    offset += scene.durationSeconds + tailSeconds;
  }
  return cues;
}

export function cuesToSrt(cues: Cue[]): string {
  const ts = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}

// ─────────────────────────────────────────────────────────────
// deadair: edit decision list
// ─────────────────────────────────────────────────────────────

const FILLER_ONLY =
  /^[\s,.-]*((um+|uh+|er+|ah+|so|okay|ok|right|yeah|like|anyway|basically|actually|you know|i mean|let me see|hold on)[\s,.-]*)+$/i;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);

export interface Cut {
  kind: "DEAD" | "FILLER" | "REPEAT";
  start: number;
  end: number;
  why: string;
}

export function deadAir(cues: Cue[], floor = 0.45): { duration: number; cuts: Cut[]; removed: number; out: number } {
  if (!cues.length) return { duration: 0, cuts: [], removed: 0, out: 0 };
  const duration = cues.at(-1)!.end;
  const cuts: Cut[] = [];
  cues.forEach((c, i) => {
    if (FILLER_ONLY.test(c.text)) cuts.push({ kind: "FILLER", start: c.start, end: c.end, why: c.text.trim().slice(0, 48) });
    if (i) {
      const gap = c.start - cues[i - 1].end;
      if (gap > floor) {
        const keep = floor / 2;
        cuts.push({ kind: "DEAD", start: +(cues[i - 1].end + keep).toFixed(3), end: +(c.start - keep).toFixed(3), why: `${gap.toFixed(2)}s gap` });
      }
    }
    if (c.text.trim() && !FILLER_ONLY.test(c.text)) {
      let j = i - 1;
      while (j >= 0 && (FILLER_ONLY.test(cues[j].text) || !cues[j].text.trim())) j--;
      if (j >= 0) {
        const a = norm(cues[j].text).slice(0, 5), b = norm(c.text).slice(0, 5);
        if (a.length >= 3 && a.join(" ") === b.join(" ")) cuts.push({ kind: "REPEAT", start: cues[j].start, end: cues[j].end, why: `restart of "${a.join(" ")}"` });
      }
    }
  });
  const valid = cuts.filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
  const removed = valid.reduce((s, c) => s + c.end - c.start, 0);
  return { duration, cuts: valid, removed: +removed.toFixed(3), out: +(duration - removed).toFixed(3) };
}

// ─────────────────────────────────────────────────────────────
// chapters
// ─────────────────────────────────────────────────────────────

const CH_STOP = new Set(
  "the a an of for to in on and or is are was were be been with this that it as at by from you your i my we our they them he she but so if then than there here what which who how when where why not no yes do does did just really very like about into over out up down can could will would should have has had get got make made go going went one two".split(" "),
);
const keywords = (text: string) => new Set((text.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !CH_STOP.has(w)));
export function mmss(t: number) {
  const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

export interface Chapter {
  start: number;
  label: string;
  draftTitle: string;
  seconds: number;
}

/** YouTube's rules, enforced: starts at 0:00, 3+ entries, each at least 10 s. */
export function chapters(cues: Cue[], target = 7): { valid: boolean; chapters: Chapter[] } {
  if (cues.length < 6) return { valid: false, chapters: [] };
  const duration = cues.at(-1)!.end;
  const cand: Array<[number, number]> = [];
  for (let i = 1; i < cues.length; i++) {
    const gap = cues[i].start - cues[i - 1].end;
    const kb = keywords(cues.slice(Math.max(0, i - 12), i).map((c) => c.text).join(" "));
    const ka = keywords(cues.slice(i, i + 12).map((c) => c.text).join(" "));
    const union = new Set([...kb, ...ka]);
    const shift = union.size ? 1 - [...kb].filter((w) => ka.has(w)).length / union.size : 0;
    cand.push([gap * 1.6 + shift * 3.2, cues[i].start]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  const picked = [0];
  for (const [, t] of cand) {
    if (picked.length >= target) break;
    if (picked.every((p) => Math.abs(t - p) >= 10) && duration - t >= 10) picked.push(t);
  }
  picked.sort((a, b) => a - b);
  const list = picked.map((t, n) => {
    const end = picked[n + 1] ?? duration;
    const text = cues.filter((c) => c.start >= t && c.end <= end).map((c) => c.text).join(" ");
    const lower = text.toLowerCase();
    const kw = [...keywords(text)].sort((a, b) => lower.split(b).length - lower.split(a).length);
    return { start: +t.toFixed(2), label: mmss(t), draftTitle: kw.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "Section", seconds: +(end - t).toFixed(2) };
  });
  return { valid: list.length >= 3 && list[0].start === 0 && list.every((c) => c.seconds >= 10), chapters: list };
}

// ─────────────────────────────────────────────────────────────
// retention
// ─────────────────────────────────────────────────────────────

export interface RetentionReport {
  points: number;
  start: number;
  end: number;
  hookLeak: number;
  verdict: "healthy" | "leaking" | "severe";
  cliffs: Array<{ from: number; to: number; lost: number; atSeconds: number | null; said?: string }>;
  slide: number;
}

export function parseRetentionCsv(raw: string): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  for (const line of raw.split(/\r?\n/)) {
    const nums = line.split(",").map((c) => Number(c.trim().replace("%", "")));
    const vals = nums.filter((n) => Number.isFinite(n) && line.trim() !== "");
    if (vals.length >= 2) rows.push([vals[0], vals[1]]);
  }
  return rows;
}

export function retention(rows: Array<[number, number]>, durationSeconds?: number, cues?: Cue[]): RetentionReport | null {
  if (rows.length < 8) return null;
  const xs = rows.map((r) => r[0]), ys = rows.map((r) => r[1]);
  const pctAxis = Math.max(...xs) <= 100.5;
  const at = (x: number) => (pctAxis && durationSeconds ? (x / 100) * durationSeconds : pctAxis ? null : x);
  const start = ys[0] || 100;
  const cutoff = !pctAxis ? 30 : durationSeconds ? (30 / durationSeconds) * 100 : 10;
  const early = rows.filter(([x]) => x <= cutoff).map(([, y]) => y);
  const hookLeak = +(start - (early.length ? Math.min(...early) : start)).toFixed(2);
  const drops = rows.slice(1).map(([x, y], i) => ({ rate: (ys[i] - y) / (x - xs[i] || 1), from: xs[i], to: x, lost: ys[i] - y }));
  const cliffs = [...drops]
    .sort((a, b) => b.rate - a.rate || b.from - a.from) // same tie order as Python's reverse tuple sort
    .slice(0, 5)
    .filter((d) => d.lost > 0.8)
    .map((d) => {
      const atSeconds = at(d.from);
      const said = atSeconds !== null && cues ? cues.filter((q) => q.start <= atSeconds + 4 && q.end >= atSeconds - 4).map((q) => q.text).join(" ").slice(0, 140) : undefined;
      return { from: +d.from.toFixed(2), to: +d.to.toFixed(2), lost: +d.lost.toFixed(2), atSeconds: atSeconds === null ? null : +atSeconds.toFixed(1), said };
    });
  const mid = drops.filter((d) => d.from > cutoff).map((d) => d.rate);
  return {
    points: rows.length,
    start,
    end: ys.at(-1)!,
    hookLeak,
    verdict: hookLeak < 25 ? "healthy" : hookLeak < 40 ? "leaking" : "severe",
    cliffs,
    slide: +(mid.length ? mid.reduce((a, b) => a + b, 0) / mid.length : 0).toFixed(3),
  };
}

// ─────────────────────────────────────────────────────────────
// swipe: outliers by multiple of their own channel's median
// ─────────────────────────────────────────────────────────────

export interface CollectedVideo {
  channel: string;
  title: string;
  views: number;
  url?: string;
}

export interface Outlier extends CollectedVideo {
  median: number;
  multiple: number;
  formula: string;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function swipe(videos: CollectedVideo[], minMultiple = 1.5): { outliers: Outlier[]; thin: Array<[string, number]>; formulas: Array<[string, number]> } {
  const by = new Map<string, CollectedVideo[]>();
  for (const v of videos) by.set(v.channel || "?", [...(by.get(v.channel || "?") ?? []), v]);
  const outliers: Outlier[] = [];
  const thin: Array<[string, number]> = [];
  for (const [channel, vids] of by) {
    if (vids.length < 4) {
      thin.push([channel, vids.length]);
      continue;
    }
    const med = median(vids.map((v) => Number(v.views) || 0));
    for (const v of vids) {
      const multiple = med ? +((Number(v.views) || 0) / med).toFixed(2) : 0;
      if (multiple >= minMultiple) outliers.push({ ...v, channel, views: Math.round(Number(v.views) || 0), median: Math.round(med), multiple, formula: classifyFormula(v.title).name });
    }
  }
  outliers.sort((a, b) => b.multiple - a.multiple);
  const counts = new Map<string, number>();
  for (const o of outliers) counts.set(o.formula, (counts.get(o.formula) ?? 0) + 1);
  return { outliers, thin, formulas: [...counts].sort((a, b) => b[1] - a[1]) };
}
