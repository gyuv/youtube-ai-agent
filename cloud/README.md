# Lumen Cloud

A fully cloud-hosted YouTube automation studio built only on free services. Your own machine
does no rendering and runs no scripts; it only needs a browser.

| Layer | Service (free tier) |
| --- | --- |
| Studio UI and API routes | Next.js App Router on Vercel |
| Database | Supabase PostgreSQL via Prisma |
| Media storage | Supabase Storage (or a Cloudflare R2 bucket) |
| Script and metadata | Gemini Flash via Google AI Studio |
| Voiceover | `edge-tts` neural voices |
| Visuals | Pollinations.ai (keyless) and Pexels |
| Rendering | GitHub Actions runner (Remotion / FFmpeg), started through `repository_dispatch` |
| Publishing | YouTube Data API v3 (OAuth2) |

## Layout

```
cloud/
├── prisma/schema.prisma   Channel, VideoProject, Scene
├── prisma/migrations/     initial tables + row-level security
├── prisma.config.ts       Prisma CLI config (migrations use DIRECT_URL)
├── remotion/              the video composition: scenes, Ken Burns, B-roll, captions
├── scripts/               render-worker.ts (runs on GitHub Actions), render-smoke.ts
├── src/
│   ├── app/               Next.js App Router pages and API routes (/api/render/webhook)
│   ├── components/ui/     shadcn/ui components (added with `npx shadcn add ...`)
│   ├── lib/prisma.ts      lazy Prisma client on the pg driver adapter (Supabase pooler)
│   ├── lib/storage.ts     Supabase Storage or Cloudflare R2, plus signed upload URLs
│   ├── lib/crypto.ts      AES-256-GCM for OAuth tokens at rest
│   ├── lib/env.ts         lazy env access; a missing key fails only the feature using it
│   ├── services/          provider integrations, pipeline, render webhook, YouTube (below)
│   └── worker/            runner-side code: downloads, encoding plan, YouTube upload
└── .env.example           every variable the app reads
```

The workflows live at the repository root, because GitHub only reads them from there:
`.github/workflows/render-video.yml` (cloud renderer), `autopilot.yml` (scheduler) and
`cloud-ci.yml` (checks and smoke renders).

## Services

| Module | What it does |
| --- | --- |
| `scriptGenerator.ts` | Gemini structured JSON (hook, sections, CTA, image prompts, stock queries, title/description/tags), validated with zod; estimated timestamps; YouTube chapter builder. Falls back to `GEMINI_FALLBACK_MODEL` on 429. |
| `ttsGenerator.ts` | edge-tts neural voices via `msedge-tts` (pure Node, no Python): mp3 + word timings for captions. Narration is SSML-escaped; voice/rate/pitch are strictly validated. |
| `visualFetcher.ts` | Pollinations.ai images (downloaded, then stored in Supabase) and Pexels B-roll with a stock-photo fallback, picking the ~1080p rendition. |
| `renderDispatcher.ts` | `repository_dispatch` → `.github/workflows/render-video.yml`, payload is just the project id. |
| `pipeline.ts` | DB orchestration: whole-script generation, per-scene audio/visual regeneration, bulk asset fill, and an atomic claim before dispatching a render. |
| `renderJob.ts` | Server side of the render webhook: claims the job, issues the signed upload URL, records RENDERED/PUBLISHED/FAILED. |
| `youtube.ts` | Refreshes the channel's access token and builds upload metadata (chapters, `#Shorts`, scheduling). |
| `autopilot.ts` | The autopilot's single-step tick (see below); `topicPlanner.ts` asks Gemini for fresh topics. |

Status rules enforced by `pipeline.ts`:

- Scenes can be edited in `DRAFT`, `SCRIPTED`, `ASSETS_READY`, `RENDERED` and `FAILED`; never while queued/rendering or after publishing.
- Locked scenes are skipped by bulk generation and refuse per-scene regeneration until unlocked.
- Editing narration drops the old audio, so stale voiceover can never be rendered.
- A render can be dispatched only when every scene has audio, a visual and a duration; two clicks can't start two runners.

## Cloud renderer

```
Studio ── "Dispatch Cloud Render" ──▶ GitHub repository_dispatch ──▶ render-video.yml (ubuntu runner)
                                                                        │
   ◀── started ── returns scenes + a signed upload URL ─────────────────┤ download assets
                                                                        │ Remotion → 1080p H.264
   ◀── rendered ─ returns YouTube instructions if auto-publish is on ───┤ PUT mp4 to storage
   ◀── published / failed ──────────────────────────────────────────────┘ resumable YouTube upload
```

The runner holds no database or storage credentials. It authenticates to `/api/render/webhook`
with `RENDER_WEBHOOK_SECRET`, uploads through a signed URL, and for auto-publish receives a
one-hour YouTube access token (the refresh token never leaves the app).

**One-time setup**

1. Merge the workflow to the repository's **default branch**: GitHub only starts
   `repository_dispatch` workflows from there.
2. Repository → Settings → Secrets and variables → Actions → add `APP_URL` (the deployed
   studio's https URL) and `RENDER_WEBHOOK_SECRET` (same value as in Vercel).
3. In Vercel add `GITHUB_DISPATCH_TOKEN`: a fine-grained token for this repository with
   **Contents: read and write** (required by `repository_dispatch`).
4. Make the storage bucket public-read. For long-form 1080p, use `STORAGE_DRIVER=r2`: Supabase's
   free tier caps files at 50 MB, and the renderer refuses to squeeze a long video below
   watchable quality to fit.

**Try it without any accounts**: `npm run render:smoke` renders a real two-scene Short
(`SMOKE_FORMAT=LONG_FORM` for 16:9) against a local stand-in for the app. CI runs both.

**Free-tier limits to know**

| Limit | Effect |
| --- | --- |
| GitHub Actions: free for public repos; 2,000 min/month for private repos (Free plan) | a 60s Short takes a few minutes including setup |
| YouTube Data API: 10,000 units/day; each upload costs 1,600 | about 6 uploads per day per Google Cloud project |
| Google OAuth consent screen in **Testing** mode | refresh tokens expire after 7 days; publish the app (unverified is fine for your own channel) |
| Remotion | free for individuals and companies of up to 3 people; others set `REMOTION_LICENSE_KEY` |

Uploads are marked `containsSyntheticMedia: true` because the voice and imagery are AI-generated,
which YouTube asks creators to disclose. Scheduled projects (`scheduledFor`) upload as private
with `publishAt`, and YouTube makes them public at that time.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

`.github/workflows/cloud-ci.yml` runs the same checks, plus both smoke renders, on every push
that touches `cloud/`.

## Pipeline states

```
DRAFT -> SCRIPTED -> ASSETS_READY -> QUEUED_FOR_RENDER -> RENDERING -> RENDERED -> PUBLISHED
                                         any stage can move to FAILED (see VideoProject.lastError)
```

## Autopilot

Turn it on per channel (Channels → Autopilot). Every 3 hours `.github/workflows/autopilot.yml`
calls `POST /api/autopilot/tick` in a loop; each call does one small step, well inside Vercel's
time limit, and says whether more work remains:

1. **Housekeeping**: renders that stopped reporting for 3 hours become *Failed* (any project).
2. **Dispatch** an autopilot video whose scenes are all ready, or retry a failed render.
3. **Fill** one missing voice or visual.
4. **Script** a planned video with Gemini.
5. **Plan** a video for the soonest open slot inside the channel's lead window (default 36 h),
   taking the next line of the channel's *topic backlog*, or a fresh Gemini idea that doesn't
   repeat the channel's last 40 topics.

Guard rails:

- It only touches projects it created (marked **Auto**); your own videos are never changed.
- Each video gets 3 attempts; after that it's parked as *Failed* with the reason, and planning on
  that channel pauses for 12 hours so a systemic problem (bad key, quota) doesn't pile up failures.
- *Review mode* stops at "Assets ready" so you approve each video with Dispatch Cloud Render.
- With auto-publish on, the renderer uploads the video as private with `publishAt` = the slot.
- Every step is logged in the dashboard's Autopilot panel (kept 30 days); **Run now** starts a
  run immediately.

The workflow needs no checkout or install (a run costs seconds of runner time) and reuses the
`APP_URL` and `RENDER_WEBHOOK_SECRET` repository secrets. GitHub runs schedules from the default
branch only and pauses them after 60 days without repository activity.

## Studio

| Screen | What it's for |
| --- | --- |
| **Dashboard** `/` | Counts by stage, a filterable pipeline table (scenes ready per video) and the next 7 days of posting slots. Open slots link straight to a new video for that time. |
| **Channels** `/channels` | Niche, audience, voice, format, script and visual style, posting cron with a live preview of the next slots, auto-publish, and **Connect YouTube**. |
| **New video** `/projects/new` | Topic, channel, format, and "next free slot" / custom time. Optionally writes the script with Gemini immediately. |
| **Scene Repair Studio** `/projects/[id]` | Live preview of the exact render composition (Remotion Player), a proportional timeline, and a card per scene: edit narration, regenerate its audio, regenerate its AI image or swap in stock B-roll, lock it. Toolbar: write/rewrite script, generate missing assets scene by scene with progress, **Dispatch Cloud Render**. The page follows the render live. |

Everything except `/login` and the runner's webhook requires the studio password. The session is
an HMAC-signed cookie; server actions and API routes re-check it on every call.

## Connecting YouTube

1. [Google Cloud Console](https://console.cloud.google.com/): create a project and enable
   **YouTube Data API v3**.
2. OAuth consent screen: type *External*, add the scopes `youtube.upload` and
   `youtube.readonly`, add your Google account as a test user, then **Publish app**. Apps left in
   *Testing* get refresh tokens that expire after 7 days; an unverified published app works for
   your own channel after a warning screen.
3. Credentials → *OAuth client ID* → *Web application*. Authorized redirect URIs:
   `https://<your-app>/api/oauth/google/callback` (and `http://localhost:3000/api/oauth/google/callback` for local dev).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
   `TOKEN_ENCRYPTION_KEY`, then use **Connect YouTube** on the channel page.

## Database

`prisma/migrations` creates the tables and enables row-level security on each of them. Supabase
publishes the `public` schema through its Data API; RLS with no policies keeps that API out,
while the app (connecting as the table owner through Prisma) is unaffected.

## Local setup

```bash
cd cloud
cp .env.example .env          # at minimum DATABASE_URL, DIRECT_URL, STUDIO_PASSWORD, SESSION_SECRET
npm install                   # also runs `prisma generate`
npm run db:deploy             # apply prisma/migrations
npm run dev                   # http://localhost:3000
```

## Deploying to Vercel

1. Import the repository in Vercel and set **Root Directory** to `cloud`.
2. Add the variables from `.env.example` under Project Settings → Environment Variables.
3. Run `npm run db:deploy` once (locally with `DIRECT_URL` set) to create the tables in Supabase.
4. Add `APP_URL` and `RENDER_WEBHOOK_SECRET` as GitHub repository secrets (see *Cloud renderer*).
