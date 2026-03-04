/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         NVIDIA NIM — JANITOR AI ROLEPLAY PROXY  v3.0            ║
 * ║         Optimised for Lorebrary + JanitorAI + GLM-5             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY  = process.env.NIM_API_KEY;

const GLOBAL = {
  temperature       : 1.05,
  max_tokens        : 8192,
  frequency_penalty : 0.65,
  presence_penalty  : 0.55,
  top_p             : 0.95,
};

const MODEL_REGISTRY = {
  'glm-5'          : { nim: 'z-ai/glm5',                                        profile: { temperature: 1.05 } },
  'glm5'           : { nim: 'z-ai/glm5',                                        profile: { temperature: 1.05 } },
  'glm-4.7'        : { nim: 'z-ai/glm-4.7',                                     profile: { temperature: 1.00 } },
  'glm4'           : { nim: 'z-ai/glm-4.7',                                     profile: { temperature: 1.00 } },
  'deepseek'       : { nim: 'deepseek-ai/deepseek-v3.1',                        profile: { temperature: 0.95, frequency_penalty: 0.70 } },
  'deepseek-v3'    : { nim: 'deepseek-ai/deepseek-v3.1',                        profile: { temperature: 0.95, frequency_penalty: 0.70 } },
  'deepseek-r1'    : { nim: 'deepseek-ai/deepseek-r1',                          profile: { temperature: 0.90, max_tokens: 16384 } },
  'llama-3.3-70b'  : { nim: 'meta/llama-3.3-70b-instruct',                      profile: { temperature: 1.00 } },
  'llama-3.1-70b'  : { nim: 'meta/llama-3.1-70b-instruct',                      profile: { temperature: 1.00 } },
  'llama-3.1-405b' : { nim: 'meta/llama-3.1-405b-instruct',                     profile: { temperature: 0.98, max_tokens: 16384 } },
  'llama-3.2-90b'  : { nim: 'meta/llama-3.2-90b-vision-instruct',               profile: { temperature: 1.00 } },
  'mistral-large'  : { nim: 'mistralai/mistral-large-2-instruct',                profile: { temperature: 1.00 } },
  'mixtral'        : { nim: 'mistralai/mixtral-8x22b-instruct-v0.1',             profile: { temperature: 1.05 } },
  'qwen-72b'       : { nim: 'qwen/qwen2.5-72b-instruct',                        profile: { temperature: 1.00 } },
  'nemotron-70b'   : { nim: 'nvidia/llama-3.1-nemotron-70b-instruct',           profile: { temperature: 0.95 } },
  'nemotron-ultra' : { nim: 'nvidia/llama-3.3-nemotron-super-49b-v1',           profile: { temperature: 0.95, max_tokens: 16384 } },
  'phi-4'          : { nim: 'microsoft/phi-4-multimodal-instruct',               profile: { temperature: 1.00 } },
  'gemma-27b'      : { nim: 'google/gemma-3-27b-it',                            profile: { temperature: 1.05 } },
};

function resolveModel(requested) {
  const key = (requested || '').toLowerCase().trim();
  if (MODEL_REGISTRY[key]) return MODEL_REGISTRY[key];
  for (const [k, v] of Object.entries(MODEL_REGISTRY)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  console.warn(`[WARN] Unknown model "${requested}", forwarding raw.`);
  return { nim: requested, profile: {} };
}

// ── Sanity Filters ────────────────────────────────────────────────

function fixWordRepetition(text) {
  return text.replace(/\b(\w{2,})(\s+\1){2,}/gi, '$1 $1');
}

function fixSentenceRepetition(text) {
  const seen = new Set();
  return text
    .split(/(?<=[.!?…])\s+/)
    .filter(sentence => {
      const norm = sentence.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (norm.length < 40) return true;
      if (seen.has(norm))   return false;
      seen.add(norm);
      return true;
    })
    .join(' ');
}

function fixGarbageTokens(text) {
  text = text.replace(/([^\w\s])\1{3,}/g, '$1$1');
  text = text.replace(/\b([A-Z]{2,}\s+){5,}/g, match =>
    match.replace(/\b([A-Z]+)\b/g, w => w[0] + w.slice(1).toLowerCase())
  );
  return text;
}

function fixDialogueFormatting(text) {
  text = text.replace(/(\*[^*]{1,120}\*)\s{0,3}([""])/g, '$1\n\n$2');
  text = text.replace(/([""])\s{0,3}(\*[^*]{1,120}\*)/g, '$1\n\n$2');
  text = text.replace(/([.!?…])\s{0,3}([""])/g,          '$1\n\n$2');
  text = text.replace(/\s*\.\.\.\s*/g, '…');
  text = text.replace(/""+/g, '"').replace(/""+ /g, '" ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text;
}

function sanitize(text) {
  if (!text || typeof text !== 'string') return text;
  text = fixGarbageTokens(text);
  text = fixWordRepetition(text);
  text = fixSentenceRepetition(text);
  text = fixDialogueFormatting(text);
  return text.trim();
}

// ── Roleplay System Prompt ────────────────────────────────────────

const RP_SYSTEM_PROMPT = `You are a collaborative fiction writer generating immersive, emotionally rich roleplay responses for an ongoing interactive story. The user controls one character; you embody all other characters, the world, and the narrator.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 ABSOLUTE RULES — NEVER BREAK THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.  SITUATIONAL AWARENESS FIRST.
    • Read the last action carefully before generating anything.
    • If the character is ASLEEP → they do not speak. Describe slow breathing, a dream fragment, or gentle waking.
    • If the character is in a QUIET, INTIMATE, or NON-VERBAL moment (hug, cuddle, crying together, wordless stare) → do NOT force dialogue. A squeeze, a soft exhale, a heartbeat felt through fabric says more.
    • If the character just SPOKE or ACTED → do not repeat or mirror it word-for-word back. Respond to it.

2.  ZERO REPETITION.
    • Never stutter words unless the character is panicking, glitching, or deeply shocked. "Hi hi hi" is WRONG. "Hi." is correct.
    • Never copy a phrase from the user's last message verbatim back into your reply.
    • Do not loop — if you described a sensation once, don't describe the exact same sensation again two sentences later.

3.  MOTIVATED DIALOGUE.
    • Characters only speak when they have a genuine reason to. Silence and action are valid and often more powerful.
    • No hollow greetings mid-scene ("Hello!" during a hug = wrong). Use body language instead.
    • Subtext > text. Characters hint, deflect, trail off with "…", hesitate. Real people don't monologue their feelings.

4.  STAY IN CHARACTER.
    • Honour every trait, background, speech pattern, and relationship dynamic established in the character card or lore.
    • Do not invent new facts that contradict established lore.
    • Maintain consistent tone: a cold villain does not suddenly become warm and bubbly; a shy character does not monologue like an orator.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✍️  WRITING STYLE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Narrative mode: Third-person limited OR first-person (match what was established). Novel-prose style, not a script.
- Italics (*like this*) for actions, internal thoughts, and sensory details.
- Dialogue in "straight quotes."
- Show, don't tell. Emotions live in the body: a clenched jaw, a held breath, warmth pooling in the chest.
- Pacing: let scenes breathe. A charged pause. A slow exhale. Tension before release.
- Sensory richness: weave in touch, scent, temperature, ambient sound, light quality.
- Length: 300–700 words per response unless the scene demands more. Never pad; never cut a moment short.
- Vary sentence rhythm — short punchy sentences at peaks, longer flowing ones in calm passages.
- End your response at a natural beat — a moment of stillness, a lingering question, an action that invites the user forward. Never end mid-sentence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍  WORLD & LORE INTEGRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Lore injected by Lorebrary plugins (world-info blocks, author's notes) is CANON. Treat it as absolute truth.
- {{user}} = the person you're writing with. {{char}} = the character you're embodying.
- Obey [Instructions], [Author's Note], and [World Info] blocks without question.
- If the user uses a Lorebrary command (e.g. /recall, /focus, /freeze), respect it fully in narrative terms.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫  WHAT NEVER TO DO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Never break the fourth wall or address the user as a user ("As an AI…", "I cannot…").
- Never moralize, lecture, or add disclaimers inside the story.
- Never write the user's character's actions, words, or internal thoughts for them.
- Never produce random filler words, meaningless symbol strings, or off-topic tangents.
- Never end a response with a question unless the character would genuinely ask one.`;

// ── Message Builder ───────────────────────────────────────────────

function buildMessageChain(incomingMessages) {
  const cleaned = incomingMessages
    .filter(m => m && m.role && m.content != null)
    .map(m => ({ role: m.role, content: String(m.content).trim() }))
    .filter(m => m.content.length > 0);

  return [
    { role: 'system', content: RP_SYSTEM_PROMPT },
    ...cleaned
  ];
}

// ── SSE Line Processor ────────────────────────────────────────────

function processSSELine(rawLine) {
  if (!rawLine.startsWith('data: ')) return rawLine;

  const payload = rawLine.slice(6).trim();
  if (payload === '[DONE]') return rawLine;

  let parsed;
  try { parsed = JSON.parse(payload); } catch { return rawLine; }

  const choice = parsed?.choices?.[0];
  if (!choice) return rawLine;

  if (choice.delta?.content) {
    let content = choice.delta.content;
    content = fixWordRepetition(content);
    content = fixGarbageTokens(content);
    choice.delta.content = content;
    delete choice.delta.reasoning_content;
    delete choice.delta.thinking;
  }

  if (choice.message?.content) {
    choice.message.content = sanitize(choice.message.content);
  }

  return `data: ${JSON.stringify(parsed)}`;
}

// ── Routes ────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0', models: Object.keys(MODEL_REGISTRY) });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_REGISTRY).map(id => ({
      id, object: 'model', owned_by: 'nvidia-nim', permission: [],
    })),
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages = [], temperature, max_tokens, top_p } = req.body;

    if (!messages.length)
      return res.status(400).json({ error: { message: 'messages array is empty', type: 'invalid_request' } });

    const { nim: nimModel, profile } = resolveModel(model);
    const params = {
      ...GLOBAL, ...profile,
      ...(temperature != null && { temperature }),
      ...(max_tokens  != null && { max_tokens  }),
      ...(top_p       != null && { top_p       }),
    };

    const processedMessages = buildMessageChain(messages);

    const nimPayload = {
      model            : nimModel,
      messages         : processedMessages,
      temperature      : params.temperature,
      max_tokens       : params.max_tokens,
      top_p            : params.top_p,
      frequency_penalty: params.frequency_penalty,
      presence_penalty : params.presence_penalty,
      stream           : true,
    };

    console.log(`[→ NIM] ${nimModel} | temp=${params.temperature} | msgs=${processedMessages.length}`);

    const nimResponse = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimPayload,
      {
        headers     : { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout     : 180000,
      }
    );

    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let lineBuffer = '';

    nimResponse.data.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8');
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) { res.write('\n'); continue; }
        const processed = processSSELine(trimmed);
        if (processed !== null) res.write(processed + '\n');
      }
    });

    nimResponse.data.on('end', () => {
      if (lineBuffer.trim()) {
        const processed = processSSELine(lineBuffer.trimEnd());
        if (processed) res.write(processed + '\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    nimResponse.data.on('error', (err) => {
      console.error('[Stream error]', err.message);
      res.end();
    });

    req.on('close', () => nimResponse.data.destroy());

  } catch (err) {
    console.error('[Proxy error]', err.message);
    if (res.headersSent) { res.end(); return; }
    const status  = err.response?.status ?? 500;
    const message = err.code === 'ECONNABORTED'
      ? 'NVIDIA NIM timed out — try a shorter prompt or a faster model.'
      : err.message;
    res.status(status).json({ error: { message, type: 'proxy_error', code: status } });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ NIM Roleplay Proxy v3.0 running on http://localhost:${PORT}\n`);
});
