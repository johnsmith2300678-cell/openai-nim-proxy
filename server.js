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

const ENABLE_THINKING_MODE = false; // False is best for RP
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.0;
const DEFAULT_MAX_TOKENS = 8192; 

// ------------------------------------------------------------------
// 🛠️ NOVEL FORMAT ENFORCER (Advanced Logic)
// ------------------------------------------------------------------
function enforceFormatting(text) {
  if (!text) return text;

  // 1. Fix the Header Block (Time/Date/Context)
  // Ensure proper breaks around the header separator
  text = text.replace(/\]\s*\n*\s*---/g, ']\n\n---\n\n');
  text = text.replace(/---\s*\n*\s*(?!\n)/g, '---\n\n');

  // 2. Fix the broken pattern: "Dialogue"\n\n*she said.*
  // This is the specific bad format you showed.
  // Pattern: "Quote" [newlines] *action*
  text = text.replace(/("|”)\n+\s*(\*)/g, '$1\n\n$2');

  // 3. Fix: *action* "Dialogue" -> Ensure break
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');

  // 4. Fix: "Dialogue." *action* -> Ensure break
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');

  // 5. Fix: Sentence. "Dialogue" -> Ensure break
  text = text.replace(/([.!?])\s*("|“)/g, '$1\n\n$2');

  // 6. Fix: "Dialogue." She said. -> Ensure break (narration without asterisks)
  text = text.replace(/("|”)\s*([A-Z][a-z])/g, '$1\n\n$2');

  // 7. Fix orphaned asterisks at end of dialogue blocks
  // Pattern: "Dialogue. *" -> "Dialogue."\n\n*
  text = text.replace(/("\s*)\*(?!\s)/g, '$1\n\n*');

  // 8. Fix dialogue that ends with weird asterisk placement
  // "text.*" -> "text." * 
  text = text.replace(/(\w)\s*\*(")/g, '$1$2\n\n*');

  // 9. Clean up any triple+ newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  // 10. Remove any weird leading/trailing whitespace on lines
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text;
}

// ------------------------------------------------------------------
// 📝 NOVEL-STYLE SYSTEM PROMPT
// ------------------------------------------------------------------
const RP_SYSTEM_INJECTOR = {
  role: 'system',
  content: `[SYSTEM INSTRUCTION: You are writing a novel. Follow these rules STRICTLY.]

**FORMAT (Most Important):**
- Use asterisks (*) for narration/action.
- Use quotes (") for spoken dialogue.
- ALWAYS put dialogue on its own line, separated by a blank line from narration.

**CORRECT Example:**
*She walked across the room, her footsteps light on the wooden floor. Her fingers traced the edge of the bookshelf.*

"I've been looking for this," *she said, her voice soft.*

*He looked up from his desk, surprise flickering in his eyes.*

**WRONG (Never do this):**
*She walked across the room.* "I've been looking for this," *she said.* *He looked up.*

**WRONG (Never do this):**
"I've been looking for this."
*she said, her voice soft.*

**STYLE:**
- Write in immersive, novelistic prose.
- Focus on sensory details.
- Slow pacing.
- Long, detailed responses.`
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
    formatting: 'NOVEL_ENFORCED' 
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
                // We apply formatting to chunks too, just in case
                let content = data.choices[0].delta.content;
                if (content) {
                   // Basic streaming fixes
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
      // Handle non-streaming response (GUARANTEED FIX)
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message && choice.message.content ? choice.message.content : '';
          
          // 🚀 APPLY NOVEL FORMATTING HERE
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
  console.log(`Formatting Mode: NOVEL ENFORCED (MERGED)`);
});
