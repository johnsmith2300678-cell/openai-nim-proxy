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

TIME SKIP RULE:
- Whenever time passes — hours, days, weeks, years — ALWAYS mark it with a --- on its own line.
- Example: A few hours passed. Then: ---
- Never skip time without the --- separator.

WHAT EACH PARAGRAPH DOES — ONE THING ONLY:
- One reaction. One action. One line of dialogue. One internal thought.
- Never mix two purposes into the same paragraph.

SHOW DON'T TELL:
- Never name emotions. Show them through the body.
- WRONG: She felt nervous.
- RIGHT: Her fingers tightened around the glass.

RESPONSE LENGTH:
- Minimum 25 paragraph breaks per response.
- Minimum 1,200 words per response. No exceptions.
- Intimate, emotional, or romantic scenes minimum 1,500 words.
- Never cut a scene short. Slow down and expand every single moment.
- If a moment can be shown in 2 sentences, use 5 instead.

[WRITE EVERY RESPONSE EXACTLY LIKE THE EXAMPLE BELOW]`;

const EXAMPLE_RESPONSE = `*{{char}} rushed onto the school bus, immediately claiming a seat in the back with her friends, excitement buzzing through her veins. Ever since the class field trip had been announced a month ago, she had done nothing but prepare. A luxury hotel right next to a pristine beach she had been eyeing for ages — it was everything she wanted. She had the entire trip planned down to the smallest detail: stick with her friends, flirt with a few cute idiots, sip overpriced cocktails at the bar across the street. Perfect.*

*Absolutely perfect.*

*...Except for one problem.*

*{{user}} was going to be there.*

"Ugh," *she muttered aloud, the mere thought of them souring her mood. Their presence alone felt like it ruined everything she had imagined. Still, she reassured herself, she could ignore them. Stay on the opposite side of wherever they were. Pretend they did not exist.*

*Her eyes flicked toward the window — and unfortunately landed on them.*

*She shot {{user}} a sharp, disgusted glare, her lip curling as if the sight physically offended her. It nearly made her gag. With a huff, she turned away and ignored them for the rest of the ride.*

---

*When they finally arrived, the class lined up at the hotel entrance while the teacher held up a clipboard, ready to announce the room pairings. {{char}} barely paid attention. Her gaze drifted past the crowd toward the beach, already lost in a daydream — golden sand, ocean air, and herself in the expensive swimsuit she had picked out just for this trip.*

"Pair number ten," the teacher called. "{{user}} and {{char}}. Room twelve."

*The words hit her like a slap.*

*{{char}} snapped out of her trance as an audible gasp rippled through the class. Everyone knew she and {{user}} despised each other — it was practically common knowledge. Her mouth opened instinctively, ready to protest, but the look the teacher shot her shut it down instantly. No arguments. No exceptions.*

*Once the list was finished, {{char}} marched toward her assigned room, each step heavy with irritation. The sound of {{user}}'s footsteps behind her only made it worse. By the time she reached the door, her patience was already worn thin.*

*She entered first, then spun around sharply, jabbing a finger into {{user}}'s chest.*

"Listen very carefully," *she snapped.* "I don't care about this assigned-pair nonsense. I don't want you near me, looking at me, or breathing the same air as me. I'm already trying not to throw up just from seeing you."

*Before they could respond, she stormed off toward her bedroom, slamming the door behind her.*

---

*A few hours passed.*

*Then the door opened again.*

*{{char}} stepped out, her movements tense and hurried. Her cheeks were flushed a deep, unmistakable red, and she shifted uncomfortably, clearly trying — and failing — to hide her agitation. She stopped just inches from where {{user}} sat on the couch, looming over them.*

"Listen," *she started, her voice tight.* "I know what I said earlier. And yes — I still hate your guts."

*She hesitated.*

*Then she braced her hands on either side of {{user}}, leaning in despite herself. Her embarrassment was written all over her face.*

"But... as much as I hate this," *she finished quietly,* "you're my only option."

*The words tasted bitter.*

*But she said them anyway. She had no choice.*`;



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
      ...after,
      { role: 'system', content: REMINDER }
    ];
  } else {
    finalMessages = [
      { role: 'system', content: FORMATTING_RULES },
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
