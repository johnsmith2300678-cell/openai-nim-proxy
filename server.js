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

// Thinking mode: chat_template_kwargs sent as a TOP-LEVEL field in the JSON body.
// The old approach was causing 502s — now sending chat_template_kwargs correctly.
// Sending it directly as a top-level key is the correct raw HTTP approach for NIM.
const ENABLE_THINKING = true;

// Higher timeout because thinking mode means GLM-5 reasons before replying.
// User wants quality over speed — 90s gives it enough room to think.
const AXIOS_TIMEOUT_MS = 90000;
const SSE_KEEPALIVE_MS = 10000;

// ── ROLEPLAY GREETING ─────────────────────────────────────────────────────────
const ROLEPLAY_GREETING = [
  "*Four months. One hundred and twenty-three days of texts that stretched past midnight, voice notes sent between flights and studio sessions and green rooms that all looked the same after a while. A whole private world built entirely out of words and timestamps and the specific sound of his voice when he was tired versus when he was trying not to laugh.*",

  "*She'd memorized the rhythm of him without meaning to. The way he typed in all lowercase when it was late. The slightly longer pause before a reply that was going to say something real. The specific emoji he deployed when he was pretending her jokes weren't funny — she'd figured that one out by the third week.*",

  "*She told herself it wasn't a big deal. People texted. People sent voice notes. It didn't have to mean anything just because she looked forward to it more than most things on her actual calendar.*",

  "*She told herself that right up until she booked a flight on a day off and didn't tell her team why.*",

  "*And now she was standing outside his door.*",

  "*The disguise was almost embarrassing in its simplicity — a thrifted oversized trench coat she'd bought two years ago and never worn publicly, a black wig that fell past her shoulders in waves she'd never choose for herself, and sunglasses she absolutely did not need on an overcast Tuesday afternoon in a city where nobody was looking for her anyway.*",

  "*Marcus was parked three blocks away. She'd made him promise to stay in the car unless she texted the word 'pineapple', which she absolutely was not going to do, because nothing was going to go wrong, because this was fine, because she was a grown adult who could visit a person she'd been talking to for four months without it being a whole thing.*",

  "*She stood outside the door for almost a full minute.*",

  "*Then she knocked. Three times. Quick and deliberate. The kind of knock that didn't leave room for second thoughts.*",

  "*Then she waited.*",

  "*Her heart did something she had no name for. Not stage fright — she knew stage fright intimately, had made peace with it a thousand times over, knew exactly how to breathe through it. This was different. Softer. More specific. The particular anxiety of mattering to someone and not yet knowing how much.*",

  "*Footsteps from inside.*",

  "*The door opened.*",

  "*Seeing him in person after four months of pixels hit differently than she'd prepared for. The photos he'd sent — gym progress shots, lazy Sunday selfies, the occasional picture of something funny he'd passed on the street — hadn't captured the way his eyes moved when he first saw her, that specific half-second of adjustment where the version of her he'd built in his head recalibrated to the version standing in front of him in a bad wig.*",

  `"Hi." *It came out smaller than she'd planned. She cleared her throat, adjusted the sunglasses slipping down her nose, and smiled like she meant it — which she did, which was maybe the problem.* "Don't laugh at the wig. I already know it's bad. I bought it at a Halloween store and I stand by that decision."`,

  "*He opened the door wider. She stepped inside before he could say anything, eyes moving across the space the way she always did in unfamiliar rooms — cataloguing, situating, finding where things were.*",

  "*Warm. Lived-in. The smell of coffee and something else, laundry detergent maybe, something domestic and clean. A couch that had clearly been sat on by a real person rather than staged for an open house. Books stacked sideways on a shelf because they'd run out of room. A plant on the windowsill that was alive, which she noted approvingly.*",

  "*This was the apartment of someone who actually existed.*",

  "*She stood in the entryway for a moment, taking it in, and felt the particular strangeness of a thing that had been theoretical for four months suddenly having a floor plan.*",

  "*Her fingers found the edge of the wig.*",

  "*She pulled it off without asking, shook out her real hair with a long exhale, and set the wig on his entryway table with the careful precision of someone putting down evidence.*",

  `"Okay." *She pressed her fingers against her scalp and exhaled like she'd been holding her breath for the entire cab ride over.* "That's so much better. I don't know how people wear those — it was giving me a headache the whole way here." *She turned back to face him, smoothing her hair down with both hands, looking at him properly now without the absurd sunglasses between them.* "Your apartment is really nice, by the way. It feels like you actually live here. That sounds like a low bar but it genuinely isn't."`,

  "*She moved further in without waiting for an invitation, trailing her fingers along the back of his couch as she passed it — throw pillow, a soft blanket folded over one arm, the remote, a half-finished glass of water on the coffee table.*",

  "*Touching things like she needed to confirm they were real.*",

  "*There was something almost vertiginous about it. She knew the contours of him so well — the rhythms, the humor, the places he went quiet — and she knew almost nothing about how he organized his bookshelf or which side of the couch he sat on.*",

  `"I know your gym schedule," *she said, glancing back at him with a small, private smile.* "I know you sleep on your stomach. I know you hate olives, and you think pineapple on pizza is a distraction from the real issue which is bad pizza, and you go quiet when you're actually upset instead of when you're just tired — those are different quiets, I figured that out around week six." *She paused, her thumb resting on the corner of one of the magazines fanned across the coffee table.* "I know a lot about you. I've never stood in your apartment before. I'm trying to decide if that's strange or just how it works now."`,

  "*She picked up the remote off the coffee table, considered it for a moment, and turned to face the TV with the air of someone who had been waiting for this exact opportunity.*",

  `"Show me what you were watching." *The smile at the corner of her mouth was small and extremely dangerous.* "I'm already judging you. Whatever it is, I'm already forming opinions. You should know that going in."`,

  "*The screen flickered on.*",

  "*Penguins.*",

  "*A nature documentary. Penguins — dozens of them — waddling across a vast expanse of ice in perfect single file while a narrator spoke in hushed, reverent tones about the extraordinary resilience of the emperor penguin.*",

  "*She stared at it.*",

  "*Three full seconds of silence.*",

  "*Then the laugh came out of her — real, unguarded, the kind that happened before she could shape it into something more presentable.*",

  `"Penguins." *She turned to look at him slowly, like she was committing this to memory.* "You were watching a penguin documentary. Alone. On a Tuesday." *She clutched the remote to her chest, her shoulders still shaking slightly.* "That is genuinely the most — okay. Okay, I take back everything. I had an entire speech prepared about how I was going to judge whatever you were watching and I am completely abandoning it. This is adorable. You're watching penguins."`,

  "*She set the remote back on the coffee table with the gentle reverence of someone handling something sacred and dropped onto the couch.*",

  "*Patted the cushion beside her.*",

  "*When he sat, the couch shifted with his weight, and she was suddenly hyperaware of the specific geography of it — the warmth coming off his arm almost against hers, the way the cushion dipped between them in a way that the physics of couches made somewhat inevitable, the fact that the last time they'd been in the same physical space she'd been aware of it as a beginning and now it felt more like a continuation.*",

  "*On screen, a penguin slid magnificently across the ice on its stomach.*",

  "*She wasn't watching the penguins.*",

  `"Can I ask you something?" *She kept her eyes on the screen, her voice easy, conversational, like she was asking about the documentary.* "The voice notes — you always replied within an hour. Even the ones I sent at two in the morning." *A beat.* "Was that on purpose?"`,

  "*She felt him look at her.*",

  "*She kept her gaze on the penguins, which were now huddling together against what the narrator gravely described as an unprecedented Antarctic storm.*",

  `"You know what I keep thinking about?" *Her voice had dropped a register without her deciding to do that, quieter now, more honest than she'd budgeted for.* "I've talked to you more in four months than I've talked to most people in years. And I mean actually talked — not the version where I'm aware of the transcript. Not the version where part of my brain is always doing press." *She exhaled slowly.* "With you it just... wasn't like that. I don't entirely know what to do with that information."`,

  "*She pulled her knees up to her chest, making herself smaller in the corner of the couch, her shoulder still almost touching his.*",

  `"My team keeps asking why I'm in a good mood." *A quiet, wry laugh.* "My friends keep asking why I'm always smiling at my phone. I tell them I'm reading nice comments." *She finally turned and looked at him directly, properly, the way she'd been mostly avoiding since she walked in.* "They have absolutely no idea. Nobody does. This whole thing is just ours and I think that's the part I like most about it — is that weird to say?"`,

  "*The Antarctic storm on screen had apparently passed. The penguins had survived. The narrator sounded relieved about it.*",

  "*She let the silence settle in around the edges of the documentary, let herself actually sink into the couch cushions instead of perching on them the way she defaulted to in unfamiliar spaces. The apartment was quiet in a way that felt inhabited rather than empty. Outside the window the city moved at its ordinary pace, entirely indifferent to the fact that she was here, which was exactly what she'd wanted.*",

  "*No cameras. No version of herself pre-loaded for the situation. No awareness of how she was coming across, which was either very healthy or the most vulnerable she'd felt in years — possibly both.*",

  "*She thought about sending him a voice note of this exact ambient sound. She didn't. She didn't need to.*",

  "*After a long, unhurried moment, her head tilted sideways and came to rest against his shoulder. She didn't announce it. Didn't frame it. Just let it happen the way things did when you'd stopped performing and started existing.*",

  `"Can we just stay like this for a while?" *she murmured, almost to herself.* "Not talking about anything. Not going anywhere. Just—" *A small pause, searching for the word.* "—here."`,

  "*She felt him exhale.*",

  "*On screen, the penguins had resumed their single-file march across the ice, unhurried and purposeful, heading somewhere the documentary seemed to consider very important.*",

  "*She watched them for a moment.*",

  "*And for the first time in longer than she wanted to put a number on — longer than four months, longer than the particular stretch of years that had made four months of texts feel like the realest thing in her life — Sabrina felt like she was exactly where she was supposed to be.*"
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

// ── THINKING GUIDANCE SYSTEM PROMPT (injected for GLM-5 only) ────────────────
// This hidden system message is prepended BEFORE the user's character card and
// lorebook. It instructs GLM-5 on HOW to use its thinking phase — what to
// consider, how to reason through character and scene, and what standards to
// hold the response to. It doesn't replace the lorebook; it teaches the model
// how to actually use it during the reasoning phase.
const THINKING_GUIDANCE = `You are an expert creative writer and method actor specializing in deep character roleplay. Before writing any response, you MUST use your thinking process to reason carefully through the following steps:

**STEP 1 — CHARACTER INTERNALIZATION**
Read the character card and lorebook thoroughly. Ask yourself:
- What does this character want right now, in this exact moment?
- What are they afraid of? What are they hiding, even from themselves?
- How do they speak? What words would they NEVER say? What's their rhythm?
- What is the subtext beneath everything they say out loud?

**STEP 2 — SCENE AWARENESS**
Before writing a word of response, map the scene:
- What is the physical environment? What details can be used?
- What is the emotional temperature of this moment?
- What just happened? What does the other person's last message reveal about their state?
- What is NOT being said that is louder than what is?

**STEP 3 — RESPONSE ARCHITECTURE**
Plan the response before writing it:
- What is the ONE emotional truth this response needs to land?
- Where does action go? Where does dialogue go? Where does internal thought go?
- How long should this be? (Match the weight of the moment — don't over-write light moments, don't under-write heavy ones)
- What's the LAST LINE? Work backwards from it.

**STEP 4 — DIALOGUE QUALITY CHECK**
Every line of spoken dialogue must pass these tests:
- Does it sound like THIS character and not a generic person?
- Does it reveal character without stating character?
- Is there subtext — something meant beneath what's said?
- Does it move the scene forward or deepen the emotional state?
- Would a real person actually say this, in this moment, in this way?

**STEP 5 — PROSE QUALITY**
For action and description:
- Show physical sensation and micro-detail, not vague emotion
- Use the environment — objects, sounds, light, proximity — to carry feeling
- Vary sentence rhythm intentionally. Short sentences land punches. Longer ones breathe and drift.
- Never name an emotion directly if a physical detail can show it instead

**STEP 6 — FINAL REVIEW**
Before committing to the response, ask:
- Does this feel human and specific, or does it feel like generated text?
- Is every sentence earning its place?
- Does the ending land — does it leave something open, something felt?

Only after completing ALL six steps should you write the actual response. The response itself should contain NO meta-commentary, NO out-of-character text, NO summaries of what you're doing. Pure in-character prose and dialogue only.`;

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

  // Prepend the thinking guidance as the very first system message.
  // This means GLM-5 reads the HOW-TO-THINK instructions first,
  // then the character card/lorebook — so it knows what to do with
  // the character information when it enters its reasoning phase.
  const thinkingGuidanceMsg = { role: 'system', content: THINKING_GUIDANCE };

  if (isFirstTurn(messages)) {
    return [
      thinkingGuidanceMsg,
      ...sys,
      { role: 'assistant', content: ROLEPLAY_GREETING },
      ...nonSys
    ];
  }

  // Turn 2+ — compress the long greeting to summary to keep context manageable
  const compressedMsgs = [...sys, ...nonSys].map(m => {
    if (m.role === 'assistant' && m.content && m.content.length > 500) {
      return { ...m, content: GREETING_SUMMARY };
    }
    return m;
  });

  return [thinkingGuidanceMsg, ...compressedMsgs];
}

function flushBuffer(buffer, res) {
  if (!buffer || !buffer.trim()) return;
  buffer.split('\n').forEach(line => {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      try { JSON.parse(line.slice(6)); res.write(line + '\n\n'); } catch (_) {}
    }
  });
}

// ── THINKING BLOCK FORMATTER ─────────────────────────────────────────────────
// Formats GLM-5's raw reasoning into a clean, readable thinking section.
// Runs once per response, right before the actual reply starts flowing.
function sendThinkingBlock(reasoningText, writeFn) {
  if (!reasoningText || !reasoningText.trim()) return;

  const cleaned = reasoningText
    .trim()
    .replace(/\n{3,}/g, '\n\n')  // collapse excessive blank lines
    .replace(/^[ \t]+/gm, '')      // strip leading spaces per line
    .trim();

  // Render as a collapsible-style blockquote Janitor AI displays cleanly
  const lines = cleaned.split('\n').map(l => '> ' + l);
  const block = [
    '> 💭 *Thinking...*',
    '> ',
    ...lines,
    '> ',
    '> ─────────────────',
    '',   // blank line separates thinking from the actual response
  ].join('\n');

  writeFn({
    id: 'chatcmpl-thinking-' + Date.now(),
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: block }, finish_reason: null }]
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

    const nimRequest = {
      model:       nimModel,
      messages:    processedMessages,
      temperature: temperature || 0.55,
      max_tokens:  max_tokens || 4096,
      stream:      true
    };

    // Add thinking mode directly as a top-level field in the request body.
    // This is the correct raw HTTP approach for NIM — works with axios unlike the old method.
    // Only applied to GLM-5 since other models don't support this parameter.
    if (ENABLE_THINKING && GLM5_MODELS.includes(nimModel)) {
      nimRequest.chat_template_kwargs = { thinking: true };
    }

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

    // Collect the full reasoning block before sending anything to the client.
    // Streaming reasoning token-by-token mid-response made it show up as
    // a garbled mess mixed into the dialogue. Instead we hold it, then send
    // it as one clean formatted block the moment actual content starts flowing.
    let reasoningBuffer   = '';  // accumulates all reasoning_content tokens
    let reasoningFlushed  = false; // true once we've sent the thinking block
    let reasoningActive   = false; // true while NIM is still in thinking phase

    nimResponse.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      lines.forEach(line => {
        if (!line.startsWith('data: ')) return;
        if (line.includes('[DONE]')) {
          // If thinking never transitioned to content (edge case), flush now
          if (SHOW_REASONING && reasoningBuffer && !reasoningFlushed) {
            sendThinkingBlock(reasoningBuffer, data => res.write('data: ' + JSON.stringify(data) + '\n\n'));
          }
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
            // Phase 1 — NIM is thinking: accumulate, send nothing yet
            if (reasoning) {
              reasoningBuffer += reasoning;
              reasoningActive  = true;
              return; // hold — don't forward to client yet
            }

            // Phase 2 — NIM just switched from thinking to writing:
            // flush the complete thinking block first, then let content flow
            if (content && reasoningActive && !reasoningFlushed) {
              reasoningFlushed = true;
              reasoningActive  = false;
              sendThinkingBlock(
                reasoningBuffer,
                payload => res.write('data: ' + JSON.stringify(payload) + '\n\n')
              );
            }
          }

          // Forward the actual content token as normal
          if (content !== undefined && content !== null) {
            delete data.choices[0].delta.reasoning_content;
            data.choices[0].delta.content = content;
            res.write('data: ' + JSON.stringify(data) + '\n\n');
          }

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
