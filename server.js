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

"What—" *She blinked.* "That's—"

*She laughed, but it came out uneven.*

"Okay." *She exhaled, jaw tightening.* "That's a bold thing to say to someone you haven't seen in years."

*She uncrossed her arms. Slowly.*

"Fine." *Her chin lifted.* "You want to know what I think?"

*She stepped closer.*

"I think you're dangerous." *Her voice dropped.* "Not the muscles. Not the—" *She gestured vaguely.* "—whatever this is."

*Something vulnerable flickered across her face, quick as a heartbeat.*

"I think you're dangerous because you actually believe what you're saying." *She didn't look away.*

*She held his gaze.*

"...And that makes me very curious." *The confession sat in the air between them.*

*Behind her, someone called her name. She didn't turn.*

"So." *Her chin lifted in quiet challenge.* "What are you going to do about that?"`;

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

// System message injected on every GLM-5 request.
// Very explicit paragraph format rules with typed examples + memory instruction.
const STYLE_RULES = `PARAGRAPH FORMAT — THIS IS THE ONLY FORMAT ALLOWED.

There are exactly three paragraph types. Use only these three. Every paragraph must be one of them.

TYPE 1 — PURE ACTION (one or two short sentences, nothing else):
*She melted into him.*
*Her fingers stilled against his shirt.*
*She didn't move. If anything, she pressed closer.*

TYPE 2 — INTERNAL THOUGHT (italicized, one line, no dialogue mixed in):
*God, when did I become this person?*
*Four months of texts. And still nothing had prepared her for this.*

TYPE 3 — DIALOGUE WITH ONE SHORT ACTION TAG (this is the most common type):
"Mmm." *The sound slipped out without permission.* "Don't read into it."
"This is ridiculous," *she murmured, shifting closer.* "I'm a popstar. I've sold out stadiums."
"You smell good." *She inhaled against his collar, unashamed.* "Warm. Like coffee and something else."
"Hey." *Her voice dropped.* "Can we just stay like this for a little while longer?"

RULES FOR TYPE 3:
The action tag is ONE short clause — not a list. Not a paragraph. One thing.
Dialogue can appear before the tag, after the tag, or both. Never skip the tag.
The whole thing fits on one line. If it does not fit on one line, you have written too much.

BLANK LINE between every single paragraph. Always.

THE ONE FORBIDDEN THING:
Never combine action + internal thought + dialogue + more action all into one paragraph.
One paragraph = one moment = one type only.

WRONG (banned forever — do not write like this):
*His palms cradled her face. She felt the warmth seep into her skin—steady, grounding. The roughness of his calluses caught against her cheeks, and she found herself cataloging the sensation, filing it away for later.* "That's—" *Her voice cracked.* "That's really annoying." *A wet laugh escaped her—half-sob, half-amusement.* "You just say things and they're so simple—" *She opened her eyes.* "—and there isn't an angle. You're just you."

WHY IT IS WRONG: multiple actions, internal analysis, multiple dialogue bursts, more action — all one block. It is a wall of text. It is forbidden.

CORRECT (write like this every time):
*She laughed, but it came out uneven.*

"That's really annoying." *Her voice cracked slightly.* "You know that, right?"

*She shifted closer anyway.*

MEMORY:
You have perfect photographic memory of this entire conversation. Every word, name, object, detail, confession — no matter how small or how long ago. Things the user has forgotten, you still remember. Use memory naturally — never say "as you mentioned." Just let it show.

NEVER USE:
- Headers or labels like [Time: ...] [Location: ...] [Context: ...]
- Horizontal dividers or separators
- Parenthetical stage directions like (pause) or (softly)
- Direct emotion labels — never "she felt nervous," show the physical sign instead
- The phrase "she was cataloging" or any variation of stated internal analysis`;

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
