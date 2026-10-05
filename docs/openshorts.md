# Long-video clipping with OpenShorts

The agent can turn a long YouTube video into vertical 9:16 shorts using a self-hosted
[OpenShorts](https://github.com/mutonby/openshorts) backend. OpenShorts downloads the video,
transcribes it with Whisper, detects scenes, picks the strongest moments with Gemini, reframes
with MediaPipe face tracking (falling back to YOLO person detection) and renders the clips with
FFmpeg, burning in captions and a hook line.

Only clip videos you own or have the rights to process. Every entry point requires
`confirmRights` / `confirm_rights` to be `true`.

## Run it

```bash
cp .env.example .env          # set GEMINI_API_KEY
docker compose up -d --build  # agent on :3456, OpenShorts on the private network
```

There is no published OpenShorts image, so Compose builds it from its GitHub repository. The
first build downloads its ML stack and takes a while. On an NVIDIA GPU, set
`OPENSHORTS_WHISPER_MODEL=large-v3-turbo`, `OPENSHORTS_WHISPER_DEVICE=cuda` and
`OPENSHORTS_WHISPER_COMPUTE=float16`, and give the service a GPU reservation.

## Use it

| How | Call |
| --- | --- |
| Command line | `npm run openshorts:clip -- <youtube-url> --confirm-rights [--preset hormozi] [--clips 5]` |
| HTTP, background | `POST /api/openshorts/clip` with `{ "url": "...", "confirmRights": true, "subtitlePreset": "hormozi" }`, then `GET /api/openshorts/runs/<runId>` |
| HTTP, one tool | `POST /api/openshorts/tools/<process_video\|get_job_status\|list_clips\|publish_clip\|clip_youtube_video>` |
| LLM tool calling | `runOpenShortsAgent(aiText, "Clip https://youtu.be/... into 5 shorts, I own it")` in `utils/openshorts/agent.js` |
| Your own loop | `OPENSHORTS_TOOLS`, `toOpenAITools()`, `toGeminiFunctionDeclarations()` and `createOpenShortsToolExecutor()` in `utils/openshorts/tools.js` |

The HTTP routes that start work use the agent's `API_KEY` (`x-api-key` header) when it is set.

Clips are saved to `data/openshorts/<job_id>/clip-NN.mp4`. Each result also includes the title,
the YouTube Shorts title, the TikTok and Instagram descriptions and the duration, which you can
pass to the publishing agent.

## How failures are handled

| Problem | What happens |
| --- | --- |
| HTTP 429, 5xx or network errors | Retried with exponential backoff (honours `Retry-After`) |
| YouTube refuses the download | Retried once after a pause, then fails with a hint to set `YOUTUBE_COOKIES` on the OpenShorts container |
| Face tracking fails | If face-based layouts (`split`, `speaker_cut`, ...) were requested, it resubmits without them; the default tracker falls back to person detection or a centre crop on its own |
| Gemini quota in the job | Retried once after 5 minutes |
| Source below 720p | Stops with `low_quality`; rerun with `allowLowQuality` |
| A caption restyle fails on a clip | That clip keeps the default captions |
| One clip fails to download | The others are still returned; that clip has a `downloadError` |
| Job runs longer than 45 minutes | Stops with `timeout`; the job may still finish, so check it with `get_job_status` |

## Webhooks vs polling

OpenShorts only delivers webhooks to public URLs; it rejects Docker-network addresses such as
`http://agent:3456`. Inside Compose, the agent polls every 30-60 seconds. If the agent is
reachable from the internet, set `OPENSHORTS_WEBHOOK_URL` (and `OPENSHORTS_WEBHOOK_SECRET` to
verify the `X-OpenShorts-Signature` HMAC); polling still runs as a slower safety net.
