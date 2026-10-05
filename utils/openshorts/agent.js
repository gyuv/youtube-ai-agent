const { OPENSHORTS_TOOLS, toOpenAITools, toGeminiFunctionDeclarations, createOpenShortsToolExecutor } = require('./tools');

const SYSTEM_PROMPT = [
  'You turn long YouTube videos into 9:16 shorts with the OpenShorts tools.',
  'Pass the URL the user gave you to the tools exactly as written; do not try to open or summarise it yourself.',
  'Only process videos the user has said they own or have rights to; if they have not said so, ask once, then pass confirm_rights=true.',
  'Prefer clip_youtube_video, which submits, waits and downloads in one call. If you use process_video instead,',
  'call get_job_status until the status is completed or failed, then list_clips.',
  'If a tool returns retryable=true, the backend is busy: say so instead of calling it in a tight loop.',
  'Only call publish_clip when the user asked to publish. Finish with a short list of the clips: title, duration and file path or URL.'
].join(' ');

/**
 * Let the agent's configured LLM drive OpenShorts with function calling.
 *
 * Works with either provider AITextService sets up: Gemini (@google/genai)
 * or any OpenAI-compatible endpoint (OpenAI, OpenRouter, Kimi, GLM...).
 * Returns { text, toolCalls, clips } where `clips` are the downloaded assets
 * from the last successful clip_youtube_video / list_clips call, ready to
 * hand to the publishing agent.
 */
async function runOpenShortsAgent(aiText, userMessage, options = {}) {
  const execute = options.execute || createOpenShortsToolExecutor({ logger: options.logger, onProgress: options.onProgress });
  const maxSteps = options.maxSteps || 12;
  const toolCalls = [];
  let clips = null;

  const runTool = async (name, args) => {
    const outcome = await execute(name, args);
    toolCalls.push({ name, args, ok: outcome.ok, error: outcome.error });
    if (outcome.ok && Array.isArray(outcome.result?.clips)) clips = outcome.result.clips;
    return outcome;
  };

  if (aiText?.gemini) {
    const contents = [{ role: 'user', parts: [{ text: userMessage }] }];
    for (let step = 0; step < maxSteps; step += 1) {
      const response = await aiText.gemini.models.generateContent({
        model: options.model || aiText.model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: toGeminiFunctionDeclarations(OPENSHORTS_TOOLS) }]
        }
      });
      const calls = response.functionCalls || [];
      if (!calls.length) return { text: response.text || '', toolCalls, clips };
      contents.push(response.candidates[0].content);
      const parts = [];
      for (const call of calls) {
        const outcome = await runTool(call.name, call.args || {});
        parts.push({ functionResponse: { id: call.id, name: call.name, response: outcome } });
      }
      contents.push({ role: 'user', parts });
    }
    return { text: 'Stopped: too many tool steps.', toolCalls, clips };
  }

  if (aiText?.client) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ];
    for (let step = 0; step < maxSteps; step += 1) {
      const completion = await aiText.client.chat.completions.create({
        model: options.model || aiText.model,
        messages,
        tools: toOpenAITools(OPENSHORTS_TOOLS)
      });
      const message = completion.choices[0].message;
      messages.push(message);
      if (!message.tool_calls?.length) return { text: message.content || '', toolCalls, clips };
      for (const call of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          // fall through with empty args; the tool reports what is missing
        }
        const outcome = await runTool(call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) });
      }
    }
    return { text: 'Stopped: too many tool steps.', toolCalls, clips };
  }

  throw new Error('No AI text provider configured: set GEMINI_API_KEY or an OpenAI-compatible key.');
}

module.exports = { runOpenShortsAgent, SYSTEM_PROMPT };
