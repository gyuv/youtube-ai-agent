/**
 * End-to-end check of the cloud renderer with no accounts or secrets:
 *   npx tsx scripts/render-smoke.ts            (9:16 Short)
 *   SMOKE_FORMAT=LONG_FORM npx tsx scripts/render-smoke.ts
 *
 * It generates test media with Remotion's bundled ffmpeg, serves it from a local stand-in for
 * the Next.js app (webhook + asset host + upload target), runs the real render worker against
 * it, and verifies the uploaded mp4. Linux x64 (like the GitHub runner) is assumed.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { getVideoMetadata } from "@remotion/renderer";
import { FPS, totalFrames, type VideoFormat } from "../remotion/timeline";
import type { RenderEvent, RenderJob } from "../src/services/renderContract";
import { readWorkerConfig, runRender } from "../src/worker/runRender";

const SECRET = "smoke-test-secret-that-is-at-least-32-chars";
const PROJECT_ID = "csmoketest0000000000000001";
const format = (process.env.SMOKE_FORMAT === "LONG_FORM" ? "LONG_FORM" : "SHORT") as VideoFormat;
const [width, height] = format === "SHORT" ? [1080, 1920] : [1920, 1080];

function ffmpeg(args: string[]) {
  const compositorDir = path.dirname(require.resolve("@remotion/compositor-linux-x64-gnu"));
  const binary = path.join(compositorDir, "ffmpeg");
  const [cmd, env] = existsSync(binary)
    ? [binary, { ...process.env, LD_LIBRARY_PATH: compositorDir }]
    : ["ffmpeg", process.env];
  execFileSync(cmd, ["-hide_banner", "-loglevel", "error", "-y", ...args], { env });
}

/** Minimal RGB PNG writer: a diagonal two-colour gradient with a white centre band. */
function testPattern(w: number, h: number, from: [number, number, number], to: [number, number, number]): Buffer {
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1); // first byte of each row is the PNG filter type (0 = none)
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const band = Math.abs(y - h / 2) < h * 0.04;
      for (let c = 0; c < 3; c++) rows[row + 1 + x * 3 + c] = band ? 255 : Math.round(from[c] + (to[c] - from[c]) * t);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

async function main() {
  const work = await mkdtemp(path.join(os.tmpdir(), "lumen-smoke-"));
  const assets = path.join(work, "assets");
  await mkdir(assets, { recursive: true });

  // Scene 1: still image (Ken Burns). Scene 2: a 1s clip under 2s of narration (must loop).
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2.2", "-c:a", "libmp3lame", "-b:a", "96k", path.join(assets, "voice-0.mp3")]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=2.0", "-c:a", "libmp3lame", "-b:a", "96k", path.join(assets, "voice-1.mp3")]);
  await writeFile(path.join(assets, "image-0.png"), testPattern(width, height, [20, 40, 120], [200, 60, 140]));
  await writeFile(path.join(work, "clip-1.png"), testPattern(width, height, [10, 110, 80], [230, 180, 40]));
  ffmpeg(["-loop", "1", "-framerate", "30", "-i", path.join(work, "clip-1.png"), "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(assets, "clip-1.mp4")]);

  const events: RenderEvent[] = [];
  const uploadPath = path.join(work, "uploaded.mp4");
  let base = "";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const file = path.join(assets, path.basename(url.pathname));
      const type = file.endsWith(".mp3") ? "audio/mpeg" : file.endsWith(".mp4") ? "video/mp4" : "image/png";
      res.writeHead(200, { "content-type": type });
      createReadStream(file).pipe(res);
      return;
    }
    if (req.method === "PUT" && url.pathname === "/upload/video.mp4") {
      await writeFile(uploadPath, await readBody(req));
      res.writeHead(200).end("{}");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/render/webhook") {
      if (req.headers.authorization !== `Bearer ${SECRET}`) return void res.writeHead(401).end();
      const event = JSON.parse((await readBody(req)).toString()) as RenderEvent;
      events.push(event);
      const json = (body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (event.event === "started") {
        const words = (offset: number) =>
          ["Testing", "the", "cloud", "renderer."].map((word, i) => ({ word, startMs: offset + i * 450, endMs: offset + i * 450 + 400 }));
        const job: RenderJob = {
          projectId: PROJECT_ID,
          format,
          captions: true,
          maxBytes: 50 * 1024 * 1024,
          upload: { url: `${base}/upload/video.mp4`, method: "PUT", headers: { "Content-Type": "video/mp4" } },
          scenes: [
            { sceneIndex: 0, audioUrl: `${base}/assets/voice-0.mp3`, imageUrl: `${base}/assets/image-0.png`, videoClipUrl: null, durationSeconds: 2.2, words: words(0) },
            { sceneIndex: 1, audioUrl: `${base}/assets/voice-1.mp3`, imageUrl: null, videoClipUrl: `${base}/assets/clip-1.mp4`, durationSeconds: 2.0, words: words(100) },
          ],
        };
        return json({ job });
      }
      if (event.event === "rendered") return json({ videoUrl: `${base}/upload/video.mp4`, publish: null });
      return json({ ok: true });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const started = Date.now();
    const result = await runRender(
      readWorkerConfig({
        ...process.env,
        APP_URL: base,
        RENDER_WEBHOOK_SECRET: SECRET,
        PROJECT_ID,
        GITHUB_RUN_ID: "4242",
        RENDER_OUT_DIR: path.join(work, "out"),
      }),
    );

    const meta = await getVideoMetadata(uploadPath);
    const expectedSeconds = totalFrames([{ durationSeconds: 2.2 }, { durationSeconds: 2.0 }]) / FPS;
    const checks: Array<[string, boolean]> = [
      ["webhook sequence is started -> rendered", events.map((e) => e.event).join(",") === "started,rendered"],
      ["worker reported rendered", result.outcome === "rendered"],
      ["uploaded file matches reported size", (await stat(uploadPath)).size === result.sizeBytes],
      [`dimensions are ${width}x${height}`, meta.width === width && meta.height === height],
      [`duration ~${expectedSeconds.toFixed(2)}s`, Math.abs((meta.durationInSeconds ?? 0) - expectedSeconds) < 0.15],
      ["h264 video with an audio track", meta.codec === "h264" && meta.audioCodec !== null],
    ];
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    console.log(`Rendered ${(result.sizeBytes / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    if (process.env.SMOKE_KEEP_OUTPUT) {
      await writeFile(process.env.SMOKE_KEEP_OUTPUT, await readFile(uploadPath));
      console.log(`Saved to ${process.env.SMOKE_KEEP_OUTPUT}`);
    }
    if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  } finally {
    server.close();
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
