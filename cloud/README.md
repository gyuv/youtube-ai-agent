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
├── prisma.config.ts       Prisma CLI config (migrations use DIRECT_URL)
├── src/
│   ├── app/               Next.js App Router pages and API routes
│   ├── components/ui/     shadcn/ui components (added with `npx shadcn add ...`)
│   ├── lib/prisma.ts      lazy Prisma client on the pg driver adapter (Supabase pooler)
│   ├── lib/storage.ts     Supabase Storage uploads over REST
│   ├── lib/env.ts         lazy env access; a missing key fails only the feature using it
│   └── services/          provider integrations + pipeline orchestration (below)
└── .env.example           every variable the app reads
```

## Services

| Module | What it does |
| --- | --- |
| `scriptGenerator.ts` | Gemini structured JSON (hook, sections, CTA, image prompts, stock queries, title/description/tags), validated with zod; estimated timestamps; YouTube chapter builder. Falls back to `GEMINI_FALLBACK_MODEL` on 429. |
| `ttsGenerator.ts` | edge-tts neural voices via `msedge-tts` (pure Node, no Python): mp3 + word timings for captions. Narration is SSML-escaped; voice/rate/pitch are strictly validated. |
| `visualFetcher.ts` | Pollinations.ai images (downloaded, then stored in Supabase) and Pexels B-roll with a stock-photo fallback, picking the ~1080p rendition. |
| `renderDispatcher.ts` | `repository_dispatch` → `.github/workflows/render-video.yml`, payload is just the project id. |
| `pipeline.ts` | DB orchestration: whole-script generation, per-scene audio/visual regeneration, bulk asset fill, and an atomic claim before dispatching a render. |

Status rules enforced by `pipeline.ts`:

- Scenes can be edited in `DRAFT`, `SCRIPTED`, `ASSETS_READY`, `RENDERED` and `FAILED`; never while queued/rendering or after publishing.
- Locked scenes are skipped by bulk generation and refuse per-scene regeneration until unlocked.
- Editing narration drops the old audio, so stale voiceover can never be rendered.
- A render can be dispatched only when every scene has audio, a visual and a duration; two clicks can't start two runners.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

`.github/workflows/cloud-ci.yml` runs the same checks on every push that touches `cloud/`.

The cloud renderer workflow lives at the repository root in `.github/workflows/render-video.yml`
(step 4), because GitHub only reads workflows from there.

## Pipeline states

```
DRAFT -> SCRIPTED -> ASSETS_READY -> QUEUED_FOR_RENDER -> RENDERING -> RENDERED -> PUBLISHED
                                         any stage can move to FAILED (see VideoProject.lastError)
```

## Local setup

```bash
cd cloud
cp .env.example .env          # add your Supabase connection strings
npm install                   # also runs `prisma generate`
npm run db:migrate -- --name init
npm run dev
```

## Deploying to Vercel

1. Import the repository in Vercel and set **Root Directory** to `cloud`.
2. Add the variables from `.env.example` under Project Settings → Environment Variables.
3. Run `npm run db:deploy` once from your machine or a CI job to apply migrations to Supabase.
