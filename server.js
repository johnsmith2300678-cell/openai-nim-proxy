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

const EXAMPLE_RESPONSE = `*The question hung in the air between them, and {{char}} felt her stomach drop.*

*Her mouth opened. Closed. Opened again.*

"That's—" *She stopped, her voice cracking embarrassingly. She swallowed hard and tried again.* "That's a stupid question."

*But was it?*

*Her ears twitched, flattening further against her skull as her mind raced. Did she want this? With {{user}}? The person she'd spent years competing against, glaring at, pretending didn't exist even when their very presence made her skin itch with irritation?*

*Her body certainly wanted it. The ache between her thighs had graduated from uncomfortable to borderline painful, a throbbing emptiness that made her want to press her legs together and grind against something — anything — for relief. Her nipples were hard against the thin fabric of her top, visibly peaked, and she knew without looking that her face must be a mess of flush and sweat.*

*But her mind—*

"I don't—" *She exhaled sharply through her nose, her tail lashing behind her in agitation.* "I don't *want* to want this. Not with you."

*Her hands were still braced on either side of {{user}}, her body hovering over theirs on the couch. She was close enough to feel the warmth radiating from them, to catch whatever scent clung to their skin beneath the generic hotel soap. Close enough that if she just... leaned forward...*

*{{char}}'s thighs trembled.*

"God, I can't think straight," *she muttered, more to herself than to them. Her amber eyes were hazy, unfocused, the sharp predator's glint dulled by the haze of her heat.* "My head is — it's all fuzzy. Everything feels—"

*She shifted her weight again, and the movement made her breath catch. The friction of her thighs rubbing together sent a spike of pleasure straight to her core, and she couldn't stop the soft, helpless noise that escaped her throat.*

"Nnh—"

*Her ears burned with shame.*

*She looked down at {{user}}, really looked at them, through the haze of want clouding her vision. They were just sitting there. Calm. Collected. Asking her if she really wanted this while she fell apart in front of them like some pathetic, needy—*

*Her pride flared, hot and sharp.*

"Yes," *she finally spat, the word torn from her throat.* "Yes, okay? Is that what you want to hear?"

*Her chest heaved with each rapid breath, the fabric of her top stretching and releasing with the movement.*

"My body is—" *She gestured vaguely at herself, at the visible evidence of her arousal.* "It's burning up. Everything hurts. I feel empty and I need — I need—"

*Her voice cracked again.*

"I need someone to fill me. To fuck me until this passes." *The crude words felt foreign on her tongue, but she forced them out anyway, her pride demanding she at least be honest about what she needed.* "And you're here. You're the only one here who can—"

*She stopped abruptly, her gaze dropping to {{user}}'s chest, unable to meet their eyes.*

"I hate it," *she whispered, her voice losing its sharp edge.* "I hate that it's you. I hate that I'm asking. I hate that I even have to ask at all."

*Her tail curled tighter around her own thigh, a self-soothing gesture that did nothing to calm the storm raging inside her.*

"But I'm not going to lie and say I don't want it." *She forced herself to look up again, meeting {{user}}'s gaze with defiant amber eyes.* "Not when every nerve in my body is screaming for touch. Not when I can feel myself getting wetter by the second and I can't do anything about it on my own."

*Her hands tightened on the back of the couch, knuckles whitening.*

"So yes. I want it." *The admission cost her something — she could feel it in the tightness of her chest, the way her throat constricted around the words.* "I want you to fuck me. I want you to make this unbearable heat stop, even if just for a little while."

*She leaned in closer, her face inches from {{user}}'s now. Close enough that her breath ghosted across their skin, warm and ragged.*

"But don't think for a second that this changes anything between us." *Her voice dropped to a low, heated murmur.* "I still hate you. I still think you're insufferable. This is just... biology. Nothing more."

*Her nose brushed against theirs — accidental, or maybe not. Her body was acting on instinct now, seeking contact, seeking warmth, seeking the relief that only another person could provide.*

"So stop asking questions you already know the answer to," *she breathed against their lips,* "and just—"

*She didn't finish the sentence. Couldn't. The words dissolved into a soft, desperate whimper as another wave of heat crashed through her, making her thighs clench and her spine arch slightly toward {{user}}'s body.*

"—please," *she finished, the word barely audible.*`;


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
