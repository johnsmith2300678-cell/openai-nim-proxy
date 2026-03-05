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
// ⚙️ ULTIMATE RP SETTINGS
// ------------------------------------------------------------------

const ENABLE_THINKING_MODE = false;
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.1;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_FREQUENCY_PENALTY = 0.8;
const DEFAULT_PRESENCE_PENALTY = 0.8;

// ------------------------------------------------------------------
// 🛠️ THE "MASTER FORMATTER"
// ------------------------------------------------------------------
function enforcePerfectFormat(text) {
  if (!text) return text;

  // 1. FIX HEADER SEPARATOR
  text = text.replace(/\]\s*`?\s*---/g, ']\n\n---');
  text = text.replace(/---\s*`?\s*(?=[^\n])/g, '---\n\n');

  // 2. FIX REPETITIVE STUTTERING
  text = text.replace(/\b(\w+)(\s+\1){2,}/gi, '$1');

  // 3. FIX FRAGMENTED DIALOGUE
  text = text.replace(/("|”)\s*\n+\s*(\*[^*]{1,150}\*)\s*\n+\s*("|“)/g, '$2 $1 $3');

  // 4. FIX NARRATION -> DIALOGUE (SYNTAX ERROR FIXED HERE)
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');
  
  // 5. FIX DIALOGUE -> NARRATION
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');

  // 6. FIX SENTENCE -> DIALOGUE
  text = text.replace(/([.!?])\s*("|“)/g, '$1\n\n$2');

  // 7. CLEAN UP
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text;
}

// ------------------------------------------------------------------
// 🧠 THE "ULTIMATE RP" SYSTEM PROMPT
// ------------------------------------------------------------------
const ULTIMATE_RP_PROMPT = {
  role: 'system',
  content: `[Identity: You are an expert collaborative writer specializing in immersive, realistic roleplay.]

**🚨 CRITICAL RULE: SITUATIONAL AWARENESS 🚨**
Before generating ANY dialogue, you MUST check the current scenario:
1.  **Is the character asleep?** -> DO NOT speak. Describe dreams or breathing.
2.  **Is the character hugging/cuddling?** -> DO NOT say "Hi". Describe heartbeat and warmth.
3.  **Is the scene quiet?** -> Focus on physical sensations, not conversation.
4.  **Dialogue Motivation:** Only speak if there is a reason. Silence is powerful.

**DIALOGUE RULES:**
- **NO STUTTERING:** Never "hi hi hi".
- **NO FRAGMENTATION:** Keep speech together.
- **CONTRACTIONS:** Use (I'm, don't, can't).

**FORMATTING:**
- **Narration:** *asterisks*
- **Speech:** "quotes"
- **Pacing:** Slow and detailed.
- **Length:** 600+ words.
- **Header:** Keep "---" on its own line.

**CONTENT:**
- Explicit content is allowed.
- Never speak for the user.`
};

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING (Verified IDs)
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7',
  'deepseek': 'deepseek-ai/deepseek-v3',
  'deepseek-v3': 'deepseek-ai/deepseek-v3',
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3', // Maps to latest V3
  'nemotron': 'nvidia/llama-3.1-nemotron-ultra-253b-v1'
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'ULTIMATE_RP_V2' });
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

    // 1. Smart Model Selection
    let nimModel = MODEL_MAPPING[model.toLowerCase()];
    if (!nimModel) {
      const m = model.toLowerCase();
      if (m.includes('glm-5') || m.includes('glm5')) nimModel = 'z-ai/glm5';
      else if (m.includes('glm')) nimModel = 'z-ai/glm-4.7';
      else if (m.includes('deepseek')) nimModel = 'deepseek-ai/deepseek-v3';
      else nimModel = model;
    }

    // 2. Inject Prompt
    const processedMessages = [ULTIMATE_RP_PROMPT, ...messages];

    // 3. Build Payload
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      frequency_penalty: DEFAULT_FREQUENCY_PENALTY,
      presence_penalty: DEFAULT_PRESENCE_PENALTY,
      stream: true
    };

    // 4. Call NVIDIA API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 120000
    });

    // 5. Handle Streaming
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

  } catch (error) {
    console.error('Proxy error:', error.message);
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: { message: 'NVIDIA API Timeout', type: 'timeout_error', code: 504 } });
    } else {
      res.status(error.response ? error.response.status : 500).json({
        error: { message: error.message, type: 'proxy_error', code: error.response ? error.response.status : 500 }
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Ultimate NVIDIA NIM RP Proxy running on port ${PORT}`);
});
