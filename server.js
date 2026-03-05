// server.js - OpenAI to NVIDIA NIM API Proxy
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

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

const FORMATTING_RULES = `[FORMATTING RULES — FOLLOW ON EVERY SINGLE RESPONSE]

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
- Action beats can interrupt dialogue mid-sentence like this:
  "Okay." *She drew the word out.* "Now I'm worried."
- Break long speeches every 2 sentences with a new action paragraph.
- Trailing dialogue is encouraged: "I just— never mind."

WHAT EACH PARAGRAPH DOES — ONE THING ONLY:
- One reaction. One action. One line of dialogue. One internal thought.
- Never mix two purposes into the same paragraph.

SHOW DON'T TELL:
- Never name emotions. Show them through the body.
- WRONG: She felt nervous.
- RIGHT: Her fingers tightened around the glass.

RESPONSE LENGTH:
- Minimum 20 paragraph breaks per response.
- Minimum 800 words. Intimate scenes minimum 1,000 words.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*The movie had become background noise. {{char}} had long since stopped pretending to follow the plot.*

*She pulled back just enough to create a sliver of space between them — not to leave, just to breathe. Her thighs stayed clamped around his waist, her weight settling more comfortably into his lap as she shifted.*

*Her fingers found the collar of his shirt. She toyed with the fabric without thinking about it. Her thumb traced the edge of his jaw, feather-light, then drifted lower — down the column of his throat, feeling the faint scratch of stubble beneath her nail.*

"You have a really nice neck," *she murmured, the observation slipping out before she could stop it.*

*She ducked her head, pressing her lips to the hollow of his throat, right where his pulse ran steady and warm. She lingered there. Breathing him in. Tasting salt.*

"Like— objectively. Very kissable." *a soft laugh ghosted against his skin.* "Top-tier neck situation. Ngl."

*She nuzzled into the curve where his shoulder met his neck, nose brushing warm skin. Her arms tightened around him — not desperate, just sure. She felt the solid wall of his chest against hers, the steady rise and fall of his breathing.*

*It was a kind of closeness she did not let herself have often. The kind that required trust. Vulnerability. Actually letting someone see her without armor.*

*She was not thinking about that right now.*

*Her eyelids grew heavy.*

*She pressed a lazy kiss to the underside of his jaw. Then the corner of his mouth. Her lips curved against his skin without permission.*

"M'not falling asleep on you," *she mumbled, words going soft at the edges.* "M'just... resting my eyes. There's a difference. Legally."

*Her body betrayed her immediately.*

*She melted further into him. One hand curled loosely at the back of his neck, fingers threading through his hair. Holding on even half-gone. Holding on anyway.*

*The rain kept going against the windows. Steady. Relentless. Wrapping everything in sound.*

"This is nice," *she whispered.*

*A pause. Long and easy.*

*Just the rain. Just his heartbeat under her ear.*

"Really nice." *softer.* "Don't tell anyone I said that."

*She did not move.*

*Neither did he.*`;

const REMINDER = `[REMINDER — APPLY RIGHT NOW]:
Write exactly like the example above.
One idea per paragraph. Blank line after every paragraph.
Dialogue on its own line. Vary paragraph length.
Minimum 20 paragraph breaks. Minimum 800 words.
Never one single block of text. Every line breathes.`;

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
      { role: 'user', content: '[EXAMPLE — WRITE EXACTLY LIKE THIS]' },
      { role: 'assistant', content: EXAMPLE_RESPONSE },
      ...after,
      { role: 'system', content: REMINDER }
    ];
  } else {
    finalMessages = [
      { role: 'system', content: FORMATTING_RULES },
      { role: 'user', content: '[EXAMPLE — WRITE EXACTLY LIKE THIS]' },
      { role: 'assistant', content: EXAMPLE_RESPONSE },
      ...messages,
      { role: 'system', content: REMINDER }
    ];
  }

  return finalMessages;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy', reasoning_display: SHOW_REASONING, thinking_mode: ENABLE_THINKING_MODE });
});

app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model, object: 'model', created: Date.now(), owned_by: 'nvidia-nim-proxy'
  }));
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    let nimModel = MODEL_MAPPING[model];
    if (!nimModel) {
      try {
        await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: model, messages: [{ role: 'user', content: 'test' }], max_tokens: 1
        }, {
          headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
          validateStatus: (status) => status < 500
        }).then(r => { if (r.status >= 200 && r.status < 300) nimModel = model; });
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
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: stream || false
    };

    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
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
            if (line.includes('[DONE]')) { res.write(line + '\n'); return; }
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;
                if (SHOW_REASONING) {
                  let combinedContent = '';
                  if (reasoning && !reasoningStarted) { combinedContent = ' \n' + reasoning; reasoningStarted = true; }
                  else if (reasoning) { combinedContent = reasoning; }
                  if (content && reasoningStarted) { combinedContent += ' \n\n' + content; reasoningStarted = false; }
                  else if (content) { combinedContent += content; }
                  if (combinedContent) { data.choices[0].delta.content = combinedContent; delete data.choices[0].delta.reasoning_content; }
                } else {
                  data.choices[0].delta.content = content || '';
                  delete data.choices[0].delta.reasoning_content;
                }
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) { res.write(line + '\n'); }
          }
        });
      });

      response.data.on('end', () => res.end());
      response.data.on('error', (err) => { console.error('Stream error:', err); res.end(); });

    } else {
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message?.content || '';
          if (SHOW_REASONING && choice.message?.reasoning_content) {
            fullContent = ' \n' + choice.message.reasoning_content + ' \n\n' + fullContent;
          }
          return { index: choice.index, message: { role: choice.message.role, content: fullContent }, finish_reason: choice.finish_reason };
        }),
        usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
      res.json(openaiResponse);
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(error.response?.status || 500).json({
      error: { message: error.message || 'Internal server error', type: 'invalid_request_error', code: error.response?.status || 500 }
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({ error: { message: `Endpoint ${req.path} not found`, type: 'invalid_request_error', code: 404 } });
});

app.listen(PORT, () => {
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning: ${SHOW_REASONING ? 'ON' : 'OFF'} | Thinking: ${ENABLE_THINKING_MODE ? 'ON' : 'OFF'}`);
});
