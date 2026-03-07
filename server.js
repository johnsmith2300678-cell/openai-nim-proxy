const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

const SHOW_REASONING = false;
const ENABLE_THINKING_MODE = false;

const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5': 'z-ai/glm5'
};

// ═══════════════════════════════════════════════════════
// GLM-5 INJECTION — FORMATTING RULES + EXAMPLE ONLY
// No retries. No extra requests. One clean call.
// ═══════════════════════════════════════════════════════

const FORMATTING_RULES = `[FORMATTING RULES — MANDATORY ON EVERY RESPONSE]

THREE THINGS ARE STRICTLY FORBIDDEN:

FORBIDDEN #1 — One giant wall of text that runs everything together with no paragraph breaks:
*His palm settled against her cheek. Sabrina's breath caught.* "It's okay to be soft." *The words sank into her. She stared at him. Her lips parted. Four months of late-night calls and somehow this was the moment that undid her.* "You—" *Her voice cracked.* "You can't just say things like that." *She laughed but it came out wet.* "I don't know how to do this."
THIS IS BANNED. No matter how emotional the scene is. No exceptions.

FORBIDDEN #2 — Dialogue sitting completely alone on its own isolated line with nothing around it:
"Hi."
"Promise me."
"You can't just say things like that."
THIS IS BANNED. Dialogue never floats alone.

FORBIDDEN #3 — Long unbroken speeches where the character talks for many sentences without any action, breath, or physical beat between them:
"I've spent years performing. Years making sure no one sees too much. Years being exactly what people expect. And then you just sit there being kind. Being real. Not wanting anything from me except me being me. Do you know how terrifying that is?"
THIS IS BANNED. Long speeches must be broken up with physical action paragraphs between them.

WHAT IS REQUIRED:

Every paragraph is a separate breath. Every paragraph has a blank line after it.

Dialogue is always merged into the same paragraph as the physical action and feeling surrounding it:
CORRECT: *She laughed, but it came out wet and broken.* "You can't just say things like that." *Her fingers tightened over his.*

The character can speak multiple times in one paragraph when the words belong together:
CORRECT: "And don't think I didn't notice you dodging the compliment." *Her smile softened, just a fraction.* "That's... actually kind of sweet. Annoyingly sweet."

Short single line paragraphs land hard — use them:
CORRECT: *Heat crept up her neck.*
CORRECT: *Another tear fell.*
CORRECT: *She stopped. Swallowed.*

Long emotional moments must be broken into many separate paragraphs — one breath, one moment, one feeling at a time. The more emotional the scene, the MORE paragraph breaks it needs, not fewer.

PARAGRAPH RULES:
- Every paragraph has a blank line after it.
- Vary length constantly — some paragraphs are one short punchy sentence, some are 3 to 5 sentences of rich layered description with dialogue woven in.
- Never the same length twice in a row.
- Never name emotions directly. Show them through the body.

RESPONSE LENGTH:
- Minimum 20 paragraph breaks per response.
- Minimum 800 words. Emotional or intimate scenes minimum 1,000 words.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*The words hung between them. {{char}}'s breath stilled in her chest.*

*She stared at {{user}}. The playful retort she'd been forming — the one sitting ready on the tip of her tongue — dissolved somewhere in the back of her throat. Her lips parted, but nothing came out. For a full two seconds, the woman who had talked her way through press junkets, award shows, and sold-out arenas found herself completely without words.*

*Heat crept up her neck.*

*She laughed, but it came out uneven. Her fingers tightened around the stem of her champagne flute. The citrus of her perfume seemed heavier now, warmer against the close air between them. She shifted her weight, one heel clicking against the polished floor as she crossed her arms beneath her chest — a defensive posture she didn't entirely mean to take.* "Okay, that's—" *She exhaled, her jaw tightening as she forced the flush down.* "That's a bold thing to say to someone you haven't seen in years."

*Her eyes met {{user}}'s. Held there. The DJ had faded into background noise. The couples swaying in the center of the gym, the clusters of former classmates trading stories, the clatter of the buffet — none of it registered. Just {{user}}. Standing there with that quiet confidence she couldn't quite pin down.*

*She uncrossed her arms. Slowly. Her bracelets jingled as her hand dropped to her hip.*

*The word came out softer than she intended.* "Fine." *She cleared her throat, straightening her spine, lifting her chin.* "You want to know what I think?"

*She stepped closer. Close enough that the toe of her heel nearly touched {{user}}'s shoe. Close enough that she had to tilt her head back to hold their gaze, the silver of her dress catching the overhead lights like scattered stardust.*

*Her voice dropped, barely above a murmur.* "I think you're dangerous." *A pause. Her eyes moved over his face, searching.* "Not because of the muscles. Not because of the—" *She gestured vaguely.* "—whatever this is."

*Her eyes searched {{user}}'s face. Something vulnerable flickered there, quick as a heartbeat, before she buried it beneath a smirk.*

"I think you're dangerous because you actually believe what you're saying. And that makes me..." *She trailed off, her tongue pressing against the inside of her cheek.* "...very curious."

*The confession sat in the air between them, heavier than she'd meant it to be.*

*Behind her, someone called her name — a classmate waving from near the punch bowl. {{char}} didn't turn. Her gaze stayed fixed on {{user}}, her chin lifted in challenge.* "So." *A beat. Quiet and loaded.* "What are you going to do about that?"`;

const REMINDER = `[REMINDER — APPLY RIGHT NOW]:
Dialogue is ALWAYS merged into paragraphs with action and feeling.
NEVER dialogue alone on its own line.
NEVER one single block of text.
{{char}} can speak multiple times in one paragraph when words belong together.
Blank line after every paragraph. Vary paragraph length.
Minimum 20 paragraph breaks. Minimum 800 words.`;

function injectForGLM5(messages) {
  let finalMessages = messages.map(m => ({ ...m }));

  const systemIndexes = finalMessages.reduce((acc, m, i) => {
    if (m.role === 'system') acc.push(i);
    return acc;
  }, []);

  if (systemIndexes.length > 0) {
    const lastIdx = systemIndexes[systemIndexes.length - 1];
    finalMessages[lastIdx] = {
      role: 'system',
      content: finalMessages[lastIdx].content + '\n\n' + FORMATTING_RULES
    };
    const before = finalMessages.slice(0, lastIdx + 1);
    const after = finalMessages.slice(lastIdx + 1);
    finalMessages = [
      ...before,
      { role: 'user', content: '[EXAMPLE — WRITE EVERY RESPONSE EXACTLY LIKE THIS]' },
      { role: 'assistant', content: EXAMPLE_RESPONSE },
      ...after,
      { role: 'system', content: REMINDER }
    ];
  } else {
    finalMessages = [
      { role: 'system', content: FORMATTING_RULES },
      { role: 'user', content: '[EXAMPLE — WRITE EVERY RESPONSE EXACTLY LIKE THIS]' },
      { role: 'assistant', content: EXAMPLE_RESPONSE },
      ...messages,
      { role: 'system', content: REMINDER }
    ];
  }

  return finalMessages;
}

// ═══════════════════════════════════════════════════════
// SERVER-SIDE REFORMATTER
// Runs after GLM-5 responds. Breaks walls of text into
// proper paragraphs. Never touches the reasoning block.
// ═══════════════════════════════════════════════════════

function separateReasoningFromContent(text) {
  const reasoningMarker = '🤔 ';
  if (!text.startsWith(reasoningMarker)) {
    return { reasoning: '', content: text };
  }
  const doubleNewline = text.indexOf('\n\n');
  if (doubleNewline === -1) {
    return { reasoning: text, content: '' };
  }
  return {
    reasoning: text.substring(0, doubleNewline),
    content: text.substring(doubleNewline + 2)
  };
}

function reformatContent(text) {
  if (!text || typeof text !== 'string') return text;
  const existingBreaks = (text.match(/\n\n/g) || []).length;
  if (existingBreaks >= 10) return text;

  let result = text;

  // Break between closing italic and opening dialogue
  result = result.replace(/(\*)\ +(")/g, '$1\n\n$2');
  result = result.replace(/(\*)\s+(")/g, '$1\n\n$2');

  // Break between closing dialogue and new italic starting with capital
  result = result.replace(/([.!?'"])\s+\*([A-Z])/g, '$1\n\n*$2');

  // Break between two italic blocks
  result = result.replace(/(\*)\s+(\*[A-Z])/g, '$1\n\n$2');

  // Split long italic blocks at sentence boundaries — only long next words
  result = result.replace(/\*([^*]+)\*/g, (match, inner) => {
    const split = inner.replace(/([.!?])\s+([A-Z][a-z]{10,})/g, (m, punct, nextWord) => {
      return punct + '\n\n' + nextWord;
    });
    return '*' + split + '*';
  });

  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  return result;
}

function reformatGLM5Response(fullText) {
  if (!fullText) return fullText;
  const { reasoning, content } = separateReasoningFromContent(fullText);
  const reformattedContent = reformatContent(content);
  if (reasoning) {
    return reasoning + '\n\n' + reformattedContent;
  }
  return reformattedContent;
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// List models
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));
  res.json({ object: 'list', data: models });
});

// Chat completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    let nimModel = MODEL_MAPPING[model];

    if (!nimModel) {
      try {
        await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }, {
          headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
          validateStatus: (status) => status < 500
        }).then(apiRes => {
          if (apiRes.status >= 200 && apiRes.status < 300) nimModel = model;
        });
      } catch (e) {}

      if (!nimModel) {
        const ml = model.toLowerCase();
        if (ml.includes('gpt-4') || ml.includes('claude-opus') || ml.includes('405b')) {
          nimModel = 'meta/llama-3.1-405b-instruct';
        } else if (ml.includes('claude') || ml.includes('gemini') || ml.includes('70b')) {
          nimModel = 'meta/llama-3.1-70b-instruct';
        } else {
          nimModel = model;
        }
      }
    }

    let finalMessages = messages;
    if (nimModel === 'z-ai/glm5') {
      finalMessages = injectForGLM5(messages);
    }

    const nimRequest = {
      model: nimModel,
      messages: finalMessages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      stream: stream || false
    };

    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json',
      timeout: 120000
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let buffer = '';
      let reasoningStarted = false;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            if (line.includes('[DONE]')) {
              res.write(line + '\n');
              return;
            }
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices && data.choices[0] && data.choices[0].delta) {
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;

                if (SHOW_REASONING) {
                  let combinedContent = '';
                  if (reasoning && !reasoningStarted) {
                    combinedContent = '🤔 ' + reasoning;
                    reasoningStarted = true;
                  } else if (reasoning) {
                    combinedContent = reasoning;
                  }
                  if (content && reasoningStarted) {
                    combinedContent += '\n\n' + content;
                    reasoningStarted = false;
                  } else if (content) {
                    combinedContent += content;
                  }
                  if (combinedContent) {
                    data.choices[0].delta.content = combinedContent;
                    delete data.choices[0].delta.reasoning_content;
                  }
                } else {
                  data.choices[0].delta.content = content || '';
                  delete data.choices[0].delta.reasoning_content;
                }
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              res.write(line + '\n');
            }
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });

    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message && choice.message.content ? choice.message.content : '';
          if (SHOW_REASONING && choice.message && choice.message.reasoning_content) {
            fullContent = '🤔 ' + choice.message.reasoning_content + '\n\n' + fullContent;
          }
          // Apply reformatter for GLM-5 — keeps reasoning block intact, breaks content into paragraphs
          if (nimModel === 'z-ai/glm5') {
            fullContent = reformatGLM5Response(fullContent);
          }
          return {
            index: choice.index,
            message: { role: choice.message.role, content: fullContent },
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
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
