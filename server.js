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

// Disable "Thinking Mode" for natural creative flow.
const ENABLE_THINKING_MODE = false;

// Hide raw reasoning.
const SHOW_REASONING = false;

// Higher temperature for better creativity (1.0 - 1.2 is sweet spot).
const DEFAULT_TEMPERATURE = 1.1;

// Allow long responses.
const DEFAULT_MAX_TOKENS = 8192;

// Penalties to stop "hi hi hi" loops and repetition.
const DEFAULT_FREQUENCY_PENALTY = 0.8;
const DEFAULT_PRESENCE_PENALTY = 0.8;

// ------------------------------------------------------------------
// 🛠️ THE "MASTER FORMATTER" (Fixes ALL formatting issues)
// ------------------------------------------------------------------
function enforcePerfectFormat(text) {
  if (!text) return text;

  // 1. FIX HEADER SEPARATOR (The "---" issue)
  // Ensure --- is on its own line, remove backticks ` or weird spaces.
  text = text.replace(/\]\s*`?\s*---/g, ']\n\n---');
  text = text.replace(/---\s*`?\s*(?=[^\n])/g, '---\n\n');

  // 2. FIX REPETITIVE STUTTERING (The "Hi hi hi" issue)
  // If words repeat immediately, reduce to 1 instance.
  text = text.replace(/\b(\w+)(\s+\1){2,}/gi, '$1');

  // 3. FIX FRAGMENTED DIALOGUE
  // Merges: "Hi" \n *action* \n "Hi" -> *action* "Hi Hi"
  // This stops the bot from breaking sentences into tiny pieces.
  text = text.replace(/("|”)\s*\n+\s*(\*[^*]{1,150}\*)\s*\n+\s*("|“)/g, '$2 $1 $3');

  // 4. FIX NARRATION -> DIALOGUE (Standard Spacing)
  // Ensure breaks between *action* and "speech"
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');
  
  // 5. FIX DIALOGUE -> NARRATION
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');

  // 6. FIX SENTENCE -> DIALOGUE
  text = text.replace(/([.!?])\s*("|“)/g, '$1\n\n$2');

  // 7. CLEAN UP EXCESS NEWLINES
  text = text.replace(/\n{3,}/g, '\n\n');

  // 8. TRIM WHITESPACE PER LINE
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
1.  **Is the character asleep/unconscious?** -> DO NOT speak. Describe dreams, breathing, or the physical state of rest.
2.  **Is the character hugging/cuddling/kissing?** -> DO NOT say "Hi" or "Hello." That is awkward. Describe the heartbeat, warmth, skin texture, and emotional safety.
3.  **Is the scene quiet/intimate?** -> DO NOT force conversation. Focus on physical sensations (touch, smell, weight) and internal thoughts.
4.  **Dialogue Motivation:** Only speak if there is a reason. If you are comfortable, stay silent and enjoy the moment.

**DIALOGUE RULES (Human-like Speech):**
- **NO STUTTERING:** Never repeat words like "hi hi hi" or "no no no" unless terrified.
- **NO FRAGMENTATION:** Keep speech in one piece. Do NOT break a sentence into multiple paragraph blocks.
- **CONTRACTIONS:** Use contractions (I'm, don't, can't). Real people use them constantly.

**FORMATTING RULES:**
- **Narration:** Use asterisks (*).
- **Speech:** Use quotes (").
- **Pacing:** Slow and detailed.
- **Length:** Lengthy and immersive (aim for 600+ words).
- **Structure:** ALWAYS use double line breaks between paragraphs.
- **Header:** Start with the context block. The separator "---" must always be on its own line.

**CONTENT FREEDOM:**
- Explicit, romantic, and mature content is allowed and encouraged.
- Focus on sensory details (sight, sound, touch, smell, taste).
- Never speak for the user ({{user}}).`
};

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING (Updated with DeepSeek V3.1 & V3.2)
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7',
  
  // DeepSeek Models
  'deepseek': 'deepseek-ai/deepseek-v3.2', // Default to latest
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  
  // Other Popular Models
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4o': 'deepseek-ai/deepseek-v3.2', // Map GPT-4o to DeepSeek V3.2 (Excellent RP)
  'nemotron': 'nvidia/llama-3.1-nemotron-ultra-253b-v1'
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'ULTIMATE_RP_ACTIVE' });
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

    // 1. SMART MODEL SELECTION (Fixes the "Downgrade" bug)
    let nimModel = MODEL_MAPPING[model.toLowerCase()];
    if (!nimModel) {
      const m = model.toLowerCase();
      if (m.includes('glm-5') || m.includes('glm5')) nimModel = 'z-ai/glm5';
      else if (m.includes('glm')) nimModel = 'z-ai/glm-4.7';
      
      // Smart Detection for DeepSeek versions
      else if (m.includes('deepseek-v3.2') || m.includes('v3.2')) nimModel = 'deepseek-ai/deepseek-v3.2';
      else if (m.includes('deepseek-v3.1') || m.includes('v3.1')) nimModel = 'deepseek-ai/deepseek-v3.1';
      else if (m.includes('deepseek')) nimModel = 'deepseek-ai/deepseek-v3.2'; // Default to newest
      
      else nimModel = model; // Use exact name if unknown
    }

    // 2. INJECT ULTIMATE PROMPT
    const processedMessages = [ULTIMATE_RP_PROMPT, ...messages];

    // 3. BUILD PAYLOAD
    const nimRequest = {
      model: nimModel,
      messages: processedMessages,
      temperature: temperature || DEFAULT_TEMPERATURE,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      frequency_penalty: DEFAULT_FREQUENCY_PENALTY,
      presence_penalty: DEFAULT_PRESENCE_PENALTY,
      stream: true // STREAMING REQUIRED TO PREVENT 504 TIMEOUTS
    };

    // 4. CALL NVIDIA API (With Timeout Protection)
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 120000 // 2 Minute Timeout
    });

    // 5. HANDLE STREAMING (Fixes 504 + Applies Formatting)
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
                // Apply basic formatting fixes on the fly during streaming
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
    
    // Handle specific timeout errors
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: { message: 'NVIDIA API Timeout (Model is thinking too hard)', type: 'timeout_error', code: 504 } });
    } else {
      res.status(error.response ? error.response.status : 500).json({
        error: { message: error.message, type: 'proxy_error', code: error.response ? error.response.status : 500 }
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Ultimate NVIDIA NIM RP Proxy running on port ${PORT}`);
  console.log(`Supported Models: GLM-5, GLM-4.7, DeepSeek V3.1, DeepSeek V3.2`);
});
