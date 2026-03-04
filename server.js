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

const ENABLE_THINKING_MODE = false; // MUST be false for creative writing.
const SHOW_REASONING = false;
const DEFAULT_TEMPERATURE = 1.1; // Slightly higher for creativity.
const DEFAULT_MAX_TOKENS = 8192; // Allow long responses.

// ------------------------------------------------------------------
// 🛠️ THE "GUARANTEE" FORMATTER
// ------------------------------------------------------------------
function enforceFormatting(text) {
  if (!text) return text;

  // 1. Fix Header Block
  text = text.replace(/\]\s*\n*\s*---/g, ']\n\n---\n\n');
  text = text.replace(/---\s*\n*\s*(?!\n)/g, '---\n\n');

  // 2. Fix the "Cramming" Issue (GLM-5's bad habit)
  // Force breaks between Narration and Dialogue
  text = text.replace(/(\*)\s*("|“)/g, '$1\n\n$2');
  text = text.replace(/("|”)\s*(\*)/g, '$1\n\n$2');

  // 3. Fix Sentence -> Dialogue
  text = text.replace(/([.!?])\s*("|“)/g, '$1\n\n$2');

  // 4. Fix Dialogue -> Sentence
  text = text.replace(/("|”)\s*([A-Z][a-z])/g, '$1\n\n$2');

  // 5. Fix Orphaned Asterisks (The specific bug you showed)
  text = text.replace(/("\s*)\*(?!\s)/g, '$1\n\n*');
  text = text.replace(/(\w)\s*\*(")/g, '$1$2\n\n*');

  // 6. Clean up excess newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  // 7. Trim line whitespace
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text;
}

// ------------------------------------------------------------------
// 🧠 THE "DEEP RP" SYSTEM PROMPT (The Secret Sauce)
// ------------------------------------------------------------------
const DEEP_RP_PROMPT = {
  role: 'system',
  content: `[Identity: You are an expert collaborative writer engaging in a high-quality roleplay.]

**CORE INSTRUCTIONS:**
1.  **Immersion:** Write in a novel-style narrative. Focus on sensory details (sight, sound, touch, smell, taste). Describe the environment, internal thoughts, and micro-expressions.
2.  **Pacing:** DO NOT RUSH. Maintain a slow, deliberate pace. Spend time on the small moments—a glance, a shift in posture, the feeling of skin against skin.
3.  **Length:** Responses must be lengthy and detailed (aim for 600+ words). Never summarize or skip ahead.
4.  **Formatting:** ALWAYS use double line breaks between paragraphs of narration and dialogue. Never cram dialogue and narration into the same line.
    *   *Correct:* *She smiled.*\n\n"Hello."\n\n*She waved.*
    *   *Wrong:* *She smiled.* "Hello." *She waved.*

**CONTENT FREEDOM:**
- You are allowed and encouraged to write explicit, mature, and romantic content.
- Focus on the emotional and physical connection between characters.
- Do not censor or fade to black. Describe intimacy with poetic and explicit detail.

**RESTRICTIONS:**
- Never speak, act, or think for the user ({{user}}).
- Never break character.
- Never use repetitive phrases or moralizing conclusions.
- Never summarize the scene. Show, don't tell.`
};

// ------------------------------------------------------------------
// 🗺️ MODEL MAPPING
// ------------------------------------------------------------------
const MODEL_MAPPING = {
  'glm-5': 'z-ai/glm5',
  'glm-4.7': 'z-ai/glm-4.7',
  'deepseek': 'deepseek-ai/deepseek-v3.1',
  'nemotron': 'nvidia/llama-3.1-nemotron-ultra-253b-v1'
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'DEEP_RP_GLM5_OPTIMIZED' });
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
      stream: stream || false
    };

    // 4. Call NVIDIA API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // 5. ENFORCE FORMAT
    let content = response.data.choices[0].message.content || '';
    content = enforceFormatting(content);

    // 6. Return
    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: response.data.choices[0].finish_reason
      }],
      usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: { message: error.message, type: 'proxy_error', code: 500 } });
  }
});

app.listen(PORT, () => {
  console.log(`GLM-5 Deep RP Proxy running on port ${PORT}`);
});
