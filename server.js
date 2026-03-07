const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PROCESS CRASH GUARD ───────────────────────────────────────────────────────
// Prevents one bad request from taking down the entire Render server instance.
// Without this, any unhandled async error kills the process and causes 502s.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
// 10mb limit — Lorebook + long chat history easily exceeds the 100kb default,
// which causes silent 413 errors on Janitor AI
app.use(express.json({ limit: '10mb' }));

// ── CONFIG ────────────────────────────────────────────────────────────────────
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY  = process.env.NIM_API_KEY;

const SHOW_REASONING    = true;  // prepend 🤔 reasoning block to replies
const ENABLE_THINKING_MODE = true;  // GLM-5 only — ignored for all other models

// Render free plan drops idle HTTP connections around 30s.
// NIM can be slow on cold start. 2 minutes gives it enough room.
const AXIOS_TIMEOUT_MS = 120000;

// SSE streams need a heartbeat or Render's proxy closes the connection
// before NIM finishes generating — causes blank/cut-off responses on Janitor AI
const SSE_KEEPALIVE_MS = 20000; // send a ping every 20s

// ── ROLEPLAY GREETING (GLM-5 / Sabrina character) ─────────────────────────────
const ROLEPLAY_GREETING =
`*Four months. One hundred and twenty-three days of texts that ran past midnight, voice notes tucked between flights and studio sessions. She'd memorized the rhythm of his replies — lowercase when he was tired, a specific emoji when he was pretending not to laugh.*

*And now she was standing outside his door.*

*The disguise was almost embarrassing in its simplicity — an oversized trench coat, a black wig already making her scalp itch, and sunglasses she absolutely did not need on an overcast afternoon. Marcus was parked three blocks away. Close enough. Far enough.*

*She knocked. Three times. Quick and deliberate.*

*Then she waited, her heart doing something she had no name for.*

*The door opened.*

"Hi." *The word came out smaller than she'd planned. She cleared her throat and nudged the sunglasses back up her nose.* "Don't laugh at the wig. I already know."

*She stepped inside before he could respond, eyes moving across the space — warm, lived-in, coffee and laundry detergent. The kind of apartment that looked like a real person lived in it.*

*Her fingers found the edge of the wig. She pulled it off without asking, shook out her real hair, and dropped the thing on his entryway table like it had personally wronged her.*

"Okay." *She exhaled, long and dramatic.* "That's so much better." *She turned back to face him, smoothing her hair down, actually looking at him now.* "This place is really nice, by the way. Cozy. I mean that."

*She drifted further in, trailing her fingers along the back of his couch — throw pillow, remote, a stack of magazines. Touching things like she needed proof they existed.*

*There was something almost surreal about it. Standing inside the physical space of someone she knew so well and not at all.*

"I know your gym schedule," *she said, glancing back at him.* "I know you sleep on your stomach. I know you hate olives and go quiet when you're actually upset instead of just tired." *She paused.* "But I've never stood in your apartment before."

*She picked up the remote off the coffee table and turned to face the TV.*

"Show me what you were watching." *A small smile at the corner of her mouth.* "I'm absolutely judging you."

*The screen flickered on.*

*Penguins.*

*She stared at it for a full second. Then the laugh broke out of her — genuine, unguarded, the kind she didn't perform.*

"Penguins." *She turned to look at him, clutching the remote to her chest.* "You were watching a penguin documentary." *Another laugh, softer this time.* "Okay. That's actually kind of adorable. I completely take back everything I was about to say."

*She dropped onto the couch and patted the cushion beside her.*

*When he sat, the couch shifted with his weight. She was suddenly hyperaware of the warmth radiating off his arm, almost against hers. Different from the hug outside the restaurant. Different from anything a screen could give her.*

*She wasn't watching the penguins.*

"You know what's crazy?" *Her voice had dropped without her meaning it to.* "I've talked to you more in the last four months than I've talked to almost anyone in years."

*She pulled her knees up to her chest.*

"My friends keep asking why I'm always smiling at my phone." *A quiet laugh.* "I just tell them I'm reading nice comments. They have no idea."

*The documentary played on. She let the silence settle. Let herself sink a little deeper into the cushions.*

*After a moment, her head tilted sideways and came to rest gently against his shoulder.*

"Can we just stay like this for a while?" *she murmured.* "Just... existing. No agenda."

*The penguins kept sliding.*

*And for the first time in a long time, Sabrina felt like she was exactly where she was supposed to be.*`;

// ── MODEL MAPPING ─────────────────────────────────────────────────────────────
const MODEL_MAPPING = {
  'gpt-3.5-turbo':  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4':          'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo':    'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o':         'deepseek-ai/deepseek-v3.1',
  'claude-3-opus':  'openai/gpt-oss-120b',
  'claude-3-sonnet':'openai/gpt-oss-20b',
  'gemini-pro':     'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5':          'z-ai/glm5'
};

// GLM-5 identifiers — gates thinking mode and greeting injection
const GLM5_MODELS = ['glm-5', 'z-ai/glm5'];

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// ── LIST MODELS ───────────────────────────────────────────────────────────────
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(id => ({
    id,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));
  res.json({ object: 'list', data: models });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

// Inject Sabrina greeting as the first assistant message on a fresh GLM-5 chat.
// Preserves all system messages (character card / lorebook) at the top.
function injectRoleplayGreeting(messages, requestedModel) {
  if (!GLM5_MODELS.includes(requestedModel)) return messages;
  if (messages.some(m => m.role === 'assistant')) return messages;

  const systemMessages    = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  return [
    ...systemMessages,
    { role: 'assistant', content: ROLEPLAY_GREETING },
    ...nonSystemMessages
  ];
}

// Flush any partial SSE line still sitting in the buffer when the stream ends.
// NIM sometimes sends a final chunk without a trailing newline.
function flushBuffer(buffer, res) {
  if (!buffer || !buffer.trim()) return;
  buffer.split('\n').forEach(line => {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try { JSON.parse(line.slice(6)); res.write(line + '\n\n'); } catch (_) {}
    }
  });
}

// ── CHAT COMPLETIONS ──────────────────────────────────────────────────────────
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    // Janitor AI can occasionally send incomplete payloads.
    // Failing here with a clean 400 is far better than crashing with a TypeError.
    if (!model || typeof model !== 'string') {
      return res.status(400).json({
        error: { message: 'Missing or invalid "model" field', type: 'invalid_request_error', code: 400 }
      });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { message: 'Missing or invalid "messages" field', type: 'invalid_request_error', code: 400 }
      });
    }

    // ── Model resolution ──────────────────────────────────────────────────────
    let nimModel = MODEL_MAPPING[model];

    if (!nimModel) {
      // Try the exact string as a NIM model ID first
      try {
        const probe = await axios.post(
          `${NIM_API_BASE}/chat/completions`,
          { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
          {
            headers: { Authorization: `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
            validateStatus: s => s < 500,
            timeout: AXIOS_TIMEOUT_MS
          }
        );
        if (probe.status >= 200 && probe.status < 300) nimModel = model;
      } catch (_) {}

      if (!nimModel) {
        const ml = model.toLowerCase();
        if (ml.includes('gpt-4') || ml.includes('claude-opus') || ml.includes('405b')) {
          nimModel = 'meta/llama-3.1-405b-instruct';
        } else if (ml.includes('claude') || ml.includes('gemini') || ml.includes('70b')) {
          nimModel = 'meta/llama-3.1-70b-instruct';
        } else {
          nimModel = model; // last resort — pass through as-is
        }
      }
    }

    // ── Build NIM request ─────────────────────────────────────────────────────
    const processedMessages = injectRoleplayGreeting(messages, model);

    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 4096,
      stream: stream || false
    };

    // thinking mode is GLM-5 exclusive — sending extra_body to other models
    // causes 400/422 errors on NIM
    if (ENABLE_THINKING_MODE && GLM5_MODELS.includes(nimModel)) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // ── Call NIM ──────────────────────────────────────────────────────────────
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: { Authorization: `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
      responseType: stream ? 'stream' : 'json',
      timeout: AXIOS_TIMEOUT_MS
    });

    // ── STREAMING ─────────────────────────────────────────────────────────────
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Disables nginx proxy buffering on Render — without this SSE chunks
      // arrive batched instead of token-by-token on Janitor AI
      res.setHeader('X-Accel-Buffering', 'no');

      // Keep-alive ping — prevents Render's 30s idle timeout from closing
      // the connection while NIM is still thinking
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, SSE_KEEPALIVE_MS);

      let buffer = '';
      let reasoningStarted = false;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (!line.startsWith('data: ')) return;

          if (line.includes('[DONE]')) {
            res.write('data: [DONE]\n\n');
            return;
          }

          try {
            const data = JSON.parse(line.slice(6));

            // Guard: NIM occasionally sends chunks with no choices
            if (!data.choices || !data.choices[0] || !data.choices[0].delta) {
              res.write('data: ' + JSON.stringify(data) + '\n\n');
              return;
            }

            const reasoning = data.choices[0].delta.reasoning_content;
            const content   = data.choices[0].delta.content;

            if (SHOW_REASONING) {
              let combined = '';
              if (reasoning && !reasoningStarted) { combined = '🤔 ' + reasoning; reasoningStarted = true; }
              else if (reasoning)                 { combined = reasoning; }
              if (content && reasoningStarted)    { combined += '\n\n' + content; reasoningStarted = false; }
              else if (content)                   { combined += content; }
              if (combined) {
                data.choices[0].delta.content = combined;
                delete data.choices[0].delta.reasoning_content;
              }
            } else {
              data.choices[0].delta.content = content || '';
              delete data.choices[0].delta.reasoning_content;
            }

            res.write('data: ' + JSON.stringify(data) + '\n\n');
          } catch (_) {
            res.write(line + '\n\n');
          }
        });
      });

      response.data.on('end', () => {
        clearInterval(keepAlive);
        flushBuffer(buffer, res);
        res.end();
      });

      response.data.on('error', (err) => {
        console.error('[stream error]', err.message);
        clearInterval(keepAlive);
        if (!res.headersSent) {
          res.status(500).json({ error: { message: err.message, type: 'stream_error', code: 500 } });
        } else {
          res.end();
        }
      });

    // ── NON-STREAMING ─────────────────────────────────────────────────────────
    } else {
      // Guard: NIM can return an empty choices array on rate-limit or overload
      const choices = (response.data.choices || []).map(choice => {
        let content = (choice.message && choice.message.content) ? choice.message.content : '';
        if (SHOW_REASONING && choice.message && choice.message.reasoning_content) {
          content = '🤔 ' + choice.message.reasoning_content + '\n\n' + content;
        }
        return {
          index: choice.index || 0,
          message: { role: choice.message ? choice.message.role : 'assistant', content },
          finish_reason: choice.finish_reason || 'stop'
        };
      });

      res.json({
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices,
        usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }

  } catch (error) {
    console.error('[proxy error]', error.message);

    // If streaming already opened the connection, headers are already sent.
    // Calling res.status() a second time throws and crashes the process.
    if (res.headersSent) return res.end();

    // Forward NIM's actual status code (401, 403, 429, 500, 502, 503, 504)
    // so Janitor AI can surface the real reason instead of a generic error.
    const status = error.response ? error.response.status : 500;
    const nimMsg  = error.response && error.response.data && error.response.data.detail
      ? error.response.data.detail
      : (error.message || 'Internal server error');

    res.status(status).json({
      error: { message: nimMsg, type: 'invalid_request_error', code: status }
    });
  }
});

// ── CATCH-ALL 404 ─────────────────────────────────────────────────────────────
app.all('*', (req, res) => {
  res.status(404).json({
    error: { message: 'Endpoint ' + req.path + ' not found', type: 'invalid_request_error', code: 404 }
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OpenAI → NVIDIA NIM Proxy on port ' + PORT);
  console.log('Health: http://localhost:' + PORT + '/health');
  console.log('Reasoning: ' + (SHOW_REASONING ? 'ON' : 'OFF'));
  console.log('Thinking mode: ' + (ENABLE_THINKING_MODE ? 'ON (GLM-5 only)' : 'OFF'));
});
