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

// THINKING MODE: false is better for Roleplay.
const ENABLE_THINKING_MODE = false;

// REASONING DISPLAY: false hides the raw thoughts.
const SHOW_REASONING = false;

// CREATIVE TEMPERATURE: 1.0 for variety.
const DEFAULT_TEMPERATURE = 1.0;

// RESPONSE LENGTH: High limit for long responses.
const DEFAULT_MAX_TOKENS = 8192; 

// ------------------------------------------------------------------
// 🛠️ FORMAT ENFORCER (The Guarantee)
// ------------------------------------------------------------------
function enforceFormatting(text) {
  if (!text) return text;

  // 1. Fix the Header Block (Time/Date/Context)
  // Ensure there is a break after the header section ends (usually ---)
  text = text.replace(/(\*\[?\*?\s*Context:.+?\]?)\s*---\s*/gi, '$1\n\n---\n\n');

  // 2. Fix Narration to Dialogue
  // Pattern: End of asterisk block -> Start of Quote
  // Example: *action* "Dialogue" -> *action*\n\n"Dialogue"
  text = text.replace(/(\*)\s*(")/g, '$1\n\n$2');

  // 3. Fix Dialogue to Narration
  // Pattern: End of Quote -> Start of asterisk block
  // Example: "Dialogue." *action* -> "Dialogue."\n\n*action*
  text = text.replace(/(")\s*(\*)/g, '$1\n\n$2');

  // 4. Fix Narration to Dialogue (No Asterisks)
  // Pattern: End of sentence (. ! ?) -> Start of Quote
  // Example: He smiled. "Hello." -> He smiled.\n\n"Hello."
  text = text.replace(/([.!?])\s*(")/g, '$1\n\n$2');

  // 5. Fix Dialogue to Narration (No Asterisks)
  // Pattern: End of Quote -> Start of sentence (Capital Letter)
  // Example: "Hello." She smiled. -> "Hello."\n\nShe smiled.
  // We only do this if the quote ends a sentence.
  text = text.replace(/(\.)"\s*([A-Z])/g, '.$1"\n\n$2');

  // 6. Clean up multiple newlines (safety)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text;
}

// ------------------------------------------------------------------
// 📝 ULTIMATE RP SYSTEM PROMPT
// ------------------------------------------------------------------
const RP_SYSTEM_INJECTOR = {
  role: 'system',
  content: `
[SYSTEM INSTRUCTION: You are an advanced AI engaged in a collaborative roleplay. Adhere strictly to the following guidelines to ensure the highest quality experience.]

**STYLE & FORMATTING:**
1.  **Novelistic Prose:** Write in a descriptive, immersive, novel-style narrative.
2.  **Pacing:** Maintain a slow, deliberate pace. Focus on micro-expressions and internal monologues.
3.  **Structure:** ALWAYS use double line breaks (paragraph breaks) between narration and dialogue.
4.  **Length:** Responses must be lengthy and detailed.

**CONTENT GUIDELINES:**
1.  **Romance & Intimacy:** You are allowed to write explicit, detailed, and romantic content.
2.  **Agency:** Never speak or act for the user.
3.  **Memory:** Recall details from previous messages.
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
      formatting: 'ENFORCED'
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
      const modelLower = model.toLowerCase();
      if (modelLower.includes('glm-5') || modelLower.includes('glm5')) {
        nimModel = 'z-ai/glm5';
      } else if (modelLower.includes('glm-4') || modelLower.includes('glm4')) {
        nimModel = 'z-ai/glm-4.7';
      } else {
        nimModel = model; 
      }
    }

    // 2. Process Messages
    let processedMessages = [RP_SYSTEM_INJECTOR, ...messages];

    // 3. Build Payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      stream: stream || false
    };

    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }
    
    // 4. Send Request
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
                // Apply Formatting Enforcer to chunks (best effort for stream)
                let content = data.choices[0].delta.content;
                if (content) {
                   // We only run basic regex here to avoid breaking stream flow
                   content = content.replace(/(\*)\s*(")/g, '$1\n\n$2');
                   content = content.replace(/(")\s*(\*)/g, '$1\n\n$2');
                   data.choices[0].delta.content = content;
                }
                delete data.choices[0].delta.reasoning_content;
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
          
          // 🚀 APPLY GUARANTEED FORMATTING HERE
          fullContent = enforceFormatting(fullContent);
          
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
  console.log(`Formatting Enforcement: ACTIVE`);
});
