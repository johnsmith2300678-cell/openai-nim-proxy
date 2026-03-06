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

const EXAMPLE_RESPONSE = `*[**⏳ Time**: 8:20 PM → 11:45 PM] | [**📅 Date**: Saturday, June 14, 2025] | [**📍 Location**: Various – Gymnasium Exit, City Streets, Le Petit Coin – Private Dining Room] | [**🌤️ Weather**: Warm summer night, 22°C] | [**👥 Characters**: {{char}}, {{user}}, Bodyguard (Marcus)] | [**📜 Context**: {{char}} and {{user}} leave the reunion together, share an extended dinner at a luxury restaurant, and part ways after exchanging contact information.]*

*The gymnasium doors swung shut behind them, cutting off the murmur of the reunion and the DJ's fading playlist.*

*Outside, the summer air clung to {{char}}'s skin — warmer than the air-conditioned gym, carrying the faint scent of asphalt and distant rain. Her heels clicked against the concrete as she moved toward the waiting SUV, Marcus falling into step a few paces behind. But her attention stayed fixed on {{user}}, walking beside her.*

*Camera flashes erupted from somewhere to the left.*

*She didn't flinch. Didn't even blink.*

"Smile," *she murmured through barely moving lips,* "they're taking pictures."

*Her hand found the crook of his elbow — casual, practiced, the kind of touch that could be read a dozen different ways depending on who was looking. She guided him toward the car with the ease of someone who had navigated paparazzi since before she could legally drive.*

*The restaurant was a small French place tucked between a boutique and a closed bookstore, the kind of spot with no signage outside and a host who knew better than to ask questions.*

*Marcus settled near the entrance, a silent presence that faded into the background as the host led them to a private room in the back. Candlelight flickered across white tablecloths. A single vase of peonies sat between two settings, their petals soft pink against the crisp linen.*

*{{char}} slid into her chair and exhaled — something loosening in her shoulders that she hadn't realized she'd been holding.*

"Okay." *She folded her arms on the table, leaning forward with genuine interest.* "Now I get to interrogate you properly."

*And she did.*

*For the next three hours, the conversation flowed like water finding its natural course. She asked about his workout routine — genuinely curious now, not teasing — and listened as he explained the discipline, the early mornings, the way his body had changed over years rather than months. She talked about touring, about the strange loneliness of hotel rooms and the way stadium crowds sometimes felt like a single, breathing entity.*

*She laughed — a lot.*

*Real laughs. The kind that crinkled the corners of her eyes and made her throw her head back, exposing the line of her throat. At one point, she nearly knocked over her wine glass miming a story about a wardrobe malfunction during a live performance, her hand shooting out to catch it just in time.*

"Oh my god—" *She pressed her palm to her chest, still giggling.* "I can't believe I just told you that. I've never told anyone that."

*The teasing never fully disappeared. It was part of who she was — woven into the fabric of her personality like the sequins on her dress. But underneath it, something softer emerged. Something genuine.*

*When the check came, she didn't even glance at it.*

"You're paying, obviously," *she said, her expression completely serious.* "I'm a popstar. I don't carry cash."

*The waiter returned with the card machine, and {{char}} pulled her own black card from her clutch without breaking eye contact.*

"Just kidding." *Her lips curved.* "I got it."

*By the time they stepped back outside, the city had quieted. Fewer cameras now. The streetlights cast pools of amber across the sidewalk, and the air had cooled enough to raise goosebumps along {{char}}'s bare arms.*

*She stopped near the car, turning to face {{user}} fully.*

"This was..." *She paused, searching for the right word. Her tongue pressed against the inside of her cheek.* "...really nice. Unexpectedly nice."

*Her phone appeared in her hand — somehow, she always had it ready.* "Give me your number. And your Instagram. I want to see if your glow-up translates to photos or if you're just cheating with good lighting."

*Numbers were exchanged. Handles swapped. She followed him immediately, her thumb moving across the screen with practiced efficiency.*

"There." *She tucked the phone away and looked up at him, her expression softer than it had been all night.* "Now I can bother you whenever I want."

*The hug came without warning.*

*She stepped forward and wrapped her arms around him, pulling him into something warm and genuine. Her face pressed against his chest — she had to rise on her toes slightly to reach properly — and she lingered there for a moment longer than strictly necessary.*

"Thanks for tonight," *she murmured against his shirt.* "For not making it weird. For just... being normal."

*She pulled back, smoothing down the front of her dress.*

"Okay." *A breath.* "Goodnight, {{user}}."

*By the next morning, the internet had exploded.*

*Trending topics: #MysteryMan, #ReunionRomance, #WhoIsHe.*

*Fan accounts had already cropped up — analyzing the grainy paparazzi photos, zooming in on the way her hand rested on his arm, the tilt of her head as she leaned toward him outside the restaurant. Speculation ran wild. Was he a new boyfriend? A producer? A childhood friend?*

*{{char}} posted nothing.*

*She didn't address it. Didn't confirm. Didn't deny.*

*Just a single Instagram story, posted at 2 AM: a screenshot of a playlist titled* "glittering rage," *with the caption:*

\`late night thoughts 🌙\`

*No context. No explanation.*

*And in her messages, a thread that had started the night before — her name at the top, his number saved under a contact that made her smile every time she saw it.*`;


const REMINDER = `[FINAL CHECK BEFORE YOU WRITE]:
Count to 30. Your response needs at least 30 paragraph breaks.
Every line of dialogue is its own paragraph.
Every action beat is its own paragraph.
One idea per paragraph. Never two.
Minimum 1,200 words. Count them.
If your response is one block of text — delete it and start over.
Every. Line. Breathes.`;


// ═══════════════════════════════════════════════════
// GLM-5 RESPONSE POST-PROCESSOR
// Automatically reformats single-paragraph responses
// into proper multi-paragraph format
// This runs AFTER GLM-5 generates, guaranteeing format
// ═══════════════════════════════════════════════════
function reformatResponse(text) {
  if (!text) return text;

  let result = text;

  // Add blank line before dialogue that follows action beats
  result = result.replace(/(\*[^*]+\*)\s*(")/g, '$1\n\n$2');

  // Add blank line after dialogue that is followed by action beats
  result = result.replace(/(")(\s*)(\*)/g, '$1\n\n$3');

  // Add blank line after closing action beat followed by new sentence or dialogue
  result = result.replace(/(\*)\s+([A-Z"])/g, '$1\n\n$2');

  // Split paragraphs that are too long (over 200 chars and not dialogue)
  result = result.split('\n\n').map(para => {
    para = para.trim();
    if (para.length < 200) return para;
    if (para.startsWith('"')) return para;

    // Split at sentence boundaries - period/!/? followed by space and capital
    return para.replace(/([.!?])\s+([A-Z*"])/g, '$1\n\n$2');
  }).join('\n\n');

  // Clean up 3+ newlines down to 2
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}


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
          // Post-process GLM-5 responses to fix single paragraph issue
          if (nimModel === 'z-ai/glm5') {
            fullContent = reformatResponse(fullContent);
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
