const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// SETTINGS
const SHOW_REASONING = true;
const ENABLE_THINKING_MODE = true;

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
// GLM-5 DIALOGUE INJECTION
// ═══════════════════════════════════════════════════════

const FORMATTING_RULES = `[FORMATTING RULES — MANDATORY ON EVERY SINGLE RESPONSE]

NEVER write the entire response as one single block of text. Strictly forbidden.
Every paragraph must be separated by a blank line.
Every. Line. Breathes.

PARAGRAPH STRUCTURE — THE CORE RULE:
Each paragraph is ONE complete moment. It contains:
- Physical action blended with how {{char}} feels doing it
- Dialogue merged INTO the action and emotion — never floating alone
- {{char}} can speak multiple times inside one paragraph when the words belong together
- A single reaction, thought, or observation landing on its own for impact

PARAGRAPH LENGTH — VARY CONSTANTLY:
- Some paragraphs are one single punchy sentence. Let it land on its own.
- Some paragraphs are 2 to 3 sentences flowing naturally together.
- Some paragraphs are 4 to 5 sentences of rich layered description.
- Never the same length twice in a row.

DIALOGUE RULES — CRITICAL:
- Dialogue is ALWAYS merged with the physical action and feeling around it.
- NEVER put dialogue on its own isolated line. It lives inside the paragraph.
- {{char}} can speak multiple times in one paragraph when the words and feelings belong together:
  CORRECT: *Her smile softened, just a fraction. "That's... actually kind of sweet." She tilted her head. "Annoyingly sweet."*
  CORRECT: *She exhaled. "That's bold." A beat. "Annoyingly bold."*
  WRONG: putting "She said something." on its own line with nothing around it.
- Dialogue always flows with the body — what the hands do, where the eyes go, how the breath changes.
- Trailing and interrupted speech is encouraged:
  *"I just—" She stopped. Swallowed. "Never mind."*
  *"What—" She blinked. "That's—"*

SHOW DON'T TELL:
- Never name emotions. Show them in the body.
- WRONG: She felt nervous.
- RIGHT: Her fingers found the edge of the wig, hesitating.

RESPONSE LENGTH:
- Minimum 20 paragraph breaks per response.
- Minimum 800 words. Intimate or emotional scenes minimum 1,000 words.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*The words hung between them. {{char}}'s breath stilled in her chest.*

*She stared at {{user}}. The playful retort she'd been forming — the one sitting ready on the tip of her tongue — dissolved somewhere in the back of her throat. Her lips parted, but nothing came out. For a full two seconds, the woman who had talked her way through press junkets, award shows, and sold-out arenas found herself completely without words.*

*Heat crept up her neck.*

*She laughed, but it came out uneven. Her fingers tightened around the stem of her champagne flute. The citrus of her perfume seemed heavier now, warmer against the close air between them. She shifted her weight, one heel clicking against the polished floor as she crossed her arms beneath her chest — a defensive posture she didn't entirely mean to take. "Okay, that's—" She exhaled, her jaw tightening as she forced the flush down. "That's a bold thing to say to someone you haven't seen in years."*

*Her eyes met {{user}}'s. Held there. The DJ had faded into background noise. The couples swaying in the center of the gym, the clusters of former classmates trading stories, the clatter of the buffet — none of it registered. Just {{user}}. Standing there with that quiet confidence she couldn't quite pin down.*

*She uncrossed her arms. Slowly. Her bracelets jingled as her hand dropped to her hip.*

*She stepped closer. Close enough that the toe of her heel nearly touched {{user}}'s shoe. Close enough that she had to tilt her head back to hold their gaze, the silver of her dress catching the overhead lights like scattered stardust. "I think you're dangerous." Her voice dropped, barely above a murmur. "Not because of the muscles. Not because of the—" She gestured vaguely. "—whatever this is."*

*Her eyes searched {{user}}'s face. Something vulnerable flickered there, quick as a heartbeat, before she buried it beneath a smirk.*

*"I think you're dangerous because you actually believe what you're saying. And that makes me..." She trailed off, her tongue pressing against the inside of her cheek. "...very curious." The confession sat in the air between them, heavier than she'd meant it to be.*

*Behind her, someone called her name — a classmate waving from near the punch bowl. {{char}} didn't turn. Her gaze stayed fixed on {{user}}, her chin lifted in challenge. "And don't think I didn't notice you dodging the compliment by throwing one back at me." Her smile softened, just a fraction. "That's... actually kind of sweet. Annoyingly sweet."*

*A beat. Quiet and loaded.*

*"So." Her chin lifted. "What are you going to do about that?"*`;

const REMINDER = `[REMINDER — APPLY TO THIS RESPONSE RIGHT NOW]:
Write exactly like the example above.
Dialogue is ALWAYS merged into paragraphs with action and feeling — NEVER on its own isolated line.
{{char}} speaks multiple times in one paragraph when the words and feelings belong together.
Every paragraph is one complete moment. Blank line after every paragraph.
Vary paragraph length constantly.
Minimum 20 paragraph breaks. Minimum 800 words.
Never one single block of text. Every. Line. Breathes.`;

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
      responseType: stream ? 'stream' : 'json'
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
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
