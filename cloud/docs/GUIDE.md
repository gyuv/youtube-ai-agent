# Lumen Cloud: the complete guide

This guide takes you from nothing to a YouTube channel that plans, makes and publishes videos on
its own, using only free services. You don't need to install anything or keep a computer on:
everything runs in the cloud, and you manage it from a browser, including on your phone.

Allow about **1½ hours** the first time: 40 minutes to deploy, 15 minutes to connect YouTube,
15 minutes for your first video, and 20 minutes to apply for YouTube's API audit.

**Contents**

1. [How it works](#1-how-it-works)
2. [Before you start](#2-before-you-start)
3. [Supabase: database and file storage](#3-supabase-database-and-file-storage)
4. [Free API keys and secrets](#4-free-api-keys-and-secrets)
5. [Vercel: put the studio online](#5-vercel-put-the-studio-online)
6. [GitHub: the video renderer and the autopilot](#6-github-the-video-renderer-and-the-autopilot)
7. [Connect your YouTube channel](#7-connect-your-youtube-channel)
8. [Set up your channel](#8-set-up-your-channel)
9. [Make your first video](#9-make-your-first-video)
10. [Turn on the autopilot](#10-turn-on-the-autopilot)
11. [Apply for the YouTube API audit](#11-apply-for-the-youtube-api-audit)
12. [Day-to-day use](#12-day-to-day-use)
13. [Limits of the free tiers](#13-limits-of-the-free-tiers)
14. [Troubleshooting](#14-troubleshooting)
15. [Security and maintenance](#15-security-and-maintenance)
16. [Quick reference: every setting](#16-quick-reference-every-setting)

---

## 1. How it works

```
 You (browser)
     │  sign in with your studio password
     ▼
 Studio on Vercel ──── Supabase: database + media files
     │  writes scripts with Gemini, voices with Microsoft Edge TTS,
     │  finds visuals on Pollinations (AI images) or Pexels (stock video)
     │
     │  "Dispatch Cloud Render"
     ▼
 GitHub Actions ──── renders the video (Remotion) ──── uploads it to YouTube
     ▲
     │  every 3 hours
 Autopilot workflow: plans topics, writes, voices, renders and publishes on your schedule
```

A video moves through these stages. The studio shows the current one on every video:

| Stage | Meaning |
| --- | --- |
| Draft | only a topic so far |
| Scripted | Gemini wrote the script; scenes need a voice and a visual |
| Assets ready | every scene has a voice and a visual; ready to render |
| Queued, Rendering | GitHub is making the video |
| Rendered | the MP4 is stored; you can download it |
| Published | it's on YouTube |
| Failed | something went wrong; the video page says what |

Everything uses free tiers, and the dashboard shows the spend to date: $0.00.

## 2. Before you start

**Accounts you need** (all free):

| Account | Used for |
| --- | --- |
| [GitHub](https://github.com) | holds the code (your copy is `gyuv/youtube-ai-agent`) and renders videos |
| [Vercel](https://vercel.com) (Hobby plan) | runs the studio website |
| [Supabase](https://supabase.com) | database and file storage |
| Google account | Gemini API key, Google Cloud (YouTube API), and the YouTube channel itself |
| [Pexels](https://www.pexels.com/api/) | free stock videos (optional, but recommended) |

**Keep a notes file open.** You'll collect about 20 values. Treat it like a password list: keep
it private, and don't send it to anyone.

| Value | Where you get it | Step |
| --- | --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | Supabase | 3 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase | 3 |
| `GEMINI_API_KEY` | Google AI Studio | 4 |
| `PEXELS_API_KEY` | Pexels | 4 |
| `GITHUB_DISPATCH_TOKEN` | GitHub | 4 |
| `STUDIO_PASSWORD`, `SESSION_SECRET`, `RENDER_WEBHOOK_SECRET`, `TOKEN_ENCRYPTION_KEY` | you make them | 4 |
| Your studio address, for example `https://youtube-ai-agent-xxxx.vercel.app` | Vercel | 5 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud | 7 |

## 3. Supabase: database and file storage

1. At [supabase.com](https://supabase.com), sign in and click **New project**.
   - Region: **Mumbai** (`ap-south-1`) if you're in India, otherwise the one closest to you.
   - Database password: letters and numbers only, so it can go straight into a URL. Save it.
2. When the project is ready, click **Connect** at the top, then **Connection string**. Copy two
   strings, and in each replace `[YOUR-PASSWORD]` with your database password:
   - **Transaction pooler** (port **6543**): this is `DATABASE_URL`.
   - **Session pooler** (port **5432**): this is `DIRECT_URL`.

   Don't use "Direct connection". On the free plan it only works over IPv6, which Vercel can't
   reach.
3. Open **Storage** and click **New bucket**. Name it `lumen-media`, switch **Public bucket** on,
   and create it.
4. Open **Project Settings**, then **API Keys**:
   - **Project URL**: this is `SUPABASE_URL`.
   - **service_role** secret: this is `SUPABASE_SERVICE_ROLE_KEY`. On newer projects it's under
     the **Legacy API keys** tab. It's a master key, so never share it.

You don't need to create any tables. The first deploy does that (step 5).

## 4. Free API keys and secrets

**Gemini** (writes scripts, titles, descriptions and topic ideas)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and click **Create API key**.
2. Copy it: this is `GEMINI_API_KEY`.

**Pexels** (free stock video clips)

1. Go to [pexels.com/api](https://www.pexels.com/api/) and request a key. Approval is instant.
2. Copy it: this is `PEXELS_API_KEY`.

**GitHub token** (lets the studio start renders)

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. Fill it in:
   - Name: `Lumen Cloud`.
   - Expiration: the longest offered. Put a reminder in your calendar to renew it.
   - Repository access: **Only select repositories**, then `youtube-ai-agent`.
   - Permissions, then Repository permissions: **Contents: Read and write** and **Actions: Read-only**.
3. Click **Generate token** and copy it: this is `GITHUB_DISPATCH_TOKEN`.

**Your own secrets**

- `STUDIO_PASSWORD`: choose one of at least 12 characters. It's how you sign in to the studio.
- The other three must be random. Open any website, press **F12**, click the **Console** tab, paste
  this line and press Enter:

  ```js
  ["SESSION_SECRET","RENDER_WEBHOOK_SECRET","TOKEN_ENCRYPTION_KEY"].map(n=>n+"="+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))).join("\n")
  ```

  Copy the three lines it prints into your notes. The code runs only in your browser; nothing is
  sent anywhere.

  **Keep `TOKEN_ENCRYPTION_KEY` safe and never change it.** It encrypts your YouTube connection;
  if you lose or change it, you have to connect YouTube again.

## 5. Vercel: put the studio online

1. At [vercel.com](https://vercel.com), sign up with GitHub (Hobby plan). Click **Add New…**,
   then **Project**, and import `gyuv/youtube-ai-agent`. If it isn't listed, click **Adjust
   GitHub App Permissions** and allow that repository.
2. **Root Directory**: click **Edit** and choose `cloud`. The framework should show **Next.js**.
3. Open **Build and Output Settings**, switch on the override for **Build Command**, and enter:

   ```
   [ "$VERCEL_ENV" != production ] || npx prisma migrate deploy && npm run build
   ```

   Production deploys then create or update the database tables automatically, and stop if the
   database address is wrong. Preview deploys leave the database alone.
4. Open **Environment Variables**. Paste this whole block into the first **Key** box (Vercel splits
   it into separate variables), then fill in each value from your notes:

   ```
   STUDIO_PASSWORD=
   SESSION_SECRET=
   DATABASE_URL=
   DIRECT_URL=
   STORAGE_DRIVER=supabase
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   SUPABASE_STORAGE_BUCKET=lumen-media
   GEMINI_API_KEY=
   PEXELS_API_KEY=
   GITHUB_DISPATCH_TOKEN=
   GITHUB_REPO_OWNER=gyuv
   GITHUB_REPO_NAME=youtube-ai-agent
   RENDER_WEBHOOK_SECRET=
   TOKEN_ENCRYPTION_KEY=
   PUBLIC_OPERATOR_NAME=
   PUBLIC_CONTACT_EMAIL=
   ```

   `PUBLIC_OPERATOR_NAME` (your name or your firm's name) and `PUBLIC_CONTACT_EMAIL` appear on the
   public Privacy Policy page. YouTube's audit needs them (step 11).
5. Click **Deploy**. It takes 2–4 minutes. The build log should include "All migrations have been
   successfully applied".
6. Speed it up: open **Settings**, then **Functions**, and set **Function Region** to the same region
   as your database (**Mumbai, bom1** for India). If Vercel offers **Fluid Compute**, leave it on.
   Then open **Deployments**, click the **⋯** menu on the latest one and choose **Redeploy**.
7. Find your address under **Settings**, then **Domains**, for example
   `https://youtube-ai-agent-xxxx.vercel.app`. Use this short address everywhere from now on, not
   the long per-deployment ones.
8. Open it, sign in with your studio password, and you'll see *Set up your first channel*. Also
   check that `https://<your address>/privacy` opens without the password.

**Whenever you change an environment variable, redeploy.** Vercel only reads variables when it
builds.

## 6. GitHub: the video renderer and the autopilot

1. In your GitHub repository, open **Settings**, then **Secrets and variables**, then **Actions**, and
   click **New repository secret** twice:
   - `APP_URL`: your short studio address from step 5.7, without a trailing slash.
   - `RENDER_WEBHOOK_SECRET`: exactly the same value you gave Vercel.
2. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable
   them**.
3. Test the connection: click **Autopilot** in the left list, then **Run workflow**, then **Run
   workflow**. After about 30 seconds the run should be green and end with "Autopilot is off on
   every channel". That means GitHub can reach your studio.

The three workflows:

| Workflow | What it does |
| --- | --- |
| **Render video** | makes one video when the studio asks, then uploads it to YouTube |
| **Autopilot** | runs every 3 hours, and when you click **Run now** in the studio |
| **Cloud CI** | checks the code whenever it changes |

## 7. Connect your YouTube channel

### 7.1 Google Cloud project

1. At [console.cloud.google.com](https://console.cloud.google.com), open the project picker and
   click **New project**. Name it `Lumen Cloud` and create it. Make sure it's selected at the top.
2. Open **APIs & Services**, then **Library**. Search for **YouTube Data API v3**, open it and click
   **Enable**.

### 7.2 Consent screen

Google calls this **Google Auth Platform** in newer menus and **OAuth consent screen** in older
ones.

1. Click **Get started**:
   - App name: `Lumen Cloud`. Don't use "YouTube" in the name.
   - User support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree and create.
2. **Branding**: set App home page to `https://<your address>/login`, Privacy policy to
   `https://<your address>/privacy`, Terms of service to `https://<your address>/terms`, and add your
   address (without `https://`) under **Authorised domains**. Save.
3. **Data Access** (older menus: **Scopes**): click **Add or remove scopes**, tick
   `…/auth/youtube.upload` and `…/auth/youtube.readonly`, click **Update**, then **Save**.
4. **Audience**: click **Publish app** and confirm, so the status reads **In production**. If you
   leave it in *Testing*, Google disconnects you every 7 days and publishing silently stops. You
   don't need Google's app verification, because you're the only user; you'll see a warning screen
   once when connecting.

### 7.3 OAuth client

1. Open **Clients** (older menus: **Credentials**, then **Create credentials**, then **OAuth client
   ID**) and create one:
   - Type: **Web application**. Name: `Lumen Studio`.
   - **Authorised redirect URIs**: add exactly
     `https://<your address>/api/oauth/google/callback`, with `https` and no trailing slash.
2. Click **Create**, then copy the **Client ID** and **Client secret** immediately. Newer menus show
   the secret only once.
3. Note the **project number**: open the project's **Dashboard**, then the **Project info** card.
   You'll need it for the audit.

### 7.4 Add the keys to Vercel

1. In Vercel, open **Settings**, then **Environment Variables**, and add:

   ```
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=https://<your address>/api/oauth/google/callback
   ```

   `GOOGLE_REDIRECT_URI` must match step 7.3 character for character.
2. **Redeploy** (Deployments, then **⋯**, then Redeploy).

Connecting happens on the channel page, in step 8.

## 8. Set up your channel

In the studio, open **Channels**, then **New channel**.

| Field | What to enter |
| --- | --- |
| Name | how you refer to the channel, for example *Money Minute* |
| Niche | the subject, as specifically as you can: *Income tax and GST explained for Indian salaried people and small businesses* |
| Target audience | who watches: *salaried professionals and shop owners in India, beginners* |
| Language | narration language code: `en`, `hi` or `en-IN` |
| Voice | the narrator, matching the language: for India, `en-IN-NeerjaNeural` or `en-IN-PrabhatNeural` (English), `hi-IN-SwaraNeural` or `hi-IN-MadhurNeural` (Hindi) |
| Format | **Short · 9:16** (up to 60 seconds) or **Long-form · 16:9** |
| YouTube visibility | **Private** while you test, **Public** once you're happy (see below) |
| Script style guide | tone and rules, for example *friendly, practical, cite the section of the Act, no investment advice, end with a question* |
| Visual style | added to every AI image prompt, for example *clean infographic style, soft lighting* |
| Posting schedule | pick a preset (**Daily 6 pm**, **Mon · Wed · Fri 6 pm**…) or type a cron expression; the box below shows the next slots |
| Time zone | for example `Asia/Kolkata` |

Click **Create channel**. Then, on the channel's page:

1. In the **YouTube** card, click **Connect YouTube**.
2. Choose your Google account. If your channel is a Brand Account, pick that channel.
3. On "Google hasn't verified this app", click **Advanced**, then **Go to Lumen Cloud**. This is
   expected, because it's your own app.
4. Tick **both** permissions and click **Continue**. You're back in the studio, showing **Connected
   to …**.
5. Switch on **Publish to YouTube automatically after each render**, then click **Save changes**.

**How visibility and scheduling work**

- **Public** with a scheduled time: the video uploads as private, and YouTube makes it public at
  that time.
- **Private** or **Unlisted**: it uploads with exactly that visibility. A scheduled time is used
  only for planning, because YouTube can only schedule videos that go public.
- Until your Google project passes the audit (step 11), YouTube keeps **every** upload private
  whatever you choose. The studio warns you when this happens.

**Cron cheat sheet** (minute, hour, day, month, weekday):

| Cron | Meaning |
| --- | --- |
| `0 18 * * *` | every day at 6:00 pm |
| `30 7 * * *` | every day at 7:30 am |
| `0 18 * * 1,3,5` | Monday, Wednesday and Friday at 6 pm |
| `0 9,18 * * *` | every day at 9 am and 6 pm |
| `0 10 * * 6` | Saturdays at 10 am |

## 9. Make your first video

1. Click **New video** (top right).
2. Enter the topic, for example *5 deductions salaried people forget under the new tax regime*,
   choose the channel, then choose **Decide later**, **Next free slot** or **Pick a time**. Leave
   **Write the script with Gemini right away** on and create it.
3. You're in the **Scene Repair Studio**. After about 20 seconds the scenes appear: a hook, the main
   points and a call to action.
4. Click **Generate missing assets**. Each scene gets a voice-over and a visual, one by one, with
   progress shown.
5. Check it:
   - Press play on the **preview**. It's exactly what will be rendered, captions included.
   - To fix a scene, edit its narration and click **Save & regenerate audio**; click **Regenerate
     image**; or search **Stock B-roll** for a real video clip.
   - Use **Lock** on scenes you're happy with, so they're never regenerated.
   - Check the title, description, tags and visibility under **YouTube details**, then click **Save
     details**.
6. Click **Dispatch Cloud Render**. The page follows the render live, and **Watch the run on
   GitHub** shows the log. A Short takes about 3–5 minutes.
7. When it finishes, the **Output** card offers **Rendered MP4** (download) and, with auto-publish
   on, **Watch on YouTube**.

Always check the facts yourself before publishing. Gemini can be wrong, and tax and legal content
must be accurate.

## 10. Turn on the autopilot

Open your channel, scroll to **Autopilot**, and set:

| Setting | Recommendation |
| --- | --- |
| **Run this channel on autopilot** | on |
| **Let me review each video before it renders** | **on** to start with (and while the audit is open). The autopilot prepares each video and waits for you to click **Dispatch Cloud Render**. |
| **Start production** | 36 hours before each slot, which leaves time to review |
| **Visuals** | **Stock B-roll (Pexels)** looks more real; **AI images (Pollinations)** needs no key |
| **Topic backlog** | one topic per line, used first and in order; when it runs out, Gemini suggests fresh topics that don't repeat your earlier videos |

Click **Save changes**, then **Run now** in the dashboard's *Autopilot* panel to start immediately.

What it does on each run, one step at a time:

1. marks renders that stopped reporting for 3 hours as *Failed*;
2. sends finished videos to the renderer, and retries a failed render;
3. adds a missing voice or visual;
4. writes the script for a planned video;
5. checks that a published video actually went live after its scheduled time;
6. plans a video for the next open slot, from your backlog or a Gemini idea.

Safety rules built in:

- It only touches videos it created (marked **Auto**). Your own videos are never changed.
- Each video gets 3 attempts. After that it stops with the reason, and planning on that channel
  pauses for 12 hours.
- Everything it does is listed in the dashboard's *Autopilot* panel for 30 days.

## 11. Apply for the YouTube API audit

Google Cloud projects created after July 2020 have every API upload locked as **private** until the
project passes YouTube's free compliance audit. Your videos upload correctly, but nobody else can
see them until then. The studio shows **YouTube kept this video private** on such videos and counts
them under *Needs attention*.

The application has its own guide with an answer for each part of the form:
**[youtube-api-audit.md](youtube-api-audit.md)**. In short:

1. Make sure `/privacy` and `/terms` open without the password and show your name and email.
2. Make sure the Google consent screen has those links and is **In production** (step 7.2).
3. Turn on review mode for autopilot channels.
4. Take the screenshots listed in that guide.
5. Fill in the [audit form](https://support.google.com/youtube/contact/yt_api_form) with the
   prepared answers.

It usually takes a few weeks. Until then, download each video's **Rendered MP4** and upload it
yourself in YouTube Studio if you want it public.

## 12. Day-to-day use

- **Dashboard**: counts per stage, the pipeline table, the next 7 days of posting slots (click an
  open slot to plan a video for it), and the Autopilot panel.
- **Needs attention** lists failed videos and videos YouTube kept private. Open one: the red or amber
  box at the top says what happened and what to do.
- **Check visibility** on a published video asks YouTube for its current visibility (after your
  audit is approved, for example).
- **Channels**: change the schedule, style or voice at any time. New videos use the new settings.
- **Script Lab, Edit Lab and Growth Lab** (top menu): the eleven tools from
  [youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill) (MIT), adapted to the
  channel you pick: its niche, audience, style guide, learned lessons and real video stats.
  *Script Lab*: script with five hooks scored, title + thumbnail lint, SEO. *Edit Lab*: edit list,
  chapters, Shorts finder, retention reader. *Growth Lab*: weekly plan, viral outliers in your niche
  (searches YouTube, about 110 quota units), channel audit, comment replies. Pick one of your videos
  to pre-fill its idea and its timed transcript, and apply titles, SEO copy or chapters back to it.
- **Full automation switch** (dashboard): one switch per channel. On sets autopilot, auto-publish,
  public posting, no review stop and performance learning, and adds a daily 7 am slot if the channel
  has no schedule. Off stops the autopilot and auto-publish; videos already made stay as they are.
- **Full automation with learning**: set a morning posting time (Channels → posting schedule, e.g.
  the *Daily 7 am* preset with your time zone), and turn on **Autopilot**, **Auto-publish** and
  **Learn from YouTube performance**. The autopilot then makes each video ahead of its slot, posts it,
  reads every published video's views, likes and comments once a day, and has Gemini turn the
  best-versus-weakest comparison into lessons (shown on the channel page) that shape every new topic
  and script. Lessons start once 3 videos are at least 2 days old.
- **Create a video now** (dashboard → Autopilot): makes one video immediately, without waiting for
  a slot to come within the lead time. It takes the next topic (backlog first, then Gemini) and the
  channel's next free posting slot. On autopilot channels it then starts an autopilot run; on other
  channels it opens the new video and writes its script.
- **Publishing to YouTube**: a video page's **YouTube** box has a **Publish to YouTube** button for
  rendered videos (no re-render needed) and an **Auto-publish to YouTube** switch (the same as the
  channel setting). With it on, new renders upload by themselves and the autopilot run (every 3
  hours) publishes any rendered video still waiting, retrying a failed one every 6 hours.
- **ElevenLabs voices (optional)**: add `ELEVENLABS_API_KEY` in Vercel (ElevenLabs → Profile →
  API keys) and redeploy. Then in *Channels → Voice* pick **Gigi** or **Domi (ElevenLabs)**, or type
  `elevenlabs:` followed by any voice ID from your ElevenLabs library. Captions stay word-timed. The
  free ElevenLabs plan covers about 10,000 characters a month, roughly 10 Shorts.
- **AI video scenes (optional)**: see [AI video clips with Wan2GP](#ai-video-clips-with-wan2gp-optional) below.
- A typical week with review mode on: open the dashboard, review each *Ready for your review* video,
  fix anything, click **Dispatch Cloud Render**, and it publishes at its slot.

### AI video clips with Wan2GP (optional)

[Wan2GP](https://github.com/deepbeepmeep/Wan2GP) turns a text prompt into a real moving AI video
clip. It needs an NVIDIA GPU, which Vercel and GitHub don't offer, so it runs in a free Google Colab
notebook that collects the work from your studio. Lumen never connects to Colab, so you don't need a
tunnel or a public link.

**One-time setup**
1. Create a secret: 32+ random characters (`openssl rand -hex 32`, or any password generator).
2. Vercel → your project → *Settings → Environment Variables*: add `WAN2GP_WORKER_SECRET` with that
   value, then redeploy.
3. Open [`cloud/colab/wan2gp_worker.ipynb`](../colab/wan2gp_worker.ipynb) in Colab (*File → Open
   notebook → GitHub*, paste this repository's URL). In the 🔑 **Secrets** panel add `LUMEN_URL`
   (your studio URL, e.g. `https://lumen.vercel.app`) and `WAN2GP_WORKER_SECRET`, and switch on
   notebook access for both.

**Each time you want AI video**
1. In a project, open a scene → *Visual* → **AI video**. Edit the prompt (describe the subject,
   the action and the camera move), then click **Queue AI video**. Queue as many scenes as you like.
2. In Colab: *Runtime → Change runtime type → T4 GPU*, then *Runtime → Run all*. The first run
   installs Wan2GP and downloads the model (about 10 minutes); after that each clip takes a few
   minutes on a T4.
3. Each scene shows *Waiting*, then *Generating*. The clip appears on its own when it's done. Until
   then the scene keeps its image, so you can still render at any time. A scene that was still
   waiting simply renders with its image.

**Good to know**
- Clips are 480p and up to 5 seconds. The renderer scales them to 1080p and loops them to cover
  longer narration. For long scenes, split the narration or use stock B-roll instead.
- Free Colab sessions end after a few hours, or sooner if the tab sits idle. A clip that was
  interrupted goes back in the queue after 45 minutes. Run the notebook again to finish it.
- The default `t2v_1.3B` model fits a free T4. Bigger models (`t2v`, `t2v_2_2`, or `i2v` to
  animate the scene's existing image) need a paid Colab GPU such as an A100, or your own PC. The
  same worker script runs on any NVIDIA machine:
  `LUMEN_URL=… WAN2GP_WORKER_SECRET=… python cloud/colab/wan2gp_worker.py --wan2gp-dir /path/to/Wan2GP`.
- Autopilot doesn't queue AI video. It keeps using AI images or stock B-roll, so it never waits
  on a GPU that might be offline.
- If a scene says *Wan2GP failed*, the error comes from the worker (often "CUDA out of memory": lower
  the frames or steps in the notebook's Settings cell). Click **Queue AI video** to try again.

## 13. Limits of the free tiers

| Limit | What it means for you |
| --- | --- |
| YouTube API: 10,000 units a day; an upload costs 1,600 | about **6 uploads a day** per Google Cloud project |
| Unaudited Google project | uploads stay private until the audit passes (step 11) |
| GitHub Actions | unlimited for public repositories; 2,000 minutes a month for private ones (a Short uses about 4) |
| Supabase free plan | 500 MB database, 1 GB storage, 50 MB per file (fine for Shorts); projects pause after a week with no activity; the autopilot's runs every 3 hours keep yours active |
| Gemini free tier | limited requests per minute and per day; the studio falls back to a lighter model when rate-limited |
| Long-form 1080p videos | can exceed 50 MB; for those, switch storage to Cloudflare R2 (see `.env.example`) |
| GitHub schedules | GitHub pauses scheduled workflows after 60 days with no commits; open **Actions**, then **Autopilot**, and re-enable it if that happens |

## 14. Troubleshooting

**Deploying**

| What you see | What to do |
| --- | --- |
| Build fails with `P1000` or `P1001` | `DIRECT_URL` is wrong. Use the Session pooler string (port 5432) with your password filled in. |
| "prepared statement … already exists" in the app | Check `DATABASE_URL` is the Transaction pooler string (port 6543). If it still happens, use the Session pooler string for both. |
| Uploading media fails with a JWT or authorisation error | Use the legacy **service_role** key for `SUPABASE_SERVICE_ROLE_KEY`. |
| Deploy complains about `maxDuration` | Turn on **Fluid Compute** under Settings, then Functions. |
| The login page shows an error instead of the password box | `STUDIO_PASSWORD` or `SESSION_SECRET` is missing or too short; fix it and redeploy. |

**Rendering**

| What you see | What to do |
| --- | --- |
| "GitHub dispatch failed with 401" | `GITHUB_DISPATCH_TOKEN` expired or was mistyped. Make a new one (step 4). |
| "… with 403" or "… with 404" | The token lacks **Contents: Read and write**, or it wasn't given access to this repository. |
| Stuck on *Waiting for a GitHub runner* | Check the **Actions** tab. After 3 hours the autopilot marks it failed. Usually `APP_URL` or `RENDER_WEBHOOK_SECRET` is missing in GitHub. |
| Run fails at "Check inputs and secrets" | Add the two GitHub secrets (step 6). |
| Run fails with 401 from the webhook | `RENDER_WEBHOOK_SECRET` differs between GitHub and Vercel. |
| "scenes … are missing audio or visuals" | Click **Generate missing assets**, then dispatch again. |
| "above the 50 MB storage limit" | Long video: use Cloudflare R2 storage, or make it shorter. |

**YouTube**

| What you see | What to do |
| --- | --- |
| `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` and the URI in Google Cloud must be identical, and you must open the studio on that same address. |
| "Access blocked … has not completed the Google verification process" | Publish the consent screen (step 7.2.4). |
| No **Connect YouTube** button | The `GOOGLE_*` variables are missing, or you didn't redeploy. |
| "Google didn't return a refresh token" | Remove Lumen Cloud at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), then connect again. |
| "Google revoked or expired this channel's authorisation" | Connect again. If it keeps happening every 7 days, the consent screen is still in *Testing*. |
| "Auto-publish failed: … quotaExceeded" | You used today's 10,000 units. It resets at midnight Pacific time; publish the rest tomorrow. |
| **YouTube kept this video private** | Normal until the audit passes (step 11). |

**Autopilot**

| What you see | What to do |
| --- | --- |
| "Autopilot channels need a posting schedule" | Set a posting schedule on the channel. |
| "Nothing due yet" | Normal: the next slot is further away than *Start production*. |
| "Planning paused for 12 hours" | A video failed 3 times. Open it, fix the cause (often an API key or quota), and delete or retry it. |
| Nothing happens every 3 hours | Check **Actions**, then **Autopilot**: the workflow must be enabled, and both GitHub secrets set. |

If you're stuck, copy the exact error from the video page or the GitHub Actions log and ask for
help with it.

## 15. Security and maintenance

- Only you should know `STUDIO_PASSWORD`. Anyone with it can publish to your channel. Changing it
  (then redeploying) signs every browser out.
- Never share the service_role key, the GitHub token or the secrets. If one leaks, replace it
  where you got it, update Vercel (and GitHub for `RENDER_WEBHOOK_SECRET`), and redeploy.
- Don't change `TOKEN_ENCRYPTION_KEY`. If you must, reconnect YouTube afterwards.
- **Disconnect** on a channel cancels the app's access at Google and deletes the stored tokens.
- Renew the GitHub token before it expires.
- Updates: when new code is merged into the repository's default branch, Vercel redeploys on its
  own and applies any database changes.

## 16. Quick reference: every setting

| Variable | Required | What it is |
| --- | --- | --- |
| `STUDIO_PASSWORD` | yes | your studio login, 12+ characters |
| `SESSION_SECRET` | yes | random; signs the login cookie |
| `DATABASE_URL` | yes | Supabase Transaction pooler (port 6543) |
| `DIRECT_URL` | yes | Supabase Session pooler (port 5432), used for database updates |
| `STORAGE_DRIVER` | yes | `supabase`, or `r2` for Cloudflare R2 |
| `SUPABASE_URL` | yes | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service_role key |
| `SUPABASE_STORAGE_BUCKET` | yes | `lumen-media` (public bucket) |
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | no | override the Gemini models |
| `PEXELS_API_KEY` | for stock video | Pexels key |
| `POLLINATIONS_TOKEN` | no | raises the AI image rate limit |
| `ELEVENLABS_API_KEY` | for ElevenLabs voices | ElevenLabs API key |
| `WAN2GP_WORKER_SECRET` | for AI video | random; also a Colab secret for the Wan2GP worker |
| `GITHUB_DISPATCH_TOKEN` | yes | GitHub fine-grained token |
| `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` | yes | `gyuv`, `youtube-ai-agent` |
| `RENDER_WEBHOOK_SECRET` | yes | random; also a GitHub secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for YouTube | Google OAuth client |
| `GOOGLE_REDIRECT_URI` | for YouTube | `https://<your address>/api/oauth/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | for YouTube | random; encrypts YouTube tokens, never change it |
| `YOUTUBE_CATEGORY_ID` | no | upload category: 22 People & Blogs (default), 27 Education, 28 Science & Technology |
| `PUBLIC_OPERATOR_NAME`, `PUBLIC_CONTACT_EMAIL` | for the audit | shown on `/privacy` and `/terms` |
| `STORAGE_MAX_OBJECT_MB` | no | raise only if your storage plan allows larger files |
| `R2_*` | only with `STORAGE_DRIVER=r2` | Cloudflare R2 bucket details (see `.env.example`) |

**GitHub repository secrets:** `APP_URL` (your studio address) and `RENDER_WEBHOOK_SECRET`.
Optionally `REMOTION_LICENSE_KEY`, only for companies of more than 3 people.
