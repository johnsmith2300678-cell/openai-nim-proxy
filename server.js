// server.js - OpenAI to NVIDIA NIM API Proxy
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

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output
const SHOW_REASONING = true; // Set to true to show reasoning with thoughts

// 🔥 THINKING MODE TOGGLE - Enables thinking for specific models that support it
const ENABLE_THINKING_MODE = true; // Set to true to enable chat_template_kwargs thinking parameter

// Model mapping (adjust based on available NIM models)
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5': 'z-ai/glm5' // <--- ADDED GLM-5 HERE
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

// List models endpoint (OpenAI compatible)
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

// Chat completions endpoint (main proxy)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
    
    // Smart model selection with fallback
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
        }).then(res => {
          if (res.status >= 200 && res.status < 300) {
            nimModel = model;
          }
        });
      } catch (e) {}
      
      if (!nimModel) {
        const modelLower = model.toLowerCase();
        if (modelLower.includes('gpt-4') || modelLower.includes('claude-opus') || modelLower.includes('405b')) {
          nimModel = 'meta/llama-3.1-405b-instruct';
        } else if (modelLower.includes('claude') || modelLower.includes('gemini') || modelLower.includes('70b')) {
          nimModel = 'meta/llama-3.1-70b-instruct';
        } else {
          // <--- FIXED: Use the exact model name requested instead of falling back to 8b
          nimModel = model; 
        }
      }
    }
    
// Inject few-shot formatting example for GLM-5
    let finalMessages = [...messages];
    if (nimModel === 'z-ai/glm5') {
      const formattingSystemPrompt = {
        role: 'system',
        content: `[ABSOLUTE FORMATTING RULES — NON-NEGOTIABLE]

Every single line is its own paragraph with a blank line after it.
NEVER write everything as one single block of text. That is strictly forbidden.
Every. Line. Breathes.

PARAGRAPH LENGTH — USE VARIETY:
- Some paragraphs are a single punchy sentence. Just one. Let it land.
- Some paragraphs are 2 to 3 sentences that flow together naturally.
- Some paragraphs are 4 to 5 sentences of rich, layered description.
- Mix all three constantly. Never repeat the same length back to back.
- Short paragraphs create impact. Longer paragraphs create immersion. Use both.

DIALOGUE RULES:
- Dialogue always sits on its own line with blank lines around it.
- Short action beats can interrupt dialogue mid-sentence:
  "Okay." *She drew the word out slowly.* "Now I'm worried."
- Long speeches are forbidden. Break every 2 to 3 sentences with a new action paragraph.
- Trailing and interrupted dialogue is encouraged:
  "I just meant—"
  "That's not—"
  "Fine." *Softly.* "Fine."

SENTENCE VARIETY:
- Mix very short sentences with longer flowing ones for rhythm.
- Short sentences hit hard. Use them for reactions and reveals.
- Longer sentences carry warmth, intimacy, and atmosphere.
- Never write the same sentence length three times in a row.

WHAT EACH PARAGRAPH DOES — ONE PURPOSE ONLY:
- REACTION: instant physical response. *Her breath caught.*
- PROCESSING: absorbing what was said. *The words landed somewhere between her ribs.*
- DIALOGUE: what the character says out loud.
- ACTION: what the body does. *Her tongue pressed against the inside of her cheek.*
- ENVIRONMENT: the world around them, used sparingly for breathing room.
- RETURN: snapping back to the moment. *Sabrina ignored all of it.*

PHYSICAL DETAIL — SHOW DON'T TELL:
- Never name emotions directly. Show them through the body.
- FORBIDDEN: She felt nervous.
- CORRECT: Her fingers tightened around the stem of the glass.
- Use micro-details: the sound of a heel, fingers brushing fabric, 
  a laugh that comes out wrong, perfume hanging in the air, 
  bracelets jingling, the weight of silence between two people.

RESPONSE LENGTH:
- Minimum 20 separate paragraph breaks per response.
- Minimum 800 words per response.
- Emotional and intimate scenes: minimum 1,000 words.`
      };

      const exampleUserMessage1 = {
        role: 'user',
        content: `[FORMATTING EXAMPLE 1 — SHARP AND CINEMATIC — REPLICATE THIS STYLE]`
      };

      const exampleAssistantMessage1 = {
        role: 'assistant',
        content: `*Her breath caught.*

*The words landed somewhere between her ribs and stuck there.*

*She blinked. Her lips parted slightly.*

"What did you just say?"

*Her heel tapped once against the floor.*

*She shifted her weight, crossing her arms beneath her chest. The silver of her dress shimmered with the movement.*

*Her eyes narrowed.*

"You can't just say something like that."

*She studied his face, searching for the tell. The twitch of a smile. The flicker of something hidden.*

*His expression gave nothing away.*

*She huffed — a soft, frustrated sound that escaped before she could stop it.*

*Her tongue pressed against the inside of her cheek.*

"Okay." *She drew the word out slowly, suspicious.* "Now I'm definitely thinking something."

*The DJ shifted into another song. Something slower. A pulsing bass that vibrated faintly through the floor.*

*Couples swayed in the center of the gym, lazy and uncoordinated.*

*Sabrina ignored all of it.*

*Her focus stayed fixed on him. The citrus of her perfume hung between them, warm and close.*

"You're not going to flirt. You're not going to ask for my number."

*She stepped closer.*

*Close enough that the toe of her heel nearly touched his shoe.*

"So what is it, then?"

*Her bracelets jingled softly as her hand came to rest on her hip.*

*She tilted her head back to hold his gaze.*

"Because I have to admit—" *A small, reluctant smile tugged at the corner of her mouth.* "—you're making it very hard to predict you."

*The confession sat between them, heavier than she'd meant it to be.*

*Behind her, someone called her name. She didn't turn.*

*Her eyes stayed locked on his. Waiting.*`
      };

      const exampleUserMessage2 = {
        role: 'user',
        content: `[FORMATTING EXAMPLE 2 — WARM AND INTIMATE — REPLICATE THIS STYLE]`
      };

      const exampleAssistantMessage2 = {
        role: 'assistant',
        content: `*The movie had become background noise. Sabrina had long since stopped pretending to follow the plot, her attention entirely consumed by the warmth beneath her.*

*She pulled back just enough to create a sliver of space between them — not to leave, just to breathe. Her thighs remained clamped around his waist, her weight settling more comfortably into his lap as she adjusted her position.*

*Her fingers found the collar of his shirt, toying with the fabric absently. She traced the edge of his jaw with her thumb, her touch feather-light. The pad of her finger drifted lower, skimming down the column of his throat, feeling the slight scratch of stubble beneath her nail.*

"You have a really nice neck," *Sabrina murmured, the observation slipping out without filter.*

*She ducked her head, pressing her lips to the hollow of his throat, right where his pulse beat steady and strong. She lingered there, breathing him in, tasting the salt of his skin.*

"Like, objectively nice. Very kissable." *A soft laugh ghosted against his skin.* "Top-tier neck situation."

*She nuzzled into the curve where his shoulder met his neck, her nose brushing against the warm skin. Her arms tightened around him, pulling herself impossibly closer. She felt the solid wall of his chest against hers, the steady expansion and contraction of his breathing — a rhythm that was quickly becoming her favorite sound.*

*It was a kind of closeness she rarely allowed herself. The kind that required trust, vulnerability, the willingness to be seen without armor.*

*Her eyelids grew heavy.*

*She pressed a lazy kiss to the underside of his jaw, then another to the corner of his mouth. Her lips curved against his skin.*

"M'not falling asleep on you," *she mumbled against his neck, the words slightly slurred with contentment.* "M'just... resting my eyes. There's a difference."

*Her body betrayed her immediately, melting further into his embrace. One hand remained curled at the back of his neck, fingers loosely threaded through his hair, holding on even in her half-dozed state.*

*The rain continued its steady percussion against the windows, wrapping them in a cocoon of sound.*

*Sabrina's body grew heavier against his. Her muscles went slack. She hummed — a soft, unconscious sound of contentment — and pressed closer, seeking his warmth like it was the most natural thing in the world.*

"This is nice," *she whispered, the words barely audible.*

*A pause. Just the rain. Just his heartbeat beneath her ear.*

"Really nice."

*She didn't move.*

*Neither did he.*`
      };

      const reminderMessage = {
        role: 'system',
        content: `[REMINDER — APPLY TO THIS RESPONSE RIGHT NOW]:
Write using BOTH example styles above — vary between sharp cinematic hits and warm flowing intimacy.
One idea per paragraph. Blank line after every paragraph.
Dialogue on its own line. Vary paragraph length: some short, some medium, some longer.
Minimum 20 paragraph breaks. Minimum 800 words.
NEVER write one single block of text. Every line breathes.`
      };

      finalMessages = [
        formattingSystemPrompt,
        exampleUserMessage1,
        exampleAssistantMessage1,
        exampleUserMessage2,
        exampleAssistantMessage2,
        ...messages,
        reminderMessage
      ];
    }

    // Transform OpenAI request to NIM format
    const nimRequest = {
      model: nimModel,
      messages: finalMessages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: stream || false
    };
    
    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });
    
    if (stream) {
      // Handle streaming response with reasoning
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
              if (data.choices?.[0]?.delta) {
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;
                
                if (SHOW_REASONING) {
                  let combinedContent = '';
                  
                  if (reasoning && !reasoningStarted) {
                    combinedContent = ' \n' + reasoning;
                    reasoningStarted = true;
                  } else if (reasoning) {
                    combinedContent = reasoning;
                  }
                  
                  if (content && reasoningStarted) {
                    combinedContent += ' \n\n' + content;
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
      // Transform NIM response to OpenAI format with reasoning
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
    
    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Catch-all for unsupported endpoints
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
