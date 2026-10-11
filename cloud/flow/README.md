# Google Flow worker

Animates each video's **hook** (scene 1) with [Google Flow](https://flow.google.com) through
[flow-mcp](https://github.com/GTAI-1/flow-mcp), using Flow's free daily credits, starring your channel's host.

flow-mcp drives a real Chrome window signed into your Google account, so this runs on **your own
computer**, not in the cloud. The studio never calls it; the worker polls the studio, so it needs no
public address.

```
Studio (Vercel) ──plans + queues──▶ /api/flow/claim ◀──polls── flow-worker.mjs ──▶ flow-mcp ──▶ Chrome ──▶ Flow
```

## How credits are protected

- **Script Lab plans first.** Before anything is queued, it reads the hook and decides whether motion
  clearly beats the still image, then writes the exact shot. If not, the scene keeps its image and no
  credit is spent.
- **15 credits per clip, at most.** Passed to Flow as `max_credits`: Flow's own price quote is read
  before generating, and an over-cap clip is skipped with nothing spent.
- **25 credits a day.** The worker keeps a ledger (`~/.flow-mcp/lumen-ledger.json`) and only starts a
  clip when at least 15 are left today. That is one clip a day, two when Flow quotes 12 or less.
- **No waiting forever.** If your computer is off, the studio waits up to 4 hours, then posts the
  video with the still image.

## Setup

1. Install flow-mcp and sign in (see its README): `npm install && npm run build && npm run login`.
2. Start its panel and leave it running: `npm run studio`.
3. In Vercel, add `FLOW_WORKER_SECRET` (32+ random characters) and redeploy.
4. On the channel page in the studio: turn on **Animate each video's hook with Google Flow**, and
   optionally **Design with Script Lab** a host, then save.
5. Run the worker (Node 22+, no install):

   ```bash
   LUMEN_URL=https://your-studio.vercel.app FLOW_WORKER_SECRET=... node flow-worker.mjs
   ```

   On Windows PowerShell: `$env:LUMEN_URL="..."; $env:FLOW_WORKER_SECRET="..."; node flow-worker.mjs`

Keep the computer awake while it runs: Flow is driven through a real browser window.

## Settings

| Variable | Default | |
|---|---|---|
| `FLOW_MAX_CREDITS` | `15` | Cap per clip (never above 25) |
| `FLOW_DAILY_CREDITS` | `25` | Your daily Flow credits |
| `FLOW_POLL_SECONDS` | `120` | How often to ask the studio for work |
| `FLOW_MODEL` | Flow's current | e.g. `Omni 1.1 Flash` |
| `FLOW_DURATION` / `FLOW_RESOLUTION` | Flow's current | Omni models only: `4`/`6`/`8`/`10`, `360p`/`720p` |
| `FLOW_MCP_PORT` / `FLOW_MCP_HOME` | `8787` / `~/.flow-mcp` | Where flow-mcp listens and keeps its token |

`node flow-worker.mjs --once` does one round and exits (handy for a scheduled task).

## The channel host

With a host set, the worker creates it once as a Flow character (the portrait is free) and attaches it
to every clip, so the same face opens every video. Flow can attach a character **or** start from the
scene's image, never both, so channels with a host get the host and channels without one get the
image animated.

## Risk

flow-mcp automates Flow's web interface. It can break when Google changes that interface, and its
author notes automated use may be against Google's terms. Use it on your own account, at your own risk.
