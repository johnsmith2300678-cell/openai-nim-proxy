const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// ------------------------------------------------------------------
// ⚙️ RP OPTIMIZATION SETTINGS
// ------------------------------------------------------------------

const ENABLE_THINKING_MODE = false;
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.0;
const DEFAULT_MAX_TOKENS = 8192;

// ------------------------------------------------------------------
// 🩹 RP RESPONSE FORMATTER
// Fixes models (like GLM-5) that ignore paragraph break instructions
// by surgically re-inserting \n\n at every narration↔dialogue boundary.
// ------------------------------------------------------------------
function formatRPResponse(content) {
  if (!content || typeof content !== 'string') return content;

  let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── 1. Protect the header/tracker block ────────────────────────────
  // Ensure the [⏳ Time: ... | 📍 ...] line is on its own paragraph
  text = text.replace(/(\]\s*\|[^\n]+\])\s*/g, '$1\n\n');

  // ── 2. Ensure *---* divider always has blank lines around it ───────
  text = text.replace(/\s*(\*---\*)\s*/g, '\n\n$1\n\n');

  // ── 3. Italic narration end → Dialogue start ───────────────────────
  // Pattern: *...* "Dialogue   →   *...*\n\n"Dialogue
  // Handles 0–4 spaces between the closing * and opening "
  text = text.replace(/\*( {0,4})(")/g, '*\n\n$2');

  // ── 4. Dialogue end → NEW italic narration paragraph ──────────────
  // Pattern: "." *Uppercase   →   "."\n\n*Uppercase
  // Only triggers when next italic starts with a capital (new paragraph),
  // NOT for inline actions like: "text," *she whispered*
  text = text.replace(/(["'])( {0,4})\*([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ])/g, '$1\n\n*$3');

  // ── 5. Inline action end → next Dialogue or Narration ─────────────
  // Pattern: action.* "next  →  action.*\n\n"next
  text = text.replace(/(\.|\!|\?)\*( {0,4})(")/g, '$1*\n\n$3');

  // ── 6. Full italic block end → next italic block ───────────────────
  // Catches back-to-back narration paragraphs with no break:
  // *sentence one.* *sentence two.* → *sentence one.*\n\n*sentence two.*
  text = text.replace(/\*( {0,4})\*([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑ])/g, '*\n\n*$2');

  // ── 7. Clean up ────────────────────────────────────────────────────
  text = text.replace(/\n{3,}/g, '\n\n');  // collapse triple+ newlines
  text = text.replace(/^\n+/, '');          // strip leading newlines

  return text.trim();
}

// ------------------------------------------------------------------
// 📝 BASE SYSTEM PROMPT (All models)
// ------------------------------------------------------------------
const BASE_RP_SYSTEM_PROMPT = `
[SYSTEM INSTRUCTION: You are an advanced AI engaged in a collaborative roleplay. Adhere strictly to the following guidelines to ensure the highest quality experience.]

**STYLE & FORMATTING — THIS IS THE MOST IMPORTANT RULE:**
1.  **Paragraph Breaks:** You MUST use a blank line (two newline characters) between EVERY block. No exceptions. Blocks are:
    - A narration/action paragraph: *text text text.*
    - A dialogue line: "text text text."
    - A dialogue line with inline action: "text," *she action.* "more text."
    
    ✅ CORRECT EXAMPLE (copy this exact structure):

    *Narration block. Internal thoughts. Sensory details. Environment.*

    "Dialogue line," *inline action beat.*

    *Next narration block. More details.*

    "Next dialogue line." *Another inline action.*

    ❌ WRONG (do NOT do this — no blank lines):
    *Narration block.* "Dialogue." *More narration.* "More dialogue."

2.  **Never run blocks together** on the same line without a blank line separator.
3.  **Novelistic Prose:** Rich sensory details (sight, sound, touch, smell). Slow, deliberate pacing.
4.  **Length:** 600+ words minimum. Never summarize or rush.

**CONTENT GUIDELINES:**
1.  **Romance & Intimacy:** Write explicit, detailed, romantic content with physical sensations, emotions, reactions. No fading to black.
2.  **Agency:** Never speak, act, or think for {{user}}. Only control the current character(s).
3.  **Memory:** Recall details from previous messages (scents, injuries, past conversations).

**RESTRICTIONS:**
- No repetitive phrases.
- No moralizing or philosophical conclusions.
- Never break character.
`;

// ------------------------------------------------------------------
// 📝 GLM-5 SPECIFIC ADDENDUM
// GLM-5 needs extra, blunt reinforcement about paragraph spacing.
// ------------------------------------------------------------------
const GLM5_FORMAT_ADDENDUM = `

[CRITICAL FORMATTING REMINDER FOR THIS MODEL]
You have a known failure mode: you write entire responses as one giant block of text with no blank lines between narration and dialogue. This is UNACCEPTABLE.

You MUST insert a blank line (empty line) between EVERY transition:
- After every *narration paragraph* → before every "dialogue line"
- After every "dialogue line" → before every *narration paragraph*
- After every inline action beat → before the next paragraph

Re-read your output before finalizing. If you see narration and dialogue touching each other without a blank line between them, FIX IT.

Mandatory structure:
*[Narration.]*

"[Dialogue]," *[inline action.]*

*[New narration.]*

"[Next dialogue]."
`;

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7'
};

// Models that need the extra GLM-5 formatting addendum
const STRICT_FORMAT_MODELS = ['z-ai/glm5', 'z-ai/glm-4.7'];

// ------------------------------------------------------------------
// Helper: Build the system injector message for a given NIM model
// ------------------------------------------------------------------
function buildSystemInjector(nimModel) {
  const needsStrictFormat = STRICT_FORMAT_MODELS.some(m => nimModel.includes(m.split('/')[1]));
  return {
    role: 'system',
    content: BASE_RP_SYSTEM_PROMPT + (needsStrictFormat ? GLM5_FORMAT_ADDENDUM : '')
  };
}

// ------------------------------------------------------------------
// Health check
// ------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NVIDIA NIM RP Proxy',
    settings: {
      thinking_mode: ENABLE_THINKING_MODE,
      reasoning_display: SHOW_REASONING,
      temperature: DEFAULT_TEMPERATURE
    }
  });
});

// ------------------------------------------------------------------
// List models
// ------------------------------------------------------------------
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));
  res.json({ object: 'list', data: models });
});

// ------------------------------------------------------------------
// Chat completions
// ------------------------------------------------------------------
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // 1. Resolve model
    let nimModel = MODEL_MAPPING[model];
    if (!nimModel) {
      const modelLower = model.toLowerCase();
      if (modelLower.includes('glm-5') || modelLower.includes('glm5')) {
        nimModel = 'z-ai/glm5';
      } else if (modelLower.includes('glm-4') || modelLower.includes('glm4')) {
        nimModel = 'z-ai/glm-4.7';
      } else if (modelLower.includes('405b')) {
        nimModel = 'meta/llama-3.1-405b-instruct';
      } else if (modelLower.includes('70b')) {
        nimModel = 'meta/llama-3.1-70b-instruct';
      } else {
        nimModel = model;
      }
    }

    // 2. Build message list with model-aware system injector
    const systemInjector = buildSystemInjector(nimModel);
    const processedMessages = [systemInjector, ...messages];

    // 3. Build NIM payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      stream: stream || false
    };

    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // 4. Send to NVIDIA
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    // ── STREAMING ──────────────────────────────────────────────────────
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let buffer = '';
      let reasoningStarted = false;

      // We accumulate the full response so we can post-process it,
      // then replay it as SSE events so the client still gets streaming UX.
      let fullContent = '';
      let lastData = null;  // we'll use the final metadata from the last chunk

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (!line.startsWith('data: ')) return;

          if (line.includes('[DONE]')) {
            // All content accumulated — post-process and stream back word by word
            const formatted = formatRPResponse(fullContent);
            const words = formatted.split(/(\s+)/);  // split preserving whitespace tokens

            if (lastData) {
              // Stream the formatted content in small chunks
              words.forEach((word) => {
                if (!word) return;
                const outChunk = JSON.parse(JSON.stringify(lastData));
                outChunk.choices[0].delta = { content: word };
                outChunk.choices[0].finish_reason = null;
                res.write(`data: ${JSON.stringify(outChunk)}\n\n`);
              });

              // Final chunk with finish_reason
              const finalChunk = JSON.parse(JSON.stringify(lastData));
              finalChunk.choices[0].delta = { content: '' };
              finalChunk.choices[0].finish_reason = 'stop';
              res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            }

            res.write('data: [DONE]\n\n');
            return;
          }

          try {
            const data = JSON.parse(line.slice(6));
            lastData = data;

            if (data.choices && data.choices[0] && data.choices[0].delta) {
              const reasoning = data.choices[0].delta.reasoning_content;
              const content = data.choices[0].delta.content;

              if (SHOW_REASONING && reasoning) {
                // Accumulate reasoning separately (not post-processed)
                let prefix = reasoningStarted ? reasoning : '💭 ' + reasoning;
                reasoningStarted = true;
                fullContent += prefix;
              }

              if (content) {
                if (SHOW_REASONING && reasoningStarted) {
                  fullContent += '\n\n' + content;
                  reasoningStarted = false;
                } else {
                  fullContent += content;
                }
              }
            }
          } catch (e) {
            // Malformed JSON chunk — skip
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });

    // ── NON-STREAMING ─────────────────────────────────────────────────
    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let rawContent = (choice.message && choice.message.content) ? choice.message.content : '';

          if (SHOW_REASONING && choice.message && choice.message.reasoning_content) {
            rawContent = '💭 ' + choice.message.reasoning_content + '\n\n' + rawContent;
          }

          // ✅ Post-process to fix paragraph breaks
          const formatted = formatRPResponse(rawContent);

          return {
            index: choice.index,
            message: {
              role: choice.message.role,
              content: formatted
            },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      res.json(openaiResponse);
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response ? error.response.status : 500
      }
    });
  }
});

// Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, () => {
  console.log(`NVIDIA NIM RP Proxy running on port ${PORT}`);
  console.log(`Optimized for: Creativity, Detail, and Romance`);
  console.log(`RP Formatter: ACTIVE — paragraph breaks enforced`);
});
