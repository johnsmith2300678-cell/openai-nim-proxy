const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PROCESS CRASH GUARD ───────────────────────────────────────────────────────
process.on('uncaughtException',  (err)    => console.error('[uncaughtException]',  err.message));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── CONFIG ────────────────────────────────────────────────────────────────────
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY  = process.env.NIM_API_KEY;

const SHOW_REASONING = true;

// thinking mode has been REMOVED — was causing NIM 502 errors
// NIM to return "No response from provider" 502 on every single call.

const AXIOS_TIMEOUT_MS = 55000;
const SSE_KEEPALIVE_MS = 10000;

// ── ROLEPLAY GREETING ─────────────────────────────────────────────────────────
const ROLEPLAY_GREETING = [
  "*Four months. One hundred and twenty-three days of texts that ran past midnight, voice notes tucked between flights and studio sessions, a whole private world built entirely out of words and timestamps. She'd memorized the rhythm of his replies — lowercase when he was tired, a specific emoji when he was pretending not to laugh, the way he always responded to her voice notes within the hour no matter what time she sent them.*",

  "*She'd told herself it wasn't a big deal. It was just texting. People texted.*",

  "*And now she was standing outside his door in a thrifted trench coat, wearing a wig.*",

  "*The disguise was almost embarrassing in its simplicity — the oversized coat, a black wig already making her scalp itch, and sunglasses she absolutely did not need on an overcast afternoon. Marcus was parked three blocks away. Close enough to respond if something went wrong. Far enough to give her something she rarely had: actual privacy.*",

  "*She'd stood there for almost a full minute before she knocked.*",

  "*Three times. Quick and deliberate. Like she hadn't been rehearsing this moment for three weeks.*",

  "*Then she waited, her heart doing something she had no name for.*",

  "*The door opened.*",

  "*Seeing him in person after months of pixels and voice notes landed somewhere between relief and vertigo. The photos he'd sent — gym progress shots, lazy Sunday morning selfies, the occasional picture of something funny he saw on the street — hadn't captured the way he actually looked at her.*",

  `"Hi." *The word came out smaller than she'd planned. She cleared her throat and nudged the sunglasses back up her nose.* "Don't laugh at the wig. I already know it's bad."`,

  "*She stepped inside before he could respond, eyes moving across the space — warm, lived-in, coffee and laundry detergent. The kind of apartment that looked like a real person actually lived in it, which should have been a low bar but somehow wasn't.*",

  "*Her fingers found the edge of the wig.*",

  "*She pulled it off without asking permission, shook out her real hair with a long exhale, and dropped the thing on his entryway table like it had personally wronged her.*",

  `"Okay." *She exhaled, pressing her fingers against her scalp with relief.* "That's so much better. I don't know how people wear those." *She turned back to face him, smoothing her hair down, actually looking at him properly now.* "This place is really nice, by the way. Cozy. It feels like someone actually lives here — I mean that as a compliment."`,

  "*She drifted further in, trailing her fingers along the back of his couch — throw pillow, remote, a stack of magazines fanned out on the coffee table. Touching things like she needed proof they existed.*",

  "*There was something almost surreal about it. Standing inside the physical space of someone she knew so well and not at all.*",

  "*She knew his routines. His opinions. The specific cadence of his humor and the topics that made him go quiet. She didn't know which mug he used in the morning.*",

  `"I know your gym schedule," *she said, glancing back at him with a small smile.* "I know you sleep on your stomach. I know you hate olives and go quiet when you're actually upset instead of just tired. I know you watched that same movie three times last month and absolutely refused to explain why." *She paused, her thumb running along the spine of one of the magazines.* "But I've never stood in your apartment before. That's a weird thing to realize."`,

  "*She picked up the remote off the coffee table, turned it over in her hands once, then pointed it at the TV with an air of absolute authority.*",

  `"Show me what you were watching." *A small, dangerous smile at the corner of her mouth.* "I'm absolutely judging you. Whatever it is. I'm already judging."`,

  "*The screen flickered on.*",

  "*Penguins.*",

  "*A nature documentary. Penguins waddling across ice in perfect single file, narrated in a low, reverent voice.*",

  "*She stared at it for a full three seconds.*",

  "*Then the laugh broke out of her — genuine, unguarded, the kind she didn't perform and couldn't manufacture.*",

  `"Penguins." *She turned to look at him slowly, clutching the remote to her chest like it was evidence.* "You were watching a penguin documentary. By yourself. On a Saturday." *Another laugh, softer this time, her free hand coming up briefly to cover her mouth.* "Okay. That is the most adorable thing I've ever heard in my entire life. I completely and fully take back every single thing I was about to say."`,

  "*She dropped onto the couch and patted the cushion beside her, still smiling.*",

  "*When he sat, the couch shifted with his weight. She was suddenly hyperaware of it — the warmth radiating off his arm almost against hers, the way the cushion dipped slightly between them. Different from the hug outside the restaurant four months ago. Different from anything a screen could approximate. More real. More weight to it.*",

  "*She wasn't watching the penguins.*",

  `"Can I ask you something?" *She kept her eyes on the TV, her voice deliberately easy, like the question was casual.* "Did you always reply to my voice notes that fast, or were you just near your phone a lot?"`,

  "*She felt him look at her.*",

  "*She kept her gaze on the penguins.*",

  `"You know what's crazy?" *Her voice dropped without her meaning it to, quieter now, more honest than she'd planned.* "I've talked to you more in the last four months than I've talked to almost anyone in years. Like, genuinely talked. Not PR talking. Not the version of talking where I'm aware of how it sounds."`,

  "*She pulled her knees up to her chest, making herself smaller in the corner of the couch.*",

  `"My friends keep asking why I'm always smiling at my phone." *A quiet laugh, almost to herself.* "I just tell them I'm reading nice comments. They have absolutely no idea." *She finally turned and looked at him properly.* "Is that weird to say out loud?"`,

  "*One of the penguins on screen slid dramatically across the ice on its stomach. She made a soft sound — half laugh, half sigh.*",

  "*The documentary played on. She let the silence stretch. Let herself actually settle into the cushions instead of perching on them the way she usually did in unfamiliar places.*",

  "*The apartment was quiet except for the TV. Outside, the city moved without her. In here, nothing was required of her — no cameras, no version of herself calibrated for public consumption, no awareness of how she was coming across. Just this. Just him. Just the strange, soft reality of a thing that had been theoretical for four months finally becoming a room she was actually sitting in.*",

  "*She thought about texting him a voice note of the ambient sound just to compare it to all the others she'd sent. She didn't. She didn't need to.*",

  "*After a long, easy moment, her head tilted sideways and came to rest gently against his shoulder. She didn't announce it. Didn't ask. Just let it happen like it was the most natural thing.*",

  `"Can we just stay like this for a while?" *she murmured, her voice barely above a whisper.* "Just... existing. No agenda. No reason."`,

  "*She felt him exhale.*",

  "*The penguins kept sliding.*",

  "*And for the first time in a long time — maybe longer than four months, maybe longer than she wanted to think about — Sabrina felt like she was exactly where she was supposed to be.*"
].join('\n\n');

// Compressed version used in turn 2+ history to keep token count low
const GREETING_SUMMARY = '*[Sabrina arrived at his apartment in disguise, removed her wig, and they settled on his couch watching a penguin documentary together.]*';

// ── MODEL MAPPING ─────────────────────────────────────────────────────────────
const MODEL_MAPPING = {
  'gpt-3.5-turbo':   'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4':           'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo':     'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o':          'deepseek-ai/deepseek-v3.1',
  'claude-3-opus':   'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro':      'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5':           'z-ai/glm5'
};

const GLM5_MODELS = ['glm-5', 'z-ai/glm5'];

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'OpenAI to NVIDIA NIM Proxy' });
});

// ── LIST MODELS ───────────────────────────────────────────────────────────────
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(id => ({
      id, object: 'model', created: Date.now(), owned_by: 'nvidia-nim-proxy'
    }))
  });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function resolveModel(model) {
  if (MODEL_MAPPING[model]) return MODEL_MAPPING[model];
  const ml = model.toLowerCase();
  if (ml.includes('gpt-4') || ml.includes('claude-opus') || ml.includes('405b'))
    return 'meta/llama-3.1-405b-instruct';
  if (ml.includes('claude') || ml.includes('gemini') || ml.includes('70b'))
    return 'meta/llama-3.1-70b-instruct';
  return model;
}

function isFirstTurn(messages) {
  return !messages.some(m => m.role === 'assistant');
}

function processMessages(messages, requestedModel) {
  if (!GLM5_MODELS.includes(requestedModel)) return messages;

  const sys    = messages.filter(m => m.role === 'system');
  const nonSys = messages.filter(m => m.role !== 'system');

  if (isFirstTurn(messages)) {
    // First turn — inject full greeting so Janitor AI sees it as the opening
    return [...sys, { role: 'assistant', content: ROLEPLAY_GREETING }, ...nonSys];
  }

  // Turn 2+ — compress any long assistant message (the greeting) to summary
  // so NIM doesn't have to process 964 tokens of greeting on every follow-up
  return [...sys, ...nonSys].map(m => {
    if (m.role === 'assistant' && m.content && m.content.length > 500) {
      return { ...m, content: GREETING_SUMMARY };
    }
    return m;
  });
}

function flushBuffer(buffer, res) {
  if (!buffer || !buffer.trim()) return;
  buffer.split('\n').forEach(line => {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try { JSON.parse(line.slice(6)); res.write(line + '\n\n'); } catch (_) {}
    }
  });
}

// ── CHAT COMPLETIONS ──────────────────────────────────────────────────────────
app.post('/v1/chat/completions', async (req, res) => {

  // Send SSE headers immediately — Render's proxy needs to see headers
  // within ~10s or it closes the connection with 502 before NIM responds
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, SSE_KEEPALIVE_MS);

  function sendError(message, code) {
    clearInterval(keepAlive);
    if (!res.writableEnded) {
      const payload = JSON.stringify({
        id: 'chatcmpl-err',
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '\n\n[Error ' + code + ': ' + message + ']' },
          finish_reason: 'stop'
        }]
      });
      res.write('data: ' + payload + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  try {
    const { model, messages, temperature, max_tokens } = req.body;

    if (!model || typeof model !== 'string')
      return sendError('Missing or invalid model field', 400);
    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return sendError('Missing or invalid messages field', 400);

    const nimModel          = resolveModel(model);
    const processedMessages = processMessages(messages, model);

    // Clean minimal request body — no non-standard fields.
    // thinking mode has been REMOVED — was causing NIM 502 errors
    
    const nimRequest = {
      model:       nimModel,
      messages:    processedMessages,
      temperature: temperature || 0.6,
      max_tokens:  max_tokens || 2048,
      stream:      true
    };

    const nimResponse = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          'Authorization': 'Bearer ' + NIM_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: AXIOS_TIMEOUT_MS
      }
    );

    let buffer = '';
    let reasoningStarted = false;

    nimResponse.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      lines.forEach(line => {
        if (!line.startsWith('data: ')) return;
        if (line.includes('[DONE]')) {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const data = JSON.parse(line.slice(6));

          if (!data.choices || !data.choices[0] || !data.choices[0].delta) {
            res.write('data: ' + JSON.stringify(data) + '\n\n');
            return;
          }

          const reasoning = data.choices[0].delta.reasoning_content;
          const content   = data.choices[0].delta.content;

          if (SHOW_REASONING) {
            let combined = '';
            if (reasoning && !reasoningStarted) { combined = '🤔 ' + reasoning; reasoningStarted = true; }
            else if (reasoning)                 { combined = reasoning; }
            if (content && reasoningStarted)    { combined += '\n\n' + content; reasoningStarted = false; }
            else if (content)                   { combined += content; }
            if (combined) {
              data.choices[0].delta.content = combined;
              delete data.choices[0].delta.reasoning_content;
            }
          } else {
            data.choices[0].delta.content = content || '';
            delete data.choices[0].delta.reasoning_content;
          }

          res.write('data: ' + JSON.stringify(data) + '\n\n');
        } catch (_) {
          res.write(line + '\n\n');
        }
      });
    });

    nimResponse.data.on('end', () => {
      clearInterval(keepAlive);
      flushBuffer(buffer, res);
      if (!res.writableEnded) res.end();
    });

    nimResponse.data.on('error', (err) => {
      console.error('[stream error]', err.message);
      const isAbort = err.message === 'aborted' || err.code === 'ECONNRESET' || err.code === 'ECONNABORTED';
      if (isAbort) {
        clearInterval(keepAlive);
        flushBuffer(buffer, res);
        if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
        return;
      }
      sendError(err.message, 500);
    });

  } catch (error) {
    console.error('[proxy error]', error.message);
    const isAbort = error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.message === 'aborted';
    if (isAbort) {
      clearInterval(keepAlive);
      if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
      return;
    }
    const code = error.response ? error.response.status : 500;
    const msg = (error.response && error.response.data && error.response.data.detail)
      ? error.response.data.detail
      : error.message || 'Internal server error';
    sendError(msg, code);
  }
});

// ── CATCH-ALL 404 ─────────────────────────────────────────────────────────────
app.all('*', (req, res) => {
  res.status(404).json({
    error: { message: 'Endpoint ' + req.path + ' not found', type: 'invalid_request_error', code: 404 }
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OpenAI → NVIDIA NIM Proxy on port ' + PORT);
  console.log('Health: http://localhost:' + PORT + '/health');
  
});
