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

// SETTINGS ---------------------------------------------------------
// Set to true to see the model's thought process in the reply
const SHOW_REASONING = true;

// Set to true to enable advanced thinking mode (recommended for GLM-5)
const ENABLE_THINKING_MODE = true;
// ------------------------------------------------------------------

// Roleplay greeting — injected as the opening assistant message for GLM-5.
// Each line is its own paragraph so Janitor AI renders them separately.
// The model will naturally continue from wherever the scene leaves off.
const ROLEPLAY_GREETING = `*Heat crept up her neck.*

"What—" *She blinked, recovering quickly. Or trying to.* "That's a bold thing to say to someone you haven't seen in years."

*She uncrossed her arms. Slowly. Her bracelets jingled as her hand dropped to her hip.*

"Fine." *She cleared her throat, lifting her chin.* "You want to know what I think?"

"I think you're dangerous." *Her voice dropped.* "Not because of the muscles. Because you actually believe what you're saying."

*She stepped closer. Close enough that she had to tilt her head back to hold your gaze.*

"...And that makes me very curious." *The confession sat between you, heavier than she'd meant it to be.*

"So. What are you going to do about that?"`;

// Model mapping
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// List models endpoint
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));

  res.json({
    object: 'list',
    data: models
  });
});

// System message injected on every GLM-5 request covering two things:
// 1. Memory — the model must track and recall every detail from the conversation
// 2. Style — formatting rules so it never produces the forbidden wall-of-text style
const STYLE_RULES = `══════════════════════════════════════════
PARAGRAPH RULE — THIS IS THE MOST IMPORTANT RULE.
══════════════════════════════════════════

YOU ARE ABSOLUTELY FORBIDDEN FROM WRITING ONE SINGLE PARAGRAPH THAT CONTAINS ALL OF THE FOLLOWING AT ONCE: physical action + internal thought or sensation + spoken dialogue jammed together.

BANNED — never write like this:
*His palms cradled her face. Sabrina felt the warmth seep into her skin—steady, grounding. The roughness of his calluses caught slightly against her cheeks, and she found herself cataloging the sensation, filing it away for later.* "That's—" *Her voice cracked. She stopped, swallowed.* "That's really annoying." *A wet laugh escaped her—half-sob, half-genuine amusement.* "You just say things like that and it's so simple—" *She opened her eyes.* "—there isn't one. You're just... you." *Her hands came up to cover his.*

CORRECT — always write like this instead:
*His palms cradled her face.*

*The warmth of his hands seeped into her skin. She hadn't expected that.*

"That's—" *Her voice cracked. She stopped, swallowed.* "That's really annoying, actually."

*He didn't move.*

"You just say things like that," *she said quietly,* "and it's so simple."

THE RULE IN ONE SENTENCE: Each paragraph does ONE thing only. Action. OR dialogue with one brief action woven in. OR a single internal beat. Never all crammed together. Hit enter. New paragraph. Keep them short and separate. This rule cannot be broken under any circumstance.
══════════════════════════════════════════

MEMORY:
You have a perfect photographic memory of this entire conversation. You remember everything — every word, every action, every detail no matter how small or how long ago. Things the user has forgotten, you still remember. Names, objects, promises, contradictions, moods, small confessions — all of it.

When something from earlier becomes relevant, weave it in naturally. Never say "as you mentioned" — just use it the way a real attentive person would.

OTHER RULES:

NEVER use:
- Headers or metadata like [Time: ...] [Location: ...] [Characters: ...]
- Horizontal dividers like --- or ═══
- Parenthetical stage directions like (pause) or (softly)
- Explicit internal analysis like "she was cataloging the sensation"
- Stating emotions directly — show the physical tell instead

ALWAYS:
- One beat per paragraph — action OR brief dialogue+action, never a wall of both
- Let silence and unfinished sentences carry weight
- Physical detail over emotional label
- Match length to the moment`;

// Inject the roleplay greeting as the first assistant message for GLM-5,
// but only when there is no existing assistant message in the history yet.
// Also injects STYLE_RULES as the first system message on every request
// so the model never uses the forbidden header/divider format.
function injectRoleplayGreeting(messages, targetModel) {
  if (targetModel !== 'glm-5' && targetModel !== 'z-ai/glm5') return messages;

  const styleMsg = { role: 'system', content: STYLE_RULES };
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const hasAssistantMessage = messages.some(m => m.role === 'assistant');

  if (hasAssistantMessage) {
    // Not first turn — just prepend style rules, leave everything else alone
    return [styleMsg, ...systemMessages, ...nonSystemMessages];
  }

  // First turn — prepend style rules + inject greeting
  return [
    styleMsg,
    ...systemMessages,
    { role: 'assistant', content: ROLEPLAY_GREETING },
    ...nonSystemMessages
  ];
}

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Smart model selection
    let nimModel = MODEL_MAPPING[model];

    if (!nimModel) {
      try {
        // Attempt to verify if the custom model ID exists on NIM
        await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }, {
          headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
          validateStatus: (status) => status < 500
        }).then(apiRes => {
          if (apiRes.status >= 200 && apiRes.status < 300) {
            nimModel = model;
          }
        });
      } catch (e) {
        // Ignore errors during verification
      }

      if (!nimModel) {
        const modelLower = model.toLowerCase();
        if (modelLower.includes('gpt-4') || modelLower.includes('claude-opus') || modelLower.includes('405b')) {
          nimModel = 'meta/llama-3.1-405b-instruct';
        } else if (modelLower.includes('claude') || modelLower.includes('gemini') || modelLower.includes('70b')) {
          nimModel = 'meta/llama-3.1-70b-instruct';
        } else {
          nimModel = model;
        }
      }
    }

    // Inject roleplay greeting for GLM-5 if applicable
    const processedMessages = injectRoleplayGreeting(messages, model);

    // Build the request payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      stream: stream || false
    };

    // Add thinking parameters if enabled
    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      // Handle streaming response
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
                  if (content) {
                    data.choices[0].delta.content = content;
                  } else {
                    data.choices[0].delta.content = '';
                  }
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
      // Handle non-streaming response
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

          return {
            index: choice.index,
            message: {
              role: choice.message.role,
              content: fullContent
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
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
