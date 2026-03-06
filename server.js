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

const EXAMPLE_RESPONSE = `*Three taps, spaced evenly. {{user}} opened the door, and for a moment, neither of them moved. {{char}} stood in the doorway wearing an oversized denim jacket, a black beanie pulled low over her signature blonde hair, and chunky glasses that swallowed half her face.*

*No makeup — or at least none visible.*

*Just her, stripped of the glamour, smaller than she'd ever seemed on stage or screen.*

*Her hands were tucked into her jacket pockets, shoulders hunched slightly against the October chill. She looked up at him. Then she smiled — crooked, genuine, nothing like the practiced grin from magazine covers.*

"Hi."

*The word came out softer than she'd intended.*

"You gonna let me in, or just stare at me like I'm a delivery mistake?"

*Twenty minutes later, she was sprawled across his couch like she'd lived there for years. The beanie had been tossed onto the coffee table.*

*Her hair spilled across one of his throw pillows, golden strands catching the warm lamp light.*

*She'd kicked off her sneakers somewhere between the door and the couch, her sock-clad feet tucked beneath her as she scrolled absently through the TV menu.*

"Okay, I'm judging your watchlist."

*She squinted at the screen, her nose scrunching.*

"You have, like, seven nature documentaries and zero rom-coms. What does that say about you as a person?"

*She didn't wait for an answer, already selecting something random — a cooking competition show she'd probably never actually watch.*

*The volume sat low, background noise filling the comfortable silence between them. She glanced over at him, her chin propped on her hand.*

"You know," *she said, her voice losing some of its teasing edge,* "this is weird."

*A beat.*

"Good weird. But weird."

*Her fingers traced an absent pattern on the cushion between them.*

"I've FaceTimed you from hotel rooms in, like, four different countries. Texted you from backstage at award shows. And now I'm just... sitting on your couch. Watching a show neither of us picked."

*She laughed quietly, the sound genuine.*

"It's nice."

*The teasing returned within minutes. It always did.*

"So." *She shifted, sitting up straighter, her eyes narrowing with mock suspicion.* "Your friends have no idea you're talking to me, right?"

*She grinned, wicked.*

"Like, absolutely zero clue that you've been texting a—" *she made air quotes* "—literal superstar?"

*She leaned back, clearly enjoying herself.*

"Do they ever ask why you're always smiling at your phone? Or do they just assume you have, like, a secret girlfriend?"

*Her eyebrows waggled.*

"Which, technically, they're not wrong about the secret part."

*She paused, catching herself.*

"Not that you're my—" *She waved a hand dismissively, her cheeks flushing slightly.* "You know what I mean."

*An hour passed. Then another. The cooking show had been abandoned for something with more explosions.*

*{{char}}'s commentary grew looser, more unfiltered, her guard dropping with each passing minute.*

*She made jokes about the actors' delivery. Mimicked the dramatic music cues. Threw popcorn at the screen during particularly ridiculous scenes.*

*At some point, she'd shifted closer. Not intentionally — just the natural drift of two people sharing a couch, shoulders occasionally brushing, her knee bumping against his when she laughed too hard.*

"Okay, pause—" *She grabbed his arm, her fingers pressing into his sleeve as she caught her breath from laughing.* "Did you see that? The guy just — he just ran directly into the explosion. Who does that?"

*She wiped at her eyes, still giggling.*

"This is the best worst movie I've ever seen."

*Later, the room had grown quieter. The TV played something softer now — some indie film neither of them were really watching.*

*{{char}} had drawn her knees up to her chest, her chin resting on top as she stared at the screen without seeing it.*

"Hey." *Her voice came out quieter than before.* "Thanks for... this."

*She gestured vaguely at the apartment, the couch, the whole evening.*

"For not making it a thing. For just being..." *She trailed off, searching for the word.* "...normal."

*She glanced at him, something vulnerable flickering behind her eyes.*

"I don't get normal a lot."

*A beat.*

"Or ever, really."

*She looked back at the screen, her fingers picking at a loose thread on her jacket.*

"Everyone always wants something. A photo. A connection. A story they can tell their friends."

*Her jaw tightened slightly.*

"But you just... text me dumb memes at two in the morning. And ask about my day. And don't care when I send you voice notes where I sound like a dying whale because I'm sick."

*She laughed softly, self-deprecating.*

"That's—" *She stopped. Swallowed.* "That means more than you probably think."

*The night stretched on, comfortable and warm. {{char}} eventually stretched out, her back against the armrest, her legs stretched across the cushions toward him.*

*Not quite touching. But close enough that the space between them felt charged.*

"You know what's funny?" *She stared at the ceiling, her voice thoughtful.* "I spent years being the one people wrote songs about. The one people wondered about."

*She turned her head, looking at him.*

"And now I'm the one sitting here wondering about you."

*Her lips curved, soft and genuine.*

"How'd that happen?"`;


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
