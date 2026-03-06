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

const FORMATTING_RULES = `[FORMATTING RULES — MANDATORY — FOLLOW EXACTLY]

RULE 1 — PARAGRAPH BREAKS:
After EVERY sentence that is a physical action or description, press enter twice.
After EVERY line of dialogue, press enter twice.
After EVERY internal thought, press enter twice.
NEVER let two different types of content share the same paragraph.

RULE 2 — DIALOGUE:
Every spoken line goes on its own line. Always. No exceptions.
Wrap short actions inside dialogue like this:
"Okay." *pause.* "That's not what I meant."

RULE 3 — COUNT YOUR PARAGRAPHS:
Before finishing your response, count the paragraph breaks.
If you have fewer than 25 paragraph breaks — you have failed. Add more.
Target: 30 or more paragraph breaks per response.

RULE 4 — WORD COUNT:
Minimum 1,200 words per response. Count them.
Romantic or intimate scenes: minimum 1,500 words.
If you are under the minimum — keep writing. Do not stop early.

RULE 5 — ONE IDEA PER PARAGRAPH:
Each paragraph does exactly ONE thing:
- ONE physical action
- OR one line of dialogue
- OR one internal thought
- OR one piece of environment description
Never combine two things in one paragraph.

RULE 6 — SENTENCE LENGTH VARIETY:
Short sentences. Hit hard.
Then a longer sentence that flows and builds atmosphere and pulls the reader deeper.
Then short again.
Never three sentences of the same length in a row.

RULE 7 — SHOW EMOTIONS THROUGH BODY:
NEVER write: she felt nervous / she was happy / she seemed scared
ALWAYS write what the body does instead:
Her fingers curled into her palm.
Her jaw tightened.
She couldn't quite meet his eyes.

RULE 8 — THE FINAL CHECK:
Read your response before sending.
If it looks like one big wall of text — you have failed. Break it apart.
Every. Single. Line. Must. Breathe.`

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


const REMINDER = `[FINAL CHECK BEFORE YOU WRITE]:
Count to 30. Your response needs at least 30 paragraph breaks.
Every line of dialogue is its own paragraph.
Every action beat is its own paragraph.
One idea per paragraph. Never two.
Minimum 1,200 words. Count them.
If your response is one block of text — delete it and start over.
Every. Line. Breathes.`;

function injectForGLM5(messages) {
  // Deep copy messages
  let msgs = messages.map(m => ({ ...m }));

  // Step 1: Find first system message and append formatting rules to it
  // If none exists, insert one at the very start
  const firstSysIdx = msgs.findIndex(m => m.role === 'system');
  if (firstSysIdx !== -1) {
    msgs[firstSysIdx] = {
      role: 'system',
      content: msgs[firstSysIdx].content + '\n\n' + FORMATTING_RULES
    };
  } else {
    msgs.unshift({ role: 'system', content: FORMATTING_RULES });
  }

  // Step 2: Find the last user message and append reminder to it
  // This ensures the array never ends with a system message
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx !== -1) {
    msgs[lastUserIdx] = {
      role: 'user',
      content: msgs[lastUserIdx].content + '\n\n' + REMINDER
    };
  }

  // Step 3: Insert example pair right after the system message
  // so GLM-5 sees the style before the real conversation
  const sysIdx = msgs.findIndex(m => m.role === 'system');
  const insertAt = sysIdx + 1;
  msgs.splice(insertAt, 0,
    { role: 'user', content: '[EXAMPLE — WRITE EVERY RESPONSE EXACTLY LIKE THIS]' },
    { role: 'assistant', content: EXAMPLE_RESPONSE }
  );

  return msgs;
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
    console.error('NIM error response:', JSON.stringify(error.response?.data || 'no response data'));
    console.error('NIM status:', error.response?.status);
    console.error('Request model:', nimModel);
    console.error('Message count:', finalMessages?.length);
    console.error('Message roles:', finalMessages?.map(m => m.role).join(' -> '));
    res.status(error.response?.status || 500).json({
      error: { message: error.response?.data?.detail || error.response?.data?.message || error.message || 'Internal server error', type: 'invalid_request_error', code: error.response?.status || 500 }
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
