#!/usr/bin/env node
// Lumen ↔ Google Flow worker. Runs on YOUR computer next to flow-mcp (https://github.com/GTAI-1/flow-mcp),
// claims hook clips the studio planned, has Flow generate them with your free daily credits, and uploads
// the result back into the scene. Node 22+, no dependencies.
//
//   LUMEN_URL=https://your-studio.vercel.app FLOW_WORKER_SECRET=... node flow-worker.mjs
//
// Budget (never exceeded): each clip is capped at FLOW_MAX_CREDITS (default 15) using Flow's own price
// quote, so an over-cap clip is skipped before anything is spent; and a clip only starts when at least
// that many of FLOW_DAILY_CREDITS (default 25) are left today. Spend is kept in ~/.flow-mcp/lumen-ledger.json.
//
// Every poll is a check-in. While the worker is checking in with credits left, the studio's autopilot
// plans Flow clips; when it goes quiet (computer off, Flow signed out) or runs out for the day, the
// autopilot skips Flow and renders videos on time with their still images.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = (name, fallback) => process.env[name]?.trim() || fallback;
const LUMEN_URL = env("LUMEN_URL", "").replace(/\/+$/, "");
const SECRET = env("FLOW_WORKER_SECRET", "");
const FLOW_HOME = env("FLOW_MCP_HOME", join(homedir(), ".flow-mcp"));
const FLOW_PORT = Number(env("FLOW_MCP_PORT", "8787"));
const MAX_CREDITS = Math.min(Number(env("FLOW_MAX_CREDITS", "15")), 25);
const DAILY_CREDITS = Number(env("FLOW_DAILY_CREDITS", "25"));
const POLL_SECONDS = Number(env("FLOW_POLL_SECONDS", "120"));
const MODEL = env("FLOW_MODEL", ""); // e.g. "Omni 1.1 Flash"; empty keeps Flow's current model
const DURATION = env("FLOW_DURATION", ""); // 4, 6, 8 or 10 (Omni models only)
const RESOLUTION = env("FLOW_RESOLUTION", ""); // 360p or 720p (Omni models only)
const LEDGER = join(FLOW_HOME, "lumen-ledger.json");
const ONCE = process.argv.includes("--once");

if (!LUMEN_URL || !SECRET) {
  console.error("Set LUMEN_URL (your studio's https URL) and FLOW_WORKER_SECRET (same value as in Vercel).");
  process.exit(1);
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD: Flow's credits reset daily

function ledger() {
  let data = { date: today(), spent: 0, characters: {} };
  try {
    data = { ...data, ...JSON.parse(readFileSync(LEDGER, "utf8")) };
  } catch {}
  if (data.date !== today()) data = { ...data, date: today(), spent: 0 };
  return data;
}
const saveLedger = (data) => writeFileSync(LEDGER, JSON.stringify(data, null, 2));

// ── flow-mcp (local) ──────────────────────────────────────────
const flowToken = () => (existsSync(join(FLOW_HOME, "token")) ? readFileSync(join(FLOW_HOME, "token"), "utf8").trim() : "");

async function flow(method, body, raw) {
  const res = await fetch(`http://127.0.0.1:${FLOW_PORT}/api/${method}`, {
    method: "POST",
    headers: { "x-flow-token": flowToken(), ...(raw ? {} : { "content-type": "application/json" }) },
    body: raw ?? JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `flow-mcp answered ${res.status}`);
  return data;
}

async function flowReady() {
  const health = await fetch(`http://127.0.0.1:${FLOW_PORT}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json(), () => null);
  if (health?.name !== "flow-mcp") return "flow-mcp isn't running. Start it with `npm run studio` in your flow-mcp folder.";
  const status = await flow("status", { detailed: false }).catch((e) => ({ error: e.message }));
  if (status.error) return status.error;
  if (status.flow && (status.flow.signedIn === false || status.flow.inProject === false)) {
    return status.flow.hint ?? "Flow isn't ready. Run `npm run login` in flow-mcp, sign in and open a Flow project.";
  }
  return null;
}

/** Wait for a job (or a slow call's task id) to finish, in 2-minute slices. */
async function waitFor(id) {
  for (;;) {
    const out = await flow("wait", { job_ids: [id], timeout_seconds: 120 });
    if (out.finished) return out.jobs?.[0];
  }
}

/** Create the channel host as a Flow character once (free), remembered per name + look. */
async function ensureCharacter({ name, look }, book) {
  const key = `${name}:${createHash("sha256").update(look).digest("hex").slice(0, 12)}`;
  if (book.characters[key]) return;
  const existing = await flow("characters", {});
  if (!(Array.isArray(existing) && existing.some((c) => c.name === name))) {
    log(`Creating Flow character "${name}" (free)…`);
    const made = await flow("character", { name, describe: look });
    if (made?.task_id) await waitFor(made.task_id);
  }
  book.characters[key] = new Date().toISOString();
  saveLedger(book);
}

// ── Lumen (cloud) ─────────────────────────────────────────────
async function lumen(path, body) {
  const res = await fetch(`${LUMEN_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Lumen answered ${res.status}`);
  return data;
}
const report = (job, result) => lumen("/api/flow/complete", { sceneId: job.sceneId, claimedAt: job.claimedAt, ...result });

async function runJob(job, book) {
  const scene = { prompt: job.prompt, type: "video", aspect_ratio: job.height > job.width ? "9:16" : "16:9", max_credits: MAX_CREDITS, retries: 1 };
  if (MODEL) scene.model = MODEL;
  if (DURATION) scene.duration = Number(DURATION);
  if (RESOLUTION) scene.resolution = RESOLUTION;

  let frame = null;
  if (job.character) {
    // Flow's composer takes a character OR a start frame, never both: the host wins.
    await ensureCharacter(job.character, book);
    scene.reference_images = [`asset:${job.character.name}`];
  } else if (job.imageUrl) {
    const image = await fetch(job.imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (image.ok) frame = { ext: (image.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg", bytes: Buffer.from(await image.arrayBuffer()) };
  }

  // Flow is flaky (slow uploads, busy servers): try with the start frame twice, then from the prompt alone,
  // before reporting a failure, so one hiccup never costs the video an attempt.
  const tries = frame ? ["frame", "frame", "prompt"] : ["prompt", "prompt"];
  let done = null;
  let lastError = "";
  for (const [i, mode] of tries.entries()) {
    const attempt = { ...scene };
    try {
      if (mode === "frame") attempt.first_frame = (await flow(`upload?name=scene.${frame.ext}`, null, frame.bytes)).path;
      const queued = await flow("generate", { project: "lumen", scenes: [attempt] });
      const id = queued.jobs?.[0]?.id;
      if (!id) throw new Error("flow-mcp queued nothing.");
      log(`Generating in Flow (job ${id}, ${mode === "frame" ? "from the scene image" : "from the prompt"}, cap ${MAX_CREDITS} credits)…`);
      done = await waitFor(id);
      if (!/Nothing was generated/i.test(done?.error ?? "") && (done?.status === "done" || done?.credits > 0)) {
        // Charge what Flow reported; if it didn't say, assume the cap so the budget can only err on the safe side.
        book.spent += Number.isFinite(done?.credits) ? done.credits : MAX_CREDITS;
        saveLedger(book);
      }
      if (done?.status === "done" && done.files?.length) break;
      lastError = done?.error ?? `Flow job ended ${done?.status ?? "without a result"}.`;
    } catch (error) {
      lastError = error.message;
    }
    done = null;
    if (i < tries.length - 1) {
      log(`Flow hiccup (${lastError.slice(0, 160)}); trying again…`);
      await sleep(20);
    }
  }
  if (!done) throw new Error(lastError || "Flow produced nothing.");

  const file = done.files.find((f) => f.endsWith(".mp4")) ?? done.files[0];
  const put = await fetch(job.upload.url, { method: job.upload.method, headers: job.upload.headers, body: readFileSync(file), signal: AbortSignal.timeout(300_000) });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status}).`);
  return done.credits;
}

async function tick() {
  const book = ledger();
  const left = DAILY_CREDITS - book.spent;
  if (left < MAX_CREDITS) {
    // Still check in, so the studio knows not to plan clips today and renders with stills on time.
    await lumen("/api/flow/claim", { creditsLeft: Math.max(0, left) });
    log(`Daily budget used (${book.spent}/${DAILY_CREDITS} credits; a clip needs up to ${MAX_CREDITS}). Resuming tomorrow.`);
    return 10 * 60;
  }
  const problem = await flowReady();
  if (problem) {
    // No check-in while Flow can't work: the studio then stops planning clips after 15 minutes.
    log(problem);
    return POLL_SECONDS;
  }
  const job = await lumen("/api/flow/claim", { creditsLeft: left });
  if (!job) return POLL_SECONDS;
  log(`Claimed scene ${job.sceneId}${job.character ? ` with host "${job.character.name}"` : ""}.`);
  try {
    const credits = await runJob(job, book);
    const res = await report(job, { ok: true });
    log(`Done: ${credits ?? "?"} credits, ${ledger().spent}/${DAILY_CREDITS} used today.${res.applied ? "" : " (The studio had moved on; clip not applied.)"}`);
  } catch (error) {
    log(`Failed: ${error.message}`);
    await report(job, { ok: false, error: String(error.message).slice(0, 1900) }).catch((e) => log(`Couldn't report the failure: ${e.message}`));
  }
  return 5;
}

log(`Lumen Flow worker: ${LUMEN_URL}, cap ${MAX_CREDITS}/clip, ${DAILY_CREDITS}/day.`);
for (;;) {
  const wait = await tick().catch((e) => (log(`Error: ${e.message}`), POLL_SECONDS));
  if (ONCE) break;
  await sleep(wait);
}
