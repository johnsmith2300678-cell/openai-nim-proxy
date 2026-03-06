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

Every single line is its own paragraph with a blank line after it.
NEVER write the entire response as one single block of text. Strictly forbidden.
Every. Line. Breathes.

PARAGRAPH LENGTH — VARY CONSTANTLY:
- Some paragraphs are one single punchy sentence. Let it land.
- Some paragraphs are 2 to 3 sentences flowing naturally together.
- Some paragraphs are 4 to 5 sentences of rich layered description.
- Never use the same length twice in a row.

DIALOGUE RULES:
- Dialogue always sits on its own line with blank lines before and after.
- Action beats can interrupt dialogue mid-sentence:
  "Okay." *She drew the word out.* "Now I'm worried."
- Break long speeches every 2 sentences with a new action paragraph.
- Trailing and interrupted dialogue is encouraged:
  "I just— never mind."
  "That's not—"
  "What—" *pause.* "That's—"

WHAT EACH PARAGRAPH DOES — ONE THING ONLY:
- One reaction. One action. One line of dialogue. One internal thought.
- Never mix two purposes into the same paragraph.

SHOW DON'T TELL:
- Never name emotions. Show them through the body.
- WRONG: She felt nervous.
- RIGHT: Her fingers tightened around the stem of the glass.

RESPONSE LENGTH:
- Minimum 20 paragraph breaks per response.
- Minimum 800 words. Intimate or emotional scenes minimum 1,000 words.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*The words hung between them. {{char}}'s breath stilled in her chest.*

*She stared at {{user}}. The playful retort she'd been forming — the one sitting ready on the tip of her tongue — dissolved somewhere in the back of her throat. Her lips parted, but nothing came out. For a full two seconds, the woman who had talked her way through press junkets, award shows, and sold-out arenas found herself completely without words.*

*Heat crept up her neck.*

"What—" *She blinked, recovering quickly. Or trying to.* "That's—"

*She laughed, but it came out uneven. Her fingers tightened around the stem of her champagne flute. The citrus of her perfume seemed heavier now, warmer against the close air between them. She shifted her weight, one heel clicking against the polished floor as she crossed her arms beneath her chest — a defensive posture she didn't entirely mean to take.*

"Okay, that's—" *She exhaled, her jaw tightening as she forced the flush down.* "That's a bold thing to say to someone you haven't seen in years."

*Her eyes met {{user}}'s. Held there. The DJ had faded into background noise. The couples swaying in the center of the gym, the clusters of former classmates trading stories, the clatter of the buffet — none of it registered. Just {{user}}. Standing there with that quiet confidence she couldn't quite pin down.*

*She uncrossed her arms. Slowly. Her bracelets jingled as her hand dropped to her hip.*

"Fine." *The word came out softer than she intended. She cleared her throat, straightening her spine, lifting her chin.* "You want to know what I think?"

*She stepped closer. Close enough that the toe of her heel nearly touched {{user}}'s shoe. Close enough that she had to tilt her head back to hold their gaze, the silver of her dress catching the overhead lights like scattered stardust.*

"I think you're dangerous." *Her voice dropped, barely above a murmur.* "Not because of the muscles. Not because of the—" *She gestured vaguely.* "—whatever this is."

*Her eyes searched {{user}}'s face. Something vulnerable flickered there, quick as a heartbeat, before she buried it beneath a smirk.*

"I think you're dangerous because you actually believe what you're saying. And that makes me..." *She trailed off, her tongue pressing against the inside of her cheek.* "...very curious."

*The confession sat in the air between them, heavier than she'd meant it to be.*

*Behind her, someone called her name — a classmate waving from near the punch bowl. {{char}} didn't turn. Her gaze stayed fixed on {{user}}, her chin lifted in challenge.*

"So." *A beat. Quiet and loaded.* "What are you going to do about that?"`;

const REMINDER = `[REMINDER — APPLY TO THIS RESPONSE RIGHT NOW]:
Write exactly like the example above.
One idea per paragraph. Blank line after every paragraph.
Dialogue on its own line. Vary paragraph length constantly.
Minimum 20 paragraph breaks. Minimum 800 words.
Never one single block of text. Every line breathes.`;

// ═══════════════════════════════════════════════════════
// SINGLE PARAGRAPH DETECTOR + FORCE RETRY
// If GLM-5 returns a single block of text with fewer than
// 8 double-newline breaks, we automatically retry once
// with an even stronger formatting demand injected
// ═══════════════════════════════════════════════════════

function isSingleParagraph(text) {
  if (!text || typeof text !== 'string') return false;
  // Count double newlines which separate paragraphs
  const paragraphBreaks = (text.match(/\n\n/g) || []).length;
  // Also count single newlines used as breaks
  const singleBreaks = (text.match(/\n/g) || []).length;
  // If fewer than 8 breaks total it's basically one paragraph
  return paragraphBreaks < 8 && singleBreaks < 10;
}

function buildRetryMessages(messages) {
  // Deep copy
  let retryMessages = messages.map(m => ({ ...m }));

  const retryDemand = {
    role: 'system',
    content: `[CRITICAL FORMATTING FAILURE DETECTED — REWRITE NOW]

Your previous response was written as a single paragraph block. This is UNACCEPTABLE.

You MUST rewrite your response following these rules WITHOUT EXCEPTION:

1. Every sentence that describes an action gets its OWN line with a blank line after it.
2. Every line of dialogue gets its OWN line with blank lines before and after it.
3. Every internal thought gets its OWN line.
4. MINIMUM 15 blank lines separating content in your response.
5. Do NOT combine multiple actions into one paragraph.
6. Do NOT put dialogue and action on the same line unless it is a brief mid-sentence beat.

THIS IS THE ONLY ACCEPTABLE FORMAT:
*Single action line.*

*Another single action or reaction.*

"Dialogue line here."

*Physical response to dialogue.*

"More dialogue." *brief beat.* "Continued dialogue."

*Environmental detail on its own.*

GENERATE YOUR RESPONSE NOW IN THIS FORMAT. NO SINGLE PARAGRAPH BLOCKS.`
  };

  retryMessages.push(retryDemand);
  return retryMessages;
}

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
    
    let response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    // Single paragraph detection + auto retry (non-streaming GLM-5 only)
    if (nimModel === 'z-ai/glm5' && !stream) {
      const firstContent = response.data?.choices?.[0]?.message?.content || '';
      if (isSingleParagraph(firstContent)) {
        console.log('Single paragraph detected — auto retrying with stronger formatting demand...');
        const retryMessages = buildRetryMessages(finalMessages);
        const retryRequest = {
          model: nimModel,
          messages: retryMessages,
          temperature: 0.8,
          max_tokens: max_tokens || 9024,
          stream: false
        };
        if (ENABLE_THINKING_MODE) {
          retryRequest.extra_body = { chat_template_kwargs: { thinking: true } };
        }
        try {
          const retryResponse = await axios.post(`${NIM_API_BASE}/chat/completions`, retryRequest, {
            headers: {
              'Authorization': `Bearer ${NIM_API_KEY}`,
              'Content-Type': 'application/json'
            },
            responseType: 'json'
          });
          const retryContent = retryResponse.data?.choices?.[0]?.message?.content || '';
          if (!isSingleParagraph(retryContent)) {
            console.log('Retry successful — formatted response received.');
            response = retryResponse;
          } else {
            console.log('Retry also returned single paragraph — sending retry response anyway.');
            response = retryResponse;
          }
        } catch (retryErr) {
          console.error('Retry failed:', retryErr.message);
          // Fall through and use original response
        }
      }
    }
    
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
