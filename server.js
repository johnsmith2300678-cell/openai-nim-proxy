const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// FIX #1: Increased body size limit to 10mb — Lorebook + long chat history
//         easily exceeds the default 100kb limit, causing 413 errors on Janitor AI
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// SETTINGS ---------------------------------------------------------
// Set to true to see the model's thought process in the reply
const SHOW_REASONING = true;

// Set to true to enable advanced thinking mode (GLM-5 only)
const ENABLE_THINKING_MODE = true;

// FIX #3: Axios timeout in ms — prevents silent hangs on Render free plan
// Render drops idle connections; NIM can be slow on first token
const AXIOS_TIMEOUT_MS = 120000; // 2 minutes
// ------------------------------------------------------------------

// Roleplay greeting dialogue for GLM-5 (Sabrina character)
const ROLEPLAY_GREETING = `*Four months. One hundred and twenty-three days of texts that stretched into the early hours, voice notes slipped between flights and studio sessions, a whole private world built entirely out of words and timestamps. She'd memorized the rhythm of his replies—lowercase when he was tired, a specific emoji when he was pretending her jokes weren't funny. And now she was standing outside his door in a thrifted trench coat, a black wig that was already making her scalp itch, and sunglasses she absolutely did not need on an overcast afternoon. Marcus was parked three blocks away. Close enough. Far enough. She raised her knuckles and knocked—three times, quick and deliberate—and then her heart did something she had no name for while she waited.*

*The door opened. Seeing him in person, after months of pixels and voice notes, landed somewhere between relief and vertigo.* "Hi." *It came out smaller than she'd planned. She cleared her throat, adjusted the sunglasses already slipping down her nose, and stepped inside before he could respond.* "Don't laugh at the wig. I already know."

*She moved through the entryway like she was cataloguing it—warm, lived-in, coffee and laundry detergent, a couch that had clearly been sat on by a real person. Her fingers found the edge of the wig and she pulled it off without asking permission, shaking out her real hair with a long exhale and dropping the thing on his entryway table like it had personally wronged her.* "Okay. That's better." *She turned back to face him, smoothing her hair down.* "This is really nice, by the way. Cozy. I mean that."

*She drifted further in, trailing her fingers along the back of the couch—throw pillow, remote, a stack of magazines—touching things like she needed proof they existed. There was something almost surreal about standing inside the physical space of someone she knew so well and not at all.* "I know your gym schedule," *she said, glancing back at him,* "I know you sleep on your stomach. I know you hate olives and you type in all lowercase when you're exhausted." *She paused, thumb pressing against the edge of the remote.* "But I don't know what your couch feels like. Or how it feels to just... be in the same room as you."

*The admission landed heavier than she'd meant it to. She dropped onto the couch before it could settle too long in the air, pulling her legs up beneath her and grabbing the remote like she hadn't just said something honest.* "Show me what you were watching. I'm absolutely judging you." *The screen flickered on. Penguins. She stared at it for a full second before the laugh broke out of her, genuine and unguarded.* "Penguins? You were watching a penguin documentary?" *She clutched the remote to her chest, grinning up at him.* "Okay, that's actually kind of adorable. I completely take back everything I was about to say."

*She patted the cushion beside her. When he sat, the couch shifted with his weight, and she was suddenly aware of the warmth of his arm almost against hers—different from the hug outside the restaurant, different from anything a screen could give her. She wasn't watching the penguins.* "You know what's crazy?" *Her voice had gone quieter without her meaning it to.* "I've talked to you more in the last four months than I've talked to almost anyone in years. And my friends keep asking why I'm always smiling at my phone." *A small, private laugh.* "I just tell them I'm reading nice comments. They have no idea."

*The documentary played on. She let the silence stretch, let herself sink a little deeper into the cushions, let the strange soft realness of it settle around her. After a moment her head tilted sideways and came to rest gently against his shoulder.* "Can we just stay like this for a while?" *she murmured.* "Just... existing."

*The penguins kept sliding. And for the first time in a long time, Sabrina felt like she was exactly where she was supposed to be.*`;

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

// GLM-5 NIM model identifiers — gates thinking mode and greeting injection
const GLM5_MODELS = ['glm-5', 'z-ai/glm5'];

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

// Helper: inject roleplay greeting for GLM-5 if no prior assistant message exists
function injectRoleplayGreeting(messages, requestedModel) {
  if (!GLM5_MODELS.includes(requestedModel)) return messages;

  const hasAssistantMessage = messages.some(m => m.role === 'assistant');
  if (hasAssistantMessage) return messages;

  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  return [
    ...systemMessages,
    { role: 'assistant', content: ROLEPLAY_GREETING },
    ...nonSystemMessages
  ];
}

// Helper: flush any remaining SSE buffer content before closing stream
function flushBuffer(buffer, res) {
  if (!buffer || !buffer.trim()) return;
  const lines = buffer.split('\n');
  lines.forEach(line => {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try {
        JSON.parse(line.slice(6));
        res.write(line + '\n\n');
      } catch (e) {
        // skip malformed leftover chunk
      }
    }
  });
}

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // FIX #4: Validate required fields — prevents TypeError crash when
    //         Janitor AI sends a malformed or incomplete request body
    if (!model || typeof model !== 'string') {
      return res.status(400).json({
        error: {
          message: 'Missing or invalid "model" field in request body',
          type: 'invalid_request_error',
          code: 400
        }
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Missing or invalid "messages" field in request body',
          type: 'invalid_request_error',
          code: 400
        }
      });
    }

    // Smart model selection
    let nimModel = MODEL_MAPPING[model];

    if (!nimModel) {
      try {
        const verifyRes = await axios.post(
          `${NIM_API_BASE}/chat/completions`,
          {
            model: model,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          },
          {
            headers: {
              'Authorization': `Bearer ${NIM_API_KEY}`,
              'Content-Type': 'application/json'
            },
            validateStatus: (status) => status < 500,
            timeout: AXIOS_TIMEOUT_MS
          }
        );

        if (verifyRes.status >= 200 && verifyRes.status < 300) {
          nimModel = model;
        }
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
      max_tokens: max_tokens || 4096,
      stream: stream || false
    };

    // FIX #2: Only apply thinking mode to GLM-5 — sending extra_body to other
    //         models (llama, nemotron, qwen, etc.) causes 400/422 errors on NIM
    if (ENABLE_THINKING_MODE && GLM5_MODELS.includes(nimModel)) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // Make request to NVIDIA NIM API
    // FIX #3: Added timeout so Render free plan doesn't silently hang
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json',
      timeout: AXIOS_TIMEOUT_MS
    });

    if (stream) {
      // Handle streaming response
      // X-Accel-Buffering: no — disables nginx proxy buffering on Render
      // Without this, SSE chunks get batched instead of streaming live to Janitor AI
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let buffer = '';
      let reasoningStarted = false;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach(line => {
          if (!line.startsWith('data: ')) return;

          // FIX #5: SSE spec requires \n\n after every event frame
          //         Using only \n on [DONE] causes Janitor AI stream parsers to hang
          if (line.includes('[DONE]')) {
            res.write('data: [DONE]\n\n');
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
            res.write('data: ' + JSON.stringify(data) + '\n\n');
          } catch (e) {
            res.write(line + '\n\n');
          }
        });
      });

      response.data.on('end', () => {
        // Flush any remaining buffered content before closing
        flushBuffer(buffer, res);
        res.end();
      });

      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        // FIX #6: Stream may already be open — check before trying to set headers
        if (!res.headersSent) {
          res.status(500).json({ error: { message: err.message, type: 'stream_error', code: 500 } });
        } else {
          res.end();
        }
      });

    } else {
      // Handle non-streaming response
      const openaiResponse = {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let fullContent = (choice.message && choice.message.content) ? choice.message.content : '';

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

    // FIX #6: If streaming already started, headers are already sent
    //         Calling res.status() again crashes the Node process
    if (res.headersSent) {
      return res.end();
    }

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
      message: 'Endpoint ' + req.path + ' not found',
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, () => {
  console.log('OpenAI to NVIDIA NIM Proxy running on port ' + PORT);
  console.log('Health check: http://localhost:' + PORT + '/health');
  console.log('Reasoning display: ' + (SHOW_REASONING ? 'ENABLED' : 'DISABLED'));
  console.log('Thinking mode: ' + (ENABLE_THINKING_MODE ? 'ENABLED (GLM-5 only)' : 'DISABLED'));
});
