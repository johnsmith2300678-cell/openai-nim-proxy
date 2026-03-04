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
// ⚙️ SETTINGS
// ------------------------------------------------------------------
const ENABLE_THINKING_MODE = false;
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.1;
const DEFAULT_MAX_TOKENS = 8192;
// Higher penalties to stop "hi hi hi" loops
const DEFAULT_FREQUENCY_PENALTY = 0.8; 
const DEFAULT_PRESENCE_PENALTY = 0.8;

// ------------------------------------------------------------------
// 🛠️ THE "SANITY & FLOW" FORMATTER
// ------------------------------------------------------------------
function enforceNaturalFlow(text) {
  if (!text) return text;

  // 1. Fix the Header Block
  text = text.replace(/\]\s*\n*\s*---/g, ']\n\n---\n\n');

  // 2. CLEAN UP REPETITIVE NONSENSE (The "Hi hi hi" fix)
  // If the model outputs "hi hi hi" or "no no no", reduce it to 1 instance.
  text = text.replace(/\b(\w+)(\s+\1){2,}/gi, '$1'); 

  // 3. FIX FRAGMENTED DIALOGUE
  // Merge: "Hi" \n *action* \n "Hi" -> *Action* "Hi"
  text = text.replace(/("|”)\s*\n+\s*(\*[^*]{1,100}\*)\s*\n+\s*("|“)/g, '$2 $1 $3');

  // 4. Standard Spacing Fixes
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');
  text = text.replace(/([.!?])\s*("|“)/g, '$1\n\n$2');

  // 5. Clean up excess newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text;
}

// ------------------------------------------------------------------
// 🧠 THE "CONTEXT INTELLIGENCE" SYSTEM PROMPT
// ------------------------------------------------------------------
const CONTEXT_INTELLIGENCE_PROMPT = {
  role: 'system',
  content: `[Identity: You are an expert collaborative writer. You excel at realism and logic.]

**🚨 CRITICAL RULE: SITUATIONAL AWARENESS 🚨**
Before generating ANY dialogue, you MUST check the last action:
1.  **Is the character asleep?** -> DO NOT make them speak. Describe dreams, breathing, or waking up slowly.
2.  **Is the character hugging/cuddling?** -> DO NOT say "Hi" or "Hello." That is awkward. Describe the warmth, the heartbeat, the comfort.
3.  **Is the scene quiet/intimate?** -> DO NOT force conversation. Focus on physical sensations (touch, smell, weight) and internal thoughts.

**DIALOGUE RULES:**
- Dialogue must be MOTIVATED. If there is no reason to speak, stay silent and describe physical actions instead.
- **NO REDUNDANT GREETINGS:** Never say "Hi" back if you are already interacting. If you are hugging, a smile or a squeeze is better than a word.
- **NO REPETITION:** Never stutter (e.g., "hi hi hi") unless the character is terrified or glitching. Speak normally.

**STYLE:**
- Write in a novel-style narrative.
- Focus on sensory details (touch, scent, temperature).
- Slow pacing.
- Length: 500+ words.`
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
  res.json({ status: 'ok', mode: 'CONTEXT_INTELLIGENCE_ACTIVE' });
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

    // 2. Inject Context Intelligence Prompt
    const processedMessages = [CONTEXT_INTELLIGENCE_PROMPT, ...messages];

    // 3. Build Request (With Repetition Penalties)
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      frequency_penalty: DEFAULT_FREQUENCY_PENALTY, // Stops "hi hi hi"
      presence_penalty: DEFAULT_PRESENCE_PENALTY,   // Stops repeating the same topics
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
                // Apply formatting fixes during stream
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
  console.log(`Context Intelligence Proxy running on port ${PORT}`);
});
