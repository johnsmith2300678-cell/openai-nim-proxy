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
const ROLEPLAY_GREETING = `*The words hung between them. Sabrina's breath stilled in her chest.*

*She stared at you. The playful retort she'd been forming—the one sitting ready on the tip of her tongue—dissolved somewhere in the back of her throat. Her lips parted, but nothing came out. For a full two seconds, the woman who had talked her way through press junkets, award shows, and sold-out arenas found herself completely without words.*

*Heat crept up her neck.*

"What—" *She blinked, recovering quickly. Or trying to.* "That's—"

*She laughed, but it came out uneven. Her fingers tightened around the stem of her champagne flute. The citrus of her perfume seemed heavier now, warmer against the close air between you. She shifted her weight, one heel clicking against the polished floor as she crossed her arms beneath her chest—a defensive posture she didn't entirely mean to take.*

"Okay, that's—" *She exhaled, her jaw tightening as she forced the flush down.* "That's a bold thing to say to someone you haven't seen in years."

*Her eyes met yours. Held there. The DJ had faded into background noise. The couples swaying in the center of the gym, the clusters of former classmates trading stories, the clatter of the buffet—none of it registered. Just you. Standing there with that quiet confidence she couldn't quite pin down.*

*She uncrossed her arms. Slowly. Her bracelets jingled as her hand dropped to her hip.*

"Fine." *The word came out softer than she intended. She cleared her throat, straightening her spine, lifting her chin.* "You want to know what I think?"

*She stepped closer. Close enough that the toe of her heel nearly touched your shoe. Close enough that she had to tilt her head back to hold your gaze, the silver of her dress catching the overhead lights like scattered stardust.*

"I think you're dangerous." *Her voice dropped, barely above a murmur.* "Not because of the muscles. Not because of the—" *She gestured vaguely at all of you.* "—whatever this is." *Her eyes searched your face. Something vulnerable flickered there, quick as a heartbeat, before she buried it beneath a smirk.*

"I think you're dangerous because you actually believe what you're saying. And that makes me..." *She trailed off, her tongue pressing against the inside of her cheek.*

"...very curious." *The confession sat in the air between you, heavier than she'd meant it to be.*

*Behind her, someone called her name—a classmate waving from near the punch bowl. Sabrina didn't turn. Her gaze stayed fixed on you, her chin lifted in challenge.*

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
const STYLE_RULES = `MEMORY — this is the most important instruction:
You have a perfect, photographic memory of this entire conversation. You remember everything — every word spoken, every action taken, every detail mentioned, no matter how small or how long ago it appeared. Things the user has forgotten, you still remember. Things said only once in passing, you remember. Names, objects, locations, promises, contradictions, moods, small confessions — all of it is permanently stored and available to you.

When something from earlier in the conversation becomes relevant — even if the user didn't bring it up — you naturally weave it in. You notice continuity. You catch callbacks. You remember the tiny detail they mentioned three exchanges ago and you use it now because a person who was truly present would remember it.

Never say "as you mentioned" or "earlier you said" — just use the memory naturally, the way a real person would. Show that you were listening. Show that it mattered.

STRICT WRITING RULES — follow these on every single response without exception:

NEVER use any of the following:
- Time/date/location/weather/context headers like [⏳ Time: ...] [📅 Date: ...] [📍 Location: ...] [👥 Characters: ...] [📜 Context: ...]
- Horizontal dividers like --- or ═══ or ───
- Bracketed metadata of any kind
- Numbered lists or bullet points inside the roleplay
- Parenthetical stage directions like (pause) or (softly)
- Sentences that explicitly state a character's internal analysis like "She was cataloging the sensation" or "filing it away for later"
- Over-explained emotion — never tell the reader what a feeling means, only show what the body does
- One giant paragraph that mixes action, dialogue, and internal thought all together

ALWAYS write like this instead:
- Each paragraph is one beat only — a short action line, OR dialogue with a brief action woven in, never both crammed together
- Short punchy lines for impact, longer flowing lines for tension
- Characters speak at least twice per scene — dialogue is never isolated from action
- Physical detail over emotional label — not "she felt nervous" but "her thumb found the edge of his sleeve"
- Let silence and unfinished sentences do the work
- Match the length to the moment — a quiet beat gets two lines, a turning point gets a full paragraph`;

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
