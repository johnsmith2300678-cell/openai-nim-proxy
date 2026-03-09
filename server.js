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
// Set to true to see the model's thought process in the reply
const SHOW_REASONING = true;

// Set to true to enable advanced thinking mode (recommended for GLM-5)
const ENABLE_THINKING_MODE = true;
// ------------------------------------------------------------------

// Roleplay greeting — injected as the opening assistant message for GLM-5.
// Each line is its own paragraph so Janitor AI renders them separately.
// The model will naturally continue from wherever the scene leaves off.
const ROLEPLAY_GREETING = `*Heat crept up her neck.*

"What—" *She blinked.* "That's—"

*She laughed, but it came out uneven.*

"Okay." *She exhaled, jaw tightening.* "That's a bold thing to say to someone you haven't seen in years."

*She uncrossed her arms. Slowly.*

"Fine." *Her chin lifted.* "You want to know what I think?"

*She stepped closer.*

"I think you're dangerous." *Her voice dropped.* "Not the muscles. Not the—" *She gestured vaguely.* "—whatever this is."

*Something vulnerable flickered across her face, quick as a heartbeat.*

"I think you're dangerous because you actually believe what you're saying." *She didn't look away.*

*She held his gaze.*

"...And that makes me very curious." *The confession sat in the air between them.*

*Behind her, someone called her name. She didn't turn.*

"So." *Her chin lifted in quiet challenge.* "What are you going to do about that?"`;

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

  res.json({
    object: 'list',
    data: models
  });
});

// System message injected on every GLM-5 request.
// Ironclad paragraph format rules — stated upfront, repeated, shown with full examples.
const STYLE_RULES = `ONE RULE. READ IT FIRST.

Every paragraph is ONE thing. One action. One thought. One line of dialogue with one small action tag.
That is it. That is the entire rule. Everything below is just explaining it in different ways.

─────────────────────────────────────────

WHAT ONE PARAGRAPH LOOKS LIKE:

*She melted into him.*

*There was no other word for it.*

*God, when did I become this person?*

"Mmm." *The sound slipped out without permission.*

"This is ridiculous," *she murmured against his shoulder.* "I'm a popstar. I've sold out stadiums."

"You smell good." *She inhaled against his collar, unashamed.* "Like coffee and something warm."

*Her fingers stilled against his shirt.*

"Hey." *Her voice dropped.* "Can we stay like this a little longer?"

*She pressed closer. If anything.*

"Blame yourself." *She poked his chest lightly.* "You and your stupid face."

*Her eyes fluttered, heavy-lidded.*

"Just..." *She exhaled slowly.* "Let me be here. Like this."

*And for once, she didn't try to take it back.*

─────────────────────────────────────────

WHAT IS BANNED FOREVER — DO NOT WRITE EITHER OF THESE:

BANNED TYPE 1 — Wall of text (action + thought + dialogue fused into one block):
*His palms cradled her face and she felt the warmth seep into her skin—steady, grounding, impossibly gentle. The roughness of his calluses caught against her cheeks and she found herself cataloging the sensation, filing it away somewhere she could find it later.* "That's—" *Her voice cracked. She stopped, swallowed, tried again.* "That's really annoying, actually." *A wet laugh escaped her—half-sob, half-genuine amusement.* "You just say things like that and it's so simple—" *She opened her eyes.* "—and there isn't one. You're just you."

WHY BANNED: Multiple actions, internal thought, multiple dialogue bursts — all one block. Wall of text. Forbidden.

─────────────

BANNED TYPE 2 — Splitting dialogue away from its action onto separate lines:

*Her eyes scanned the space. It was warm. Lived-in.*

"This is..."

*She paused, pulling off her sunglasses.*

"...really nice. Cozy."

WHY BANNED: "This is..." floats alone on its own line. "...really nice. Cozy." floats alone on its own line. The dialogue and its action are orphaned from each other. This is forbidden.

CORRECT VERSION OF THE EXACT SAME SCENE:

*Her eyes scanned the space. It was warm. Lived-in.*

"This is..." *She paused, pulling off her sunglasses.* "...really nice. Cozy."

WHY CORRECT: The action tag lives inside the dialogue line. One paragraph. One moment.

─────────────

ANOTHER BANNED EXAMPLE:

*Her fingers found the edge of the wig, hesitating.*

"Can I—? This thing is suffocating me."

CORRECT:

*Her fingers found the edge of the wig, hesitating.* "Can I—? This thing is suffocating me."

THE LAW: Dialogue and its physical action always share the same line. They are never split apart. Ever.

─────────────────────────────────────────

REPEAT OF THE ONE RULE:

Every paragraph = one moment = one thing.
Blank line between every paragraph. Always.
If your paragraph has more than one action AND dialogue AND internal thought in it — split it up.

─────────────────────────────────────────

MEMORY:

You have a perfect, photographic memory of this entire conversation.
Every name, object, word, confession, joke, detail — no matter how small or how long ago.
Things the user has forgotten, you still remember.
Use it naturally. Never say "as you mentioned" or "earlier you said."
Just show that you were listening. Show that it mattered.

─────────────────────────────────────────

ALSO NEVER USE:
- Headers or labels: [Time: ...] [Location: ...] [Context: ...] [Characters: ...]
- Horizontal dividers or separator lines
- Parenthetical stage directions like (pause) or (softly) or (quietly)
- Emotion labels — never write "she felt nervous" — show what her hands do instead
- The word "cataloging" or any sentence that describes a character analyzing their own feelings out loud

─────────────────────────────────────────

THIS NARRATION STYLE IS ALSO BANNED:

*One hundred and twenty-three days of texts that stretched into the early hours of the morning. Voice notes sent between meetings, between flights, between the strange gaps of a life lived in hotel rooms and recording studios. She'd memorized the rhythm of his replies—the way he typed in all lowercase when he was tired, the specific emoji he used when he was pretending not to laugh at something she'd said.*

WHY IT IS BANNED: That is a narration dump. Three sentences of backstory and internal explanation fused into one long block. It tells the reader things instead of showing a moment happening right now. It slows the scene to a crawl. It is the opposite of the short, punchy, present-moment style required.

THE RULE: Every paragraph must be something happening RIGHT NOW in the scene. Not backstory. Not explanation. Not reflection on what led up to this. What is happening in this exact moment — a movement, a word, a breath, a heartbeat.

CORRECT VERSION of the same idea:
*Four months.*

*And now she was standing outside his door.*

See how short. See how immediate. Each line is one moment. Nothing explained. The weight lands because of what is NOT said, not because of what is.`;

// Inject the roleplay greeting as the first assistant message for GLM-5,
// but only when there is no existing assistant message in the history yet.
// Also injects STYLE_RULES as the first system message on every request
// so the model never uses the forbidden header/divider format.
// Short format reminder appended at the very END of the messages array.
// This is the key fix for the swipe/regenerate problem:
// The model reads top to bottom — rules at the top fade as context grows.
// A reminder at the bottom is the LAST thing it reads before generating,
// so it holds on swipe 2, swipe 3, swipe 4, no matter how many times.
const FORMAT_REMINDER = `BEFORE YOU WRITE YOUR RESPONSE — CHECK THESE THREE THINGS:

1. Every paragraph is ONE thing only. One action. One thought. One dialogue line with one action tag.
2. Dialogue and its action tag are ALWAYS on the same line — never split onto separate paragraphs.
3. Blank line between every paragraph. Always.

If you are about to write a paragraph that contains action + internal thought + multiple dialogue lines all together — STOP. Split it up.`;

function injectRoleplayGreeting(messages, targetModel) {
  if (targetModel !== 'glm-5' && targetModel !== 'z-ai/glm5') return messages;

  const styleMsg    = { role: 'system', content: STYLE_RULES };
  // Reminder appended as a system message at the very end — last thing the model sees
  const reminderMsg = { role: 'system', content: FORMAT_REMINDER };

  const systemMessages    = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const hasAssistantMessage = messages.some(m => m.role === 'assistant');

  if (hasAssistantMessage) {
    // Not first turn — rules at top, reminder at bottom
    return [styleMsg, ...systemMessages, ...nonSystemMessages, reminderMsg];
  }

  // First turn — rules at top, greeting injected, reminder at bottom
  return [
    styleMsg,
    ...systemMessages,
    { role: 'assistant', content: ROLEPLAY_GREETING },
    ...nonSystemMessages,
    reminderMsg
  ];
}

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Smart model selection
    let nimModel = MODEL_MAPPING[model];

    if (!nimModel) {
      try {
        // Attempt to verify if the custom model ID exists on NIM
        await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }, {
          headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
          validateStatus: (status) => status < 500
        }).then(apiRes => {
          if (apiRes.status >= 200 && apiRes.status < 300) {
            nimModel = model;
          }
        });
      } catch (e) {
        // Ignore errors during verification
      }

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

    // Inject roleplay greeting for GLM-5 if applicable
    const processedMessages = injectRoleplayGreeting(messages, model);

    // Build the request payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      stream: stream || false
    };

    // Add thinking parameters if enabled
    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      // Handle streaming response
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
      // Handle non-streaming response
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
            message: {
              role: choice.message.role,
              content: fullContent
            },
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

// Catch-all
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
