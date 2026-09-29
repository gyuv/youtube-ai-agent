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
│   ├── lib/prisma.ts      Prisma client on the pg driver adapter (Supabase pooler)
│   ├── lib/utils.ts       `cn()` helper for shadcn/ui
│   └── services/          Gemini, edge-tts, visuals, GitHub dispatch (step 3)
└── .env.example           every variable the app reads
```

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
