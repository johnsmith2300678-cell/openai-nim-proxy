const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Global crash guards ──────────────────────────────────────────
// Prevents the entire Render process from dying on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Promise Rejection (server kept alive):', reason);
});
// ────────────────────────────────────────────────────────────────

// Middleware
app.use(cors());
app.use(express.json());

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// SETTINGS ---------------------------------------------------------
// Set to true to see the model's thought process in the reply
const SHOW_REASONING = false;

// Set to true to enable advanced thinking mode (recommended for GLM-5)
const ENABLE_THINKING_MODE = true;

// Set to true to enable automatic web research injection
const ENABLE_WEB_RESEARCH = true;

// How many search results to include in context (1-5 recommended)
const MAX_SEARCH_RESULTS = 3;
// ------------------------------------------------------------------

// Model mapping
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-4.7': 'z-ai/glm-4-9b-chat',
  'glm-5': 'z-ai/glm5'
};

// ================================================================
// WEB RESEARCH MODULE
// ================================================================

/**
 * Detect whether the user message likely needs real-world research.
 * Returns an object: { needsResearch: bool, type: string, query: string }
 */
function detectResearchIntent(messages) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return { needsResearch: false };

  const text = (typeof lastUserMsg.content === 'string'
    ? lastUserMsg.content
    : lastUserMsg.content.map(c => c.text || '').join(' ')
  ).toLowerCase();

  // Lyrics detection
  const lyricsPatterns = [
    /lyrics?\s+(?:of|for|from|to)\s+(.+)/i,
    /(?:full\s+)?lyrics?\s+(.+)/i,
    /what\s+(?:are|is)\s+the\s+lyrics?\s+(?:of|for|to)\s+(.+)/i,
    /(?:sing|quote|recite)\s+(.+)\s+lyrics?/i,
    /words?\s+(?:of|to|for)\s+the\s+song\s+(.+)/i
  ];
  for (const p of lyricsPatterns) {
    const m = text.match(p);
    if (m) return { needsResearch: true, type: 'lyrics', query: m[1].trim() };
  }

  // Album/discography detection
  const albumPatterns = [
    /(?:what's?\s+(?:on|in)|tracks?\s+(?:on|in)|songs?\s+(?:on|in)|tell\s+me\s+about)\s+(?:the\s+)?(?:album|ep|mixtape|record)\s+(.+)/i,
    /(.+)\s+album\s+(?:tracklist|songs?|tracks?)/i,
    /discography\s+(?:of|for)\s+(.+)/i,
    /(.+?)\s+discography/i
  ];
  for (const p of albumPatterns) {
    const m = text.match(p);
    if (m) return { needsResearch: true, type: 'album', query: m[1].trim() };
  }

  // Person/celebrity/artist detection
  const personPatterns = [
    /who\s+is\s+(.+?)(?:\?|$)/i,
    /tell\s+me\s+about\s+(.+?)(?:\?|$)/i,
    /(?:bio|biography|background)\s+(?:of|for|on)\s+(.+?)(?:\?|$)/i,
    /(?:about|regarding)\s+(?:the\s+)?(?:singer|rapper|artist|musician|actor|actress|celebrity|person)\s+(.+?)(?:\?|$)/i
  ];
  for (const p of personPatterns) {
    const m = text.match(p);
    if (m) return { needsResearch: true, type: 'person', query: m[1].trim() };
  }

  // General "what is / what are" research
  const generalPatterns = [
    /what\s+(?:is|are|was|were)\s+(.+?)(?:\?|$)/i,
    /(?:search|look\s+up|find|research|google)\s+(.+?)(?:\?|$)/i,
    /(?:information|info|facts?|details?)\s+(?:about|on|regarding)\s+(.+?)(?:\?|$)/i,
    /(?:latest|recent|new|current)\s+(?:news?|updates?|info|information)\s+(?:about|on)\s+(.+?)(?:\?|$)/i
  ];
  for (const p of generalPatterns) {
    const m = text.match(p);
    if (m) return { needsResearch: true, type: 'general', query: m[1].trim() };
  }

  // Song-specific detection (even without explicit "lyrics")
  const songPatterns = [
    /(?:the\s+song|track)\s+["']?(.+?)["']?\s+by\s+(.+?)(?:\?|$)/i,
    /["'](.+?)["']\s+by\s+(.+?)\s+(?:song|track|single)/i
  ];
  for (const p of songPatterns) {
    const m = text.match(p);
    if (m) return { needsResearch: true, type: 'song', query: `${m[1].trim()} ${m[2].trim()}` };
  }

  return { needsResearch: false };
}

/**
 * Try to fetch lyrics using lyrics.ovh (free, no API key needed).
 * Input: a raw query string like "Blinding Lights The Weeknd"
 */
async function fetchLyrics(query) {
  try {
    let artist = '', title = '';

    const byMatch = query.match(/(.+?)\s+by\s+(.+)/i);
    if (byMatch) {
      title = byMatch[1].trim();
      artist = byMatch[2].trim();
    } else {
      const parts = query.split(' ');
      title = parts.slice(0, Math.ceil(parts.length / 2)).join(' ');
      artist = parts.slice(Math.ceil(parts.length / 2)).join(' ');
    }

    if (!artist || !title) return null;

    const encodedArtist = encodeURIComponent(artist);
    const encodedTitle = encodeURIComponent(title);

    const response = await axios.get(
      `https://api.lyrics.ovh/v1/${encodedArtist}/${encodedTitle}`,
      { timeout: 5000 }
    );

    if (response.data && response.data.lyrics) {
      return {
        source: 'lyrics.ovh',
        title,
        artist,
        lyrics: response.data.lyrics.trim().substring(0, 3000)
      };
    }
  } catch (e) {
    // Silently fall through to general search
  }
  return null;
}

/**
 * Search DuckDuckGo Instant Answer API (free, no key required).
 */
async function searchDuckDuckGo(query) {
  try {
    const encoded = encodeURIComponent(query);
    const response = await axios.get(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
      { timeout: 6000 }
    );

    const data = response.data;
    const results = [];

    if (data.Abstract && data.Abstract.length > 10) {
      results.push({
        title: data.Heading || query,
        snippet: data.Abstract,
        source: data.AbstractSource || 'DuckDuckGo'
      });
    }

    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, MAX_SEARCH_RESULTS - results.length)) {
        if (topic.Text && topic.Text.length > 10) {
          results.push({
            title: topic.FirstURL ? topic.FirstURL.split('/').pop().replace(/_/g, ' ') : query,
            snippet: topic.Text,
            source: 'DuckDuckGo'
          });
        }
      }
    }

    if (data.Answer && results.length === 0) {
      results.push({
        title: query,
        snippet: data.Answer,
        source: 'DuckDuckGo Instant Answer'
      });
    }

    return results.length > 0 ? results : null;
  } catch (e) {
    console.error('[Research] DuckDuckGo search failed:', e.message);
    return null;
  }
}

/**
 * Search iTunes/Apple Music API for song/album/artist info (free, no key).
 */
async function searchItunes(query, type = 'all') {
  try {
    const encoded = encodeURIComponent(query);
    const response = await axios.get(
      `https://itunes.apple.com/search?term=${encoded}&entity=${type}&limit=3`,
      { timeout: 5000 }
    );

    if (response.data && response.data.results && response.data.results.length > 0) {
      return response.data.results.map(r => ({
        title: r.trackName || r.collectionName || r.artistName || '',
        artist: r.artistName || '',
        album: r.collectionName || '',
        releaseDate: r.releaseDate ? r.releaseDate.split('T')[0] : '',
        genre: r.primaryGenreName || '',
        snippet: [
          r.trackName && `Song: ${r.trackName}`,
          r.artistName && `Artist: ${r.artistName}`,
          r.collectionName && `Album: ${r.collectionName}`,
          r.releaseDate && `Released: ${r.releaseDate.split('T')[0]}`,
          r.primaryGenreName && `Genre: ${r.primaryGenreName}`,
          r.trackCount && `Tracks: ${r.trackCount}`
        ].filter(Boolean).join(' | '),
        source: 'iTunes/Apple Music'
      }));
    }
  } catch (e) {
    // Silently fail
  }
  return null;
}

/**
 * Master research function — picks the right strategy based on intent type.
 */
async function conductResearch(intent) {
  const { type, query } = intent;
  const researchData = { type, query, results: [] };

  try {
    if (type === 'lyrics') {
      const lyricsResult = await fetchLyrics(query);
      if (lyricsResult) {
        researchData.results.push({
          title: `Lyrics: "${lyricsResult.title}" by ${lyricsResult.artist}`,
          content: lyricsResult.lyrics,
          source: lyricsResult.source
        });
      }

      const itunesResults = await searchItunes(query, 'musicTrack');
      if (itunesResults) {
        researchData.results.push(...itunesResults.slice(0, 1).map(r => ({
          title: `Song Info: ${r.title} by ${r.artist}`,
          content: r.snippet,
          source: r.source
        })));
      }

      if (researchData.results.length === 0) {
        const ddgResults = await searchDuckDuckGo(`${query} lyrics`);
        if (ddgResults) {
          researchData.results.push(...ddgResults.map(r => ({
            title: r.title,
            content: r.snippet,
            source: r.source
          })));
        }
      }
    }

    else if (type === 'album') {
      const itunesResults = await searchItunes(query, 'album');
      if (itunesResults) {
        researchData.results.push(...itunesResults.map(r => ({
          title: `Album: ${r.album} by ${r.artist}`,
          content: r.snippet,
          source: r.source
        })));
      }

      const ddgResults = await searchDuckDuckGo(`${query} album`);
      if (ddgResults) {
        researchData.results.push(...ddgResults.slice(0, 2).map(r => ({
          title: r.title,
          content: r.snippet,
          source: r.source
        })));
      }
    }

    else if (type === 'person') {
      const ddgResults = await searchDuckDuckGo(query);
      if (ddgResults) {
        researchData.results.push(...ddgResults.map(r => ({
          title: r.title,
          content: r.snippet,
          source: r.source
        })));
      }

      const itunesResults = await searchItunes(query, 'musicArtist');
      if (itunesResults) {
        researchData.results.push(...itunesResults.slice(0, 1).map(r => ({
          title: `Music Info: ${r.artist}`,
          content: r.snippet,
          source: r.source
        })));
      }
    }

    else if (type === 'song') {
      const itunesResults = await searchItunes(query, 'musicTrack');
      if (itunesResults) {
        researchData.results.push(...itunesResults.map(r => ({
          title: `Song: ${r.title} by ${r.artist}`,
          content: r.snippet,
          source: r.source
        })));
      }

      const ddgResults = await searchDuckDuckGo(query);
      if (ddgResults) {
        researchData.results.push(...ddgResults.slice(0, 2).map(r => ({
          title: r.title,
          content: r.snippet,
          source: r.source
        })));
      }
    }

    else {
      const ddgResults = await searchDuckDuckGo(query);
      if (ddgResults) {
        researchData.results.push(...ddgResults.map(r => ({
          title: r.title,
          content: r.snippet,
          source: r.source
        })));
      }
    }
  } catch (e) {
    console.error('[Research] Error during research:', e.message);
  }

  return researchData;
}

/**
 * Build the research context string to inject into the system prompt.
 */
function buildResearchContext(researchData) {
  if (!researchData || researchData.results.length === 0) return null;

  const lines = [
    `[REAL-TIME RESEARCH DATA]`,
    `The following information was retrieved from the internet for the user's query about "${researchData.query}".`,
    `Use this data naturally in your response — treat it as knowledge you actually have.`,
    `Do NOT say "according to my research" or mention searching. Just use the information.`,
    ``,
  ];

  researchData.results.forEach((result, i) => {
    lines.push(`--- Source ${i + 1}: ${result.title} (${result.source}) ---`);
    lines.push(result.content);
    lines.push('');
  });

  lines.push(`[END RESEARCH DATA]`);
  return lines.join('\n');
}

/**
 * Inject research context into messages without overwriting existing system prompts
 * (which often contain character definitions in JanitorAI).
 */
function injectResearchIntoMessages(messages, researchContext) {
  if (!researchContext) return messages;

  const modified = [...messages];
  const sysIndex = modified.findIndex(m => m.role === 'system');

  if (sysIndex !== -1) {
    const existing = typeof modified[sysIndex].content === 'string'
      ? modified[sysIndex].content
      : modified[sysIndex].content.map(c => c.text || '').join('\n');

    modified[sysIndex] = {
      ...modified[sysIndex],
      content: `${existing}\n\n${researchContext}`
    };
  } else {
    modified.unshift({
      role: 'system',
      content: researchContext
    });
  }

  return modified;
}

// ================================================================
// END WEB RESEARCH MODULE
// ================================================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE,
    web_research: ENABLE_WEB_RESEARCH
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
    let { model, messages, temperature, max_tokens, stream } = req.body;

    // ── WEB RESEARCH INJECTION ──────────────────────────────────
    if (ENABLE_WEB_RESEARCH) {
      try {
        const intent = detectResearchIntent(messages);
        if (intent.needsResearch) {
          console.log(`[Research] Detected intent: ${intent.type} | Query: "${intent.query}"`);
          const researchData = await conductResearch(intent);
          if (researchData.results.length > 0) {
            const researchContext = buildResearchContext(researchData);
            messages = injectResearchIntoMessages(messages, researchContext);
            console.log(`[Research] Injected ${researchData.results.length} result(s) into context.`);
          } else {
            console.log('[Research] No results found.');
          }
        }
      } catch (researchError) {
        // Research failure should NEVER break the main request
        console.error('[Research] Non-fatal error:', researchError.message);
      }
    }
    // ────────────────────────────────────────────────────────────

    // Smart model selection
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

    // Build the request payload
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      stream: stream || false
    };

    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }

    // Make request to NVIDIA NIM API (with timeout + retry on 502/504/503/429)
    let response;
    const nimRequestOptions = {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json',
      timeout: 120000 // 2 min hard cap — prevents Render from hanging forever
    };

    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, nimRequestOptions);
        break; // success — exit retry loop
      } catch (nimErr) {
        const status = nimErr.response ? nimErr.response.status : null;
        const retryable = !status || status === 502 || status === 503 || status === 504 || status === 429;
        if (retryable && attempt < MAX_RETRIES) {
          const wait = attempt * 1500; // 1.5s then 3s
          console.warn(`[NIM] Attempt ${attempt} failed (${status || nimErr.code}). Retrying in ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw nimErr; // non-retryable or out of retries — goes to main catch
        }
      }
    }

    if (stream) {
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
        console.error('[Stream] Stream error mid-response:', err.message);
        // Headers already sent — we can't change status code,
        // but we can send a final SSE error event so the client knows what happened
        try {
          const errPayload = JSON.stringify({
            error: { message: 'Stream interrupted: ' + err.message, type: 'stream_error' }
          });
          res.write(`data: ${errPayload}\n\n`);
          res.write('data: [DONE]\n\n');
        } catch (_) { /* ignore if socket already closed */ }
        res.end();
      });

    } else {
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
  console.log(`Web research: ${ENABLE_WEB_RESEARCH ? 'ENABLED' : 'DISABLED'}`);
});
