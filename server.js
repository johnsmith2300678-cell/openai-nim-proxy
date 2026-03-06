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
const SHOW_REASONING = true; 
const ENABLE_THINKING_MODE = true;
// ------------------------------------------------------------------

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

// ═══════════════════════════════════════════════════════
// GLM-5 FORMATTING INJECTION
// ═══════════════════════════════════════════════════════

const FORMATTING_RULES = `[FORMATTING RULES — MANDATORY ON EVERY SINGLE RESPONSE]

NEVER write the entire response as one single block of text. Strictly forbidden.
Every paragraph must be separated by a blank line.
Every. Line. Breathes.

PARAGRAPH STRUCTURE — THE CORE RULE:
Each paragraph is ONE complete moment. It can contain:
- A physical action blended with how {{char}} feels doing it
- A line of dialogue merged with the action or emotion surrounding it
- {{char}} speaking multiple times in one paragraph if the words and feelings belong together
- A reaction, a thought, an observation — but always ONE complete beat

PARAGRAPH LENGTH — VARY CONSTANTLY:
- Some paragraphs are one single punchy sentence. Let it land.
- Some paragraphs are 2 to 3 sentences that belong together naturally.
- Some paragraphs are 4 to 5 sentences of rich layered description.
- Never use the same length twice in a row.

DIALOGUE RULES — CRITICAL:
- Dialogue is MERGED into the paragraph with the action and feeling around it.
- Do NOT put dialogue on its own isolated line unless it is a single word or gasp.
- {{char}} can speak multiple times in one paragraph:
  Her smile softened, just a fraction. "That's... actually kind of sweet." She tilted her head. "Annoyingly sweet."
- Dialogue flows WITH the physical moment, not separate from it.
- Action beats wrap around and through dialogue naturally:
  She exhaled, her jaw tightening as she forced the flush down. "That's a bold thing to say to someone you haven't seen in years."
- Trailing and interrupted speech is encouraged:
  "I just—" She stopped. Swallowed. "Never mind."

SHOW DON'T TELL:
- Never name emotions. Show them through the body.
- WRONG: She felt nervous.
- RIGHT: Her fingers found the edge of the wig, hesitating.

RESPONSE LENGTH:
- Minimum 20 paragraph breaks per response.
- Minimum 800 words. Intimate or emotional scenes minimum 1,000 words.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*Four months of texts and voice notes and 2 AM confessions — and now {{char}} was standing in his doorway, a black wig itching against her scalp and sunglasses halfway down her nose.*

*She cleared her throat. The word came out smaller than she meant it to. "Hi." She adjusted the glasses, which immediately started sliding again.*

*"Don't laugh at the wig," she added, already stepping past him into the apartment without waiting for an invitation. "I know it's bad."*

*Her eyes moved across the space — warm, lived-in, the kind of place that smelled like coffee and clean laundry. A couch that had actually been sat on. A TV paused on something she didn't recognize. Her fingers found the edge of the wig. "Can I—? This thing is suffocating me."*

*She tugged it off without waiting for an answer, shaking out her real hair with a long, dramatic exhale. She tossed the wig onto his entryway table like it had personally offended her.*

*"Okay." She smoothed her hair down, then looked at him. Really looked. "That's better."*

*The months of texting had built something between them — a whole architecture of inside jokes and confessions — but seeing him in person was different. He was solid. Real. She clasped her hands together, rocked back on her heels. "This is weird, right? In a good way. But weird."*

*She moved further into the apartment, her fingers trailing along the back of the couch as she walked, touching things like she needed to confirm they existed. A throw pillow. A remote. A stack of magazines. She turned back to face him, gesturing vaguely. "I know your gym schedule. I know you sleep on your stomach. I know you hate olives."*

*Her lips curved. Then she stopped. Swallowed. "But I don't know what your couch feels like. Or what you watch on TV. Or—" A pause. "—how it feels to just... be in the same room as you."*

*She dropped onto the couch before he could respond, pulling her legs up beneath her and settling into the cushions. She grabbed the remote off the coffee table. "Show me what you were watching. I'm judging you."*

*The screen flickered to life. Penguins. She stared at it for a full second before bursting into laughter, clutching the remote to her chest. "Penguins? You were watching penguins?" She looked up at him, still grinning. "Okay, that's actually kind of adorable. I take back everything I was going to judge."*

*She patted the spot beside her. "Sit. I'm not watching penguins alone."*

*When he settled next to her the couch dipped with his weight. She was hyperaware of it — the warmth of his arm, the way his shoulder almost brushed hers. The documentary played but she wasn't watching. Her head turned toward him, studying his profile in the soft light from the TV.*

*"You know what's crazy?" Her voice had dropped, quieter now. She pulled her knees tighter to her chest, resting her chin on top. "I've talked to you more in the past four months than I've talked to anyone in years. And I hadn't even seen you in person."*

*She laughed softly — a small, private sound. "My friends keep asking why I'm smiling at my phone. I just tell them I'm reading nice comments." A beat. "They have no idea."*

*The documentary shifted to penguins sliding across ice. She made a soft sound, half-laugh, half-sigh, and glanced at him with something open in her expression. "This is nice. This is really nice." She hesitated, then: "Thanks for letting me come over. I know it's a lot. The whole—" She gestured at herself. "—thing."*

*The silence stretched between them. Comfortable. Easy. She let herself sink deeper into the cushions, her voice dropping to barely a murmur. "Can we stay like this for a while? Just... existing?"*

*She didn't wait for an answer. She just let her head tilt sideways, coming to rest gently against his shoulder.*

*The penguins kept sliding.*`;

const REMINDER = `[REMINDER — APPLY TO THIS RESPONSE RIGHT NOW]:
Write exactly like the example above.
Dialogue is MERGED into paragraphs with action and feeling — not isolated on its own line.
{{char}} can speak multiple times in one paragraph if the words belong together.
One complete moment per paragraph. Blank line after every paragraph.
Vary paragraph length constantly.
Minimum 20 paragraph breaks. Minimum 800 words.
Never one single block of text. Every line breathes.`;

// ═══════════════════════════════════════════════════════
// SINGLE PARAGRAPH DETECTOR + FORCE RETRY
// ═══════════════════════════════════════════════════════

function isSingleParagraph(text) {
  if (!text || typeof text !== 'string') return false;
  const paragraphBreaks = (text.match(/\n\n/g) || []).length;
  const singleBreaks = (text.match(/\n/g) || []).length;
  return paragraphBreaks < 8 && singleBreaks < 10;
}

function buildRetryMessages(messages) {
  let retryMessages = messages.map(m => ({ ...m }));
  retryMessages.push({
    role: 'system',
    content: `[CRITICAL FORMATTING FAILURE — REWRITE NOW]
Your previous response was a single paragraph block. Unacceptable.
REWRITE it now with MINIMUM 15 blank lines separating paragraphs.
Each moment, action, and piece of dialogue belongs in its own paragraph.
Dialogue must be merged with physical action — never floating alone.
NO SINGLE PARAGRAPH BLOCKS.`
  });
  return retryMessages;
}

// ═══════════════════════════════════════════════════════
// INJECTION FUNCTION
// ═══════════════════════════════════════════════════════

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
// HELPER — make a NIM request with timeout + retry
// ═══════════════════════════════════════════════════════

async function nimPost(messages, nimModel, temperature, maxTokens, streamMode) {
  const payload = {
    model: nimModel,
    messages,
    temperature: temperature || 0.6,
    max_tokens: maxTokens || 4096,
    stream: streamMode || false
  };
  if (ENABLE_THINKING_MODE) {
    payload.extra_body = { chat_template_kwargs: { thinking: true } };
  }

  return axios.post(`${NIM_API_BASE}/chat/completions`, payload, {
    headers: {
      'Authorization': `Bearer ${NIM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    responseType: streamMode ? 'stream' : 'json',
    // 110 second axios timeout — just under Render's 120s hard limit
    timeout: 110000
  });
}

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
  res.json({ object: 'list', data: models });
});

// Chat completions endpoint
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
          validateStatus: (status) => status < 500,
          timeout: 10000
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

    // Always stream for GLM-5 — keeps connection alive, prevents 504
    const useStream = nimModel === 'z-ai/glm5' ? true : (stream || false);

    // Keep-alive ping every 15s to prevent Render 504 on slow responses
    let keepAliveInterval = null;
    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Send a comment ping every 15s so Render doesn't kill the connection
      keepAliveInterval = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, 15000);
    }

    let response;
    try {
      response = await nimPost(finalMessages, nimModel, temperature, max_tokens, useStream);
    } catch (nimErr) {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      // If it times out, return a clean error instead of crashing
      if (nimErr.code === 'ECONNABORTED' || nimErr.message.includes('timeout')) {
        console.error('NIM timeout:', nimErr.message);
        if (!res.writableEnded) {
          res.status(504).json({
            error: {
              message: 'The AI model took too long to respond. Please try again.',
              type: 'timeout_error',
              code: 504
            }
          });
        }
        return;
      }
      throw nimErr;
    }

    if (useStream) {
      let buffer = '';
      let reasoningStarted = false;
      let fullContent = '';

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
                
                if (content) fullContent += content;

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
              if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              if (!res.writableEnded) res.write(line + '\n');
            }
          }
        });
      });

      response.data.on('end', async () => {
        if (keepAliveInterval) clearInterval(keepAliveInterval);

        // Single paragraph check after stream ends — if bad, send a correction token
        if (nimModel === 'z-ai/glm5' && isSingleParagraph(fullContent)) {
          console.log('Single paragraph detected in stream — sending format correction note.');
          const correctionChunk = {
            id: `chatcmpl-fix-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              delta: { content: '\n\n*[Please regenerate — response was not properly formatted into paragraphs.]*' },
              finish_reason: null
            }]
          };
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(correctionChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
          }
        }

        if (!res.writableEnded) res.end();
      });

      response.data.on('error', (err) => {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        console.error('Stream error:', err);
        if (!res.writableEnded) res.end();
      });

    } else {
      // Non-streaming response
      let fullContent = response.data?.choices?.[0]?.message?.content || '';

      // Single paragraph auto-retry for non-streaming
      if (nimModel === 'z-ai/glm5' && isSingleParagraph(fullContent)) {
        console.log('Single paragraph detected — retrying...');
        try {
          const retryResponse = await nimPost(
            buildRetryMessages(finalMessages),
            nimModel,
            0.8,
            max_tokens || 4096,
            false
          );
          const retryContent = retryResponse.data?.choices?.[0]?.message?.content || '';
          if (retryContent) response = retryResponse;
        } catch (retryErr) {
          console.error('Retry failed:', retryErr.message);
        }
      }

      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let content = choice.message?.content || '';
          if (SHOW_REASONING && choice.message?.reasoning_content) {
            content = '🤔 ' + choice.message.reasoning_content + '\n\n' + content;
          }
          return {
            index: choice.index,
            message: { role: choice.message.role, content },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    const status = error.response?.status || 500;
    if (!res.writableEnded) {
      res.status(status).json({
        error: {
          message: error.message || 'Internal server error',
          type: 'invalid_request_error',
          code: status
        }
      });
    }
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
