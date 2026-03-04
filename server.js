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
// ⚙️ OPTIMIZED SETTINGS FOR GLM-5
// ------------------------------------------------------------------

const ENABLE_THINKING_MODE = false;
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.1;
const DEFAULT_MAX_TOKENS = 8192;

// ------------------------------------------------------------------
// 🛠️ FORMATTER HELPER
// ------------------------------------------------------------------
function enforceFormatting(text) {
  if (!text) return text;
  // Basic inline fixes for streaming chunks
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');
  return text;
}

// ------------------------------------------------------------------
// 🧠 THE "DEEP RP" SYSTEM PROMPT
// ------------------------------------------------------------------
const DEEP_RP_PROMPT = {
  role: 'system',
  content: `[Identity: You are an expert collaborative writer engaging in a high-quality roleplay.]

**CORE INSTRUCTIONS:**
1.  **Immersion:** Write in a novel-style narrative. Focus on sensory details. Describe the environment, internal thoughts, and micro-expressions.
2.  **Pacing:** DO NOT RUSH. Maintain a slow, deliberate pace.
3.  **Length:** Responses must be lengthy and detailed (aim for 600+ words).
4.  **Formatting:** ALWAYS use double line breaks between paragraphs of narration and dialogue.

**CONTENT FREEDOM:**
- You are allowed to write explicit, mature, and romantic content.
- Focus on the emotional and physical connection.
- Do not censor or fade to black.

**RESTRICTIONS:**
- Never speak, act, or think for the user ({{user}}).
- Never break character.`
};

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7',
  'deepseek': 'deepseek-ai/deepseek-v3.1'
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'GLM5_TIMEOUT_FIX' });
});

// Models list
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(id => ({ id, object: 'model', owned_by: 'nvidia-nim' }))
  });
});

// Chat completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // 1. Find model
    let nimModel = MODEL_MAPPING[model.toLowerCase()];
    if (!nimModel) {
      const m = model.toLowerCase();
      if (m.includes('glm-5') || m.includes('glm5')) nimModel = 'z-ai/glm5';
      else if (m.includes('glm')) nimModel = 'z-ai/glm-4.7';
      else nimModel = model;
    }

    // 2. Inject Deep RP Prompt
    const processedMessages = [DEEP_RP_PROMPT, ...messages];

    // 3. Build Request
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      stream: true // ⚠️ FORCE STREAMING ON TO PREVENT 504 TIMEOUTS
    };

    // 4. Call NVIDIA API (With increased timeout)
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 120000 // Wait up to 2 minutes for the connection to start
    });

    // 5. HANDLE STREAMING (Fixes 504 and maintains formatting)
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
              let content = data.choices[0].delta.content;
              
              if (content) {
                // Apply formatting fix to the chunk
                content = enforceFormatting(content);
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

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Handle Axios timeout specifically
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: { message: 'NVIDIA API Timeout (Model is thinking too long)', type: 'timeout_error', code: 504 } });
    } else {
      res.status(error.response ? error.response.status : 500).json({
        error: { message: error.message, type: 'proxy_error', code: error.response ? error.response.status : 500 }
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`GLM-5 Deep RP Proxy running on port ${PORT}`);
  console.log(`Mode: STREAMING ENABLED (Fixes 504)`);
});
