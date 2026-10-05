const { OpenShortsClient } = require('./client');
const { OpenShortsWorkflow } = require('./workflow');
const { OpenShortsError } = require('./errors');

/**
 * OpenShorts tools for the agent's LLM, in provider-neutral JSON Schema.
 * Names and arguments mirror OpenShorts' own MCP tools so prompts and docs
 * written for either stay valid. `clip_youtube_video` is the one-call
 * workflow (submit, poll, download) for autonomous runs.
 */
const SUBTITLE_PRESETS = ['default', 'hormozi', 'pill', 'lime', 'oneword', 'clean'];
const HOOK_STYLES = ['classic', 'dark', 'yellow', 'red', 'outline', 'outline_yellow'];
const LAYOUTS = ['auto', 'split', 'screencast', 'speaker_cut', 'punch_in'];

const OPENSHORTS_TOOLS = [
  {
    name: 'process_video',
    description:
      'Submit a long YouTube video to OpenShorts, which downloads it, transcribes it with Whisper, picks the most viral ' +
      'moments with Gemini and renders 9:16 clips with face tracking and burned captions. Returns a job_id immediately; ' +
      'the work takes minutes, so poll get_job_status. Only for videos the user owns or has rights to.',
    parameters: {
      type: 'object',
      properties: {
        source_url: { type: 'string', description: 'The YouTube URL exactly as the user gave it.' },
        confirm_rights: { type: 'boolean', description: 'Must be true: the user owns the video or has rights to process it.' },
        captions: { type: 'boolean', description: 'Burn word-level captions (default true). False if the source already has burned-in subtitles.' },
        auto_hook: { type: 'boolean', description: 'Burn the AI hook line over the first seconds (default true).' },
        hook_style: { type: 'string', enum: HOOK_STYLES, description: 'Look of the hook text. Default classic.' },
        target_clips: { type: 'integer', minimum: 1, maximum: 15, description: 'How many clips to aim for (a target, not a guarantee).' },
        clip_min_seconds: { type: 'number', minimum: 5, maximum: 175, description: 'Minimum clip length, default 15.' },
        clip_max_seconds: { type: 'number', minimum: 10, maximum: 180, description: 'Maximum clip length, default 60.' },
        layouts: { type: 'array', items: { type: 'string', enum: LAYOUTS }, description: 'Optional extra reframe layouts.' },
        force_low_quality: { type: 'boolean', description: 'Proceed after a low-resolution (below 720p) warning.' }
      },
      required: ['source_url', 'confirm_rights']
    }
  },
  {
    name: 'get_job_status',
    description: "Status of an OpenShorts job: 'queued', 'processing', 'completed' or 'failed', with recent log lines and, once completed, the clips.",
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id']
    }
  },
  {
    name: 'list_clips',
    description: 'The finished 9:16 clips of a completed job: index, title, duration, download URL and platform-ready titles/descriptions.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id']
    }
  },
  {
    name: 'publish_clip',
    description:
      "Post one clip through OpenShorts' social publishing (Upload-Post): TikTok (lands as a draft), Instagram Reels, YouTube Shorts. " +
      'Needs UPLOAD_POST_API_KEY on OpenShorts. To publish to YouTube with this agent\'s own channel instead, download the clip and use the agent\'s publishing flow.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        clip_index: { type: 'integer', description: '0-based index from list_clips.' },
        platforms: { type: 'array', items: { type: 'string', enum: ['tiktok', 'instagram', 'youtube'] }, minItems: 1 },
        title: { type: 'string' },
        description: { type: 'string' },
        scheduled_date: { type: 'string', description: 'ISO-8601; omit to post now.' },
        timezone: { type: 'string' }
      },
      required: ['job_id', 'clip_index', 'platforms']
    }
  },
  {
    name: 'clip_youtube_video',
    description:
      'One call that does the whole job: submits a long YouTube video to OpenShorts, waits until rendering finishes ' +
      '(handling rate limits, failed downloads and face-tracking failures), optionally restyles captions, and downloads ' +
      'the 9:16 MP4s. Returns the local file paths and titles ready for publishing. Takes several minutes.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Long-form YouTube URL.' },
        confirm_rights: { type: 'boolean', description: 'Must be true: the user owns the video or has rights to clip it.' },
        subtitle_preset: { type: 'string', enum: SUBTITLE_PRESETS, description: 'Caption style. default: Anton caps; hormozi: word-by-word; pill/lime: boxed active word; oneword; clean.' },
        captions: { type: 'boolean', description: 'Burn captions (default true).' },
        hook_style: { type: 'string', enum: HOOK_STYLES },
        target_clips: { type: 'integer', minimum: 1, maximum: 15 },
        clip_max_seconds: { type: 'number', minimum: 10, maximum: 180 },
        allow_low_quality: { type: 'boolean', description: 'Clip sources below 720p anyway.' }
      },
      required: ['url', 'confirm_rights']
    }
  }
];

/** Tools in OpenAI / OpenRouter chat-completions format. */
function toOpenAITools(tools = OPENSHORTS_TOOLS) {
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Tools as Gemini function declarations (@google/genai `tools: [{ functionDeclarations }]`). */
function toGeminiFunctionDeclarations(tools = OPENSHORTS_TOOLS) {
  return tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
}

function createOpenShortsToolExecutor(options = {}) {
  const client = options.client || new OpenShortsClient({ logger: options.logger });
  const workflow = options.workflow || new OpenShortsWorkflow({ client, logger: options.logger });

  const handlers = {
    process_video: args => client.processVideo({ ...args, output_format: 'vertical' }),
    get_job_status: args => client.getJobStatus(args.job_id),
    list_clips: async args => {
      const data = await client.listClips(args.job_id);
      return { ...data, clips: (data.clips || []).map(c => ({ ...c, video_url: client.resolveUrl(c.video_url) })) };
    },
    publish_clip: args => client.publishClip(args),
    clip_youtube_video: args =>
      workflow.clipVideo({
        url: args.url,
        confirmRights: args.confirm_rights === true,
        subtitlePreset: args.subtitle_preset,
        captions: args.captions,
        hookStyle: args.hook_style,
        targetClips: args.target_clips,
        clipMaxSeconds: args.clip_max_seconds,
        allowLowQuality: args.allow_low_quality,
        onProgress: options.onProgress
      })
  };

  /**
   * Run one tool call from the LLM. Never throws: errors come back as
   * `{ ok: false, error, kind, retryable }` so the model can react (wait,
   * ask the user, change parameters) instead of the run crashing.
   */
  return async function executeOpenShortsTool(name, args = {}) {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: `Unknown OpenShorts tool: ${name}` };
    try {
      return { ok: true, result: await handler(args || {}) };
    } catch (error) {
      if (error instanceof OpenShortsError) {
        return { ok: false, error: error.message, kind: error.kind, retryable: error.retryable };
      }
      return { ok: false, error: error.message || String(error) };
    }
  };
}

const isOpenShortsTool = name => OPENSHORTS_TOOLS.some(t => t.name === name);

module.exports = {
  OPENSHORTS_TOOLS,
  SUBTITLE_PRESETS,
  toOpenAITools,
  toGeminiFunctionDeclarations,
  createOpenShortsToolExecutor,
  isOpenShortsTool
};
