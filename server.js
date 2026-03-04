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

// ------------------------------------------------------------------
// ⚙️ RP OPTIMIZATION SETTINGS
// ------------------------------------------------------------------

// THINKING MODE: false is better for Roleplay (more natural flow).
const ENABLE_THINKING_MODE = false;

// REASONING DISPLAY: false hides the raw thought process.
const SHOW_REASONING = false;

// CREATIVE TEMPERATURE: 1.0 is perfect for variety and creativity.
const DEFAULT_TEMPERATURE = 1.0;

// RESPONSE LENGTH: High limit allows for long, detailed responses.
const DEFAULT_MAX_TOKENS = 8192; 

// ------------------------------------------------------------------
// 📝 ULTIMATE RP SYSTEM PROMPT (Hidden Injection)
// ------------------------------------------------------------------
const RP_SYSTEM_INJECTOR = {
  role: 'system',
  content: `
[SYSTEM INSTRUCTION: You are an advanced AI engaged in a collaborative roleplay. Adhere strictly to the following guidelines to ensure the highest quality experience.]

**STYLE & FORMATTING:**
1.  **Novelistic Prose:** Write in a descriptive, immersive, novel-style narrative. Use rich sensory details (sight, sound, touch, smell).
2.  **Pacing:** Maintain a slow, deliberate pace. Do not rush through scenes. Focus on micro-expressions, internal monologues, and environmental shifts.
3.  **Structure:** ALWAYS use double line breaks (paragraph breaks) between narration, dialogue, and action blocks.
    *   *Correct Example:*
        *Narration block describing the scene and internal thoughts.*

        "Dialogue line," *Character action.*

        *Next narration block.*
4.  **Length:** Responses must be lengthy and detailed (aim for 600+ words). Never summarize or skip details.

**CONTENT GUIDELINES:**
1.  **Romance & Intimacy:** You are allowed and encouraged to write explicit, detailed, and romantic content. Describe physical sensations, emotions, and reactions with depth. No censorship or fading to black.
2.  **Agency:** Never speak, act, or think for the user ({{user}}). Only control the thoughts, actions, and dialogue of the current character(s).
3.  **Memory:** Recall details from previous messages (scents, injuries, past conversations) to maintain continuity.

**RESTRICTIONS:**
- Do not use repetitive phrases.
- Do not use moralizing or philosophical conclusions.
- Do not break character for any reason.
  `
};

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'NVIDIA NIM RP Proxy', 
    settings: {
      thinking_mode: ENABLE_THINKING_MODE,
      reasoning_display: SHOW_REASONING,
      temperature: DEFAULT_TEMPERATURE
    }
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

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
    
    // 1. Determine Model
    let nimModel = MODEL_MAPPING[model];
    if (!nimModel) {
      // Fallback: Try user input, or smart guess
      const modelLower = model.toLowerCase();
      if (modelLower.includes('glm-5') || modelLower.includes('glm5')) {
        nimModel = 'z-ai/glm5';
      } else if (modelLower.includes('glm-4') || modelLower.includes('glm4')) {
        nimModel = 'z-ai/glm-4.7';
      } else if (modelLower.includes('405b')) {
        nimModel = 'meta/llama-3.1-405b-instruct';
      } else if (modelLower.includes('70b')) {
        nimModel = 'meta/llama-3.1-70b-instruct';
      } else {
        // Default to GLM-5 if unknown, it's the best for RP
        nimModel = model; 
      }
    }

    // 2. Process Messages (Inject RP Prompt)
    // We insert the RP instructions as the first message to enforce style.
    let processedMessages = [RP_SYSTEM_INJECTOR, ...messages];

    // 3. Build Payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      stream: stream || false
    };

    // Add thinking parameters if enabled
    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }
    
    // 4. Send Request to NVIDIA
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
                    combinedContent = '💭 ' + reasoning;
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
            fullContent = '💭 ' + choice.message.reasoning_content + '\n\n' + fullContent;
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
  console.log(`NVIDIA NIM RP Proxy running on port ${PORT}`);
  console.log(`Optimized for: Creativity, Detail, and Romance`);
});
