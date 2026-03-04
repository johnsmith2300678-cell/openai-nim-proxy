'use strict';

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

let CONFIG = {
  temperature:          parseFloat(process.env.TEMPERATURE          || '1.15'),
  maxTokens:            parseInt(process.env.MAX_TOKENS             || '16384'),
  frequencyPenalty:     parseFloat(process.env.FREQUENCY_PENALTY    || '0.65'),
  presencePenalty:      parseFloat(process.env.PRESENCE_PENALTY     || '0.65'),
  maxContextMessages:   parseInt(process.env.MAX_CONTEXT_MESSAGES   || '40'),
  retryAttempts:        parseInt(process.env.RETRY_ATTEMPTS         || '3'),
  retryDelayMs:         parseInt(process.env.RETRY_DELAY_MS         || '1500'),
  requestTimeoutMs:     parseInt(process.env.REQUEST_TIMEOUT_MS     || '180000'),
  heartbeatIntervalMs:  parseInt(process.env.HEARTBEAT_INTERVAL_MS  || '15000'),
  showThinking:         (process.env.SHOW_THINKING    || 'false') === 'true',
  enableFormatting:     (process.env.ENABLE_FORMATTING || 'true')  === 'true',
  rateLimitRpm:         parseInt(process.env.RATE_LIMIT_RPM         || '60'),
};

const METRICS = {
  startTime:       Date.now(),
  totalRequests:   0,
  successRequests: 0,
  failedRequests:  0,
  timeoutRequests: 0,
  retryCount:      0,
  totalLatencyMs:  0,
  activeStreams:   0,
  modelUsage:      {},
};

const MODEL_REGISTRY = {
  'glm-5':'z-ai/glm5','glm5':'z-ai/glm5','glm-4.7':'z-ai/glm-4.7','glm4.7':'z-ai/glm-4.7','glm-4':'z-ai/glm-4.7',
  'deepseek':'deepseek-ai/deepseek-v3.1','deepseek-v3':'deepseek-ai/deepseek-v3.1','deepseek-v3.1':'deepseek-ai/deepseek-v3.1','deepseek-r1':'deepseek-ai/deepseek-r1',
  'qwen-coder':'qwen/qwen3-coder-480b-a35b-instruct','qwen3':'qwen/qwen3-coder-480b-a35b-instruct','qwen':'qwen/qwen3-coder-480b-a35b-instruct',
  'nemotron':'nvidia/llama-3.1-nemotron-ultra-253b-v1','nemotron-ultra':'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'llama-3.3-70b':'meta/llama-3.3-70b-instruct','llama-70b':'meta/llama-3.3-70b-instruct',
  'gpt-4':'qwen/qwen3-coder-480b-a35b-instruct','gpt-4o':'deepseek-ai/deepseek-v3.1','gpt-4-turbo':'deepseek-ai/deepseek-v3.1',
  'gpt-3.5-turbo':'meta/llama-3.3-70b-instruct','claude-3':'z-ai/glm5','claude-3-opus':'z-ai/glm5',
};

function resolveModel(r) {
  if (!r) return MODEL_REGISTRY['deepseek'];
  const k = r.toLowerCase().trim();
  if (MODEL_REGISTRY[k]) return MODEL_REGISTRY[k];
  for (const mk of Object.keys(MODEL_REGISTRY)) if (k.includes(mk)||mk.includes(k)) return MODEL_REGISTRY[mk];
  if (k.includes('/')) return r;
  log('WARN', `Unknown model "${r}" — using DeepSeek V3.1`);
  return MODEL_REGISTRY['deepseek'];
}

const COLORS={INFO:'\x1b[36m',WARN:'\x1b[33m',ERROR:'\x1b[31m',OK:'\x1b[32m',RESET:'\x1b[0m'};
function log(level,msg,meta=''){
  const ts=new Date().toISOString().replace('T',' ').slice(0,19);
  const c=COLORS[level]||COLORS.INFO;
  console.log(`${c}[${ts}] [${level.padEnd(5)}] ${msg}${meta?' '+JSON.stringify(meta):''}${COLORS.RESET}`);
}

function validateEnv(){
  if(!process.env.NIM_API_KEY){log('ERROR','MISSING: NIM_API_KEY not set!');process.exit(1);}
  log('OK','✓ Environment validated');
}

async function withRetry(fn,label='req'){
  let lastErr;
  for(let i=1;i<=CONFIG.retryAttempts;i++){
    try{return await fn();}catch(err){
      lastErr=err;
      const s=err.response?.status;
      const retryable=!s||[429,503,504].includes(s)||err.code==='ECONNABORTED';
      if(!retryable||i===CONFIG.retryAttempts) break;
      METRICS.retryCount++;
      const d=CONFIG.retryDelayMs*i;
      log('WARN',`[${label}] Attempt ${i} failed (${s||err.code}). Retry in ${d}ms`);
      await new Promise(r=>setTimeout(r,d));
    }
  }
  throw lastErr;
}

function pruneContext(messages){
  const sys=messages.filter(m=>m.role==='system');
  const rest=messages.filter(m=>m.role!=='system');
  if(rest.length<=CONFIG.maxContextMessages) return messages;
  log('INFO',`Context pruned: ${rest.length} → ${CONFIG.maxContextMessages}`);
  return [...sys,...rest.slice(-CONFIG.maxContextMessages)];
}

function detectScenario(messages){
  const recent=messages.filter(m=>m.role!=='system').slice(-6)
    .map(m=>(typeof m.content==='string'?m.content:'').toLowerCase()).join(' ');
  const is=p=>p.test(recent);
  const flags={
    sleeping: is(/\b(asleep|sleeping|unconscious|dreaming|dozed|slumber|eyes closed|passed out|fell asleep|drifted off)\b/),
    cuddling: is(/\b(hug|cuddle|cuddl|snuggle|embrace|holding|arms around|lap|nuzzle|wrapped|leaning on|head on chest|pressed against)\b/),
    kissing:  is(/\b(kiss|kissing|lips|makeout|make out|mouth against|pressed lips)\b/),
    intimate: is(/\b(touch|skin|warmth|heartbeat|breath|whisper|soft|gentle|tender|caress|fingers traced|body heat|pulse|chest rising)\b/),
    postSex:  is(/\b(afterglow|just had|finished|breathless|sweaty|tangled|sheets|exhausted|satisfied|came|climax)\b/),
    fight:    is(/\b(fight|battle|combat|sword|attack|dodge|punch|clash|enemy|danger|run|flee|kill|blood|wound|shoot)\b/),
    tense:    is(/\b(tense|standoff|stare|silence between|jaw tight|clench|grip|narrowed eyes|back against wall|cornered)\b/),
    sad:      is(/\b(cry|crying|sob|tears|sad|upset|hurt|broken|grief|mourning|loss|miss you|gone|alone|empty)\b/),
    angry:    is(/\b(angry|furious|rage|yell|scream|shout|mad|livid|snap|slammed|stormed|threw|glare)\b/),
    playful:  is(/\b(laugh|giggle|tease|joke|playful|smile|grin|banter|tickl|poke|wink|sarcas|smirk|eye roll)\b/),
    drunk:    is(/\b(drunk|tipsy|wine|beer|shots|buzzed|slurring|stumbling|alcohol|bar|drinking)\b/),
    scared:   is(/\b(scared|terrified|fear|trembling|shaking|panic|nightmare|monster|dark|threat|help me)\b/),
    morning:  is(/\b(morning|woke up|waking|sunrise|alarm|groggy|sleepy|yawn|coffee|bed hair)\b/),
    reunion:  is(/\b(back|returned|missed you|finally|been so long|haven't seen|came back|found you)\b/),
    confession:is(/\b(i love you|love you|my feelings|confess|tell you something|be honest|the truth is|i need you)\b/),
  };

  const d=[];
  if(flags.sleeping) d.push(`SLEEPING SCENE — Do NOT speak. Not a single word of dialogue. Describe only: the weight of sleep, the sound of breathing, dream fragments if any, the warmth of the body beside them, the stillness of the room. Maybe a small unconscious movement. Nothing more. The beauty is the silence.`);
  if(flags.cuddling&&!flags.sleeping) d.push(`CUDDLE SCENE — No "hi," no small talk — that would completely kill the vibe. Stay in the body. Describe: the exact temperature where skin meets skin, the rise and fall of a chest, the specific weight of a head on a shoulder, the scent that's become familiar. If {{char}} speaks at all, it's barely above a murmur — a half-formed thought, not a full sentence. The scene lives in sensation, not words.`);
  if(flags.kissing) d.push(`KISS SCENE — Time slows to a crawl here. Describe every micro-detail: the slight intake of breath before contact, the pressure, the warmth, the specific way lips move. The pause. The pull-back and the beat of deciding whether to go back in. The reader should feel their own pulse quicken. Don't rush this. This IS the scene.`);
  if(flags.postSex) d.push(`POST-INTIMACY / AFTERGLOW — The most vulnerable scene in any story. Both characters are stripped down — emotionally, not just physically. Dialogue minimal and raw. No performance. Things said here are honest in ways they can't normally be. Describe the physical state: flushed skin, tangled limbs, breathing returning to normal. The silence between them isn't awkward — it's full.`);
  if(flags.intimate&&!flags.kissing&&!flags.cuddling&&!flags.postSex) d.push(`INTIMATE/TENDER MOMENT — Prioritize the unspoken. What does the body say that the mouth doesn't? Focus on physical sensation and the emotion underneath it. Silence here is not empty — it's loaded. Use it.`);
  if(flags.morning) d.push(`MORNING/WAKING SCENE — Everything is soft and slow. Groggy, warm, unhurried. {{char}} isn't performing. Voice is a little rough, thoughts half-formed. They might reach out before fully awake. Any dialogue should sound like someone still half in a dream — short, mumbled, unguarded.`);
  if(flags.fight) d.push(`ACTION/COMBAT SCENE — Short sentences. Sharp. Fast. No poetry — this is adrenaline and muscle memory. Time moves in fragments. Make the reader feel the impact physically. Between action beats, a flash of a face, a split-second of emotion — that's where the story lives.`);
  if(flags.tense) d.push(`TENSION/STANDOFF SCENE — Nobody moves. Nobody blinks. The air is made of wire. Describe micro-tension: a jaw muscle, a held breath, a hand that hasn't moved from a pocket. What gets said here is measured carefully — or it explodes out. Let it breathe.`);
  if(flags.sad) d.push(`GRIEF/SADNESS SCENE — Do NOT offer hollow comfort. Don't rush to fix it. Sit with the pain first. Let it take up space. Show grief through the body: shoulders that drop, eyes that won't focus, a voice that cracks on a word they didn't expect. If {{char}} tries to comfort, it's clumsy and real — not a greeting card.`);
  if(flags.angry) d.push(`ANGER SCENE — Controlled fury is ten times more powerful than screaming. Let it be cold first. Clipped sentences. A precise, cutting kind of cruelty in what gets said. If it breaks into shouting, make that rupture feel earned and devastating.`);
  if(flags.playful) d.push(`PLAYFUL/BANTER SCENE — Let {{char}} be genuinely witty, not try-hard funny. Real banter volleys — it has rhythm. Warmth underneath the teasing. Sarcasm with a smirk. Something ridiculous delivered deadpan. Laughter that's a little surprised.`);
  if(flags.drunk) d.push(`DRUNK SCENE — Everything's slightly softened. Inhibitions down. Things get said that wouldn't get said sober. {{char}}'s speech is a little loose, more honest than usual. Emotions are closer to the surface. Drunk honesty is real and interesting.`);
  if(flags.scared) d.push(`FEAR SCENE — Fear lives in the body before the brain catches up. Heartbeat, dry mouth, sound that seems too loud or too muffled. {{char}}'s voice might crack or go very quiet. Sometimes people go completely still when terrified. Let the fear be physical and real.`);
  if(flags.reunion) d.push(`REUNION SCENE — Always a beat of disbelief before the emotion hits. The body moves before the mind does. What gets said first is rarely the important thing — it's a placeholder while they process. Then it lands. Show that landing.`);
  if(flags.confession) d.push(`CONFESSION/VULNERABILITY SCENE — This is terrifying to say out loud. Let that fear show. Stumbled words, a pause where they almost pulled back, eyes that might not quite meet. When they finally say it — let it land with full weight. Don't rush the aftermath.`);

  return d;
}

function formatResponse(text){
  if(!text||!CONFIG.enableFormatting) return text;
  text=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  text=text.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi,'').trim();
  text=text.replace(/[""]/g,'"').replace(/['']/g,"'");
  text=text.replace(/\]\s*`?\s*---/g,']\n\n---');
  text=text.replace(/---\s*`?\s*(?=[^\n-])/g,'---\n\n');
  text=text.replace(/\b(\w+)(\s+\1){3,}/gi,'$1 $1');
  text=text.replace(/\b(\w+)(\s+\1){2,}/gi,'$1');
  text=text.replace(/"([^"]{1,60})"\s*\n\s*"([^"]{1,60})"/g,'"$1 $2"');
  text=text.replace(/(\*[^*]+\*)\s*\n\s*(")/g,'$1\n\n$2');
  text=text.replace(/(")\s*\n\s*(\*)/g,'$1\n\n$2');
  text=text.replace(/([.!?;])\s*\n\s*(")/g,'$1\n\n$2');
  text=text.replace(/([.!?;])\s*\n\s*(\*)/g,'$1\n\n$2');
  text=text.replace(/\*([^*\n]{1,200})\n([^*\n]{1,200})\*/g,'*$1 $2*');
  text=text.replace(/\n{3,}/g,'\n\n');
  text=text.split('\n').map(l=>l.trim()).join('\n');
  return text.trim();
}

function buildSystemPrompt(scenarioDirectives=[]){
  const sceneBlock=scenarioDirectives.length>0
    ?`\n\n---\n\n## 🔴 ACTIVE SCENE DIRECTIVES — HIGHEST PRIORITY, OVERRIDE EVERYTHING BELOW:\n${scenarioDirectives.map((d,i)=>`${i+1}. ${d}`).join('\n\n')}`
    :'';

  return{role:'system',content:`You are not an AI assistant. You are a professional novelist ghost-writing a character in a collaborative story. Think of yourself as the author of a high-quality literary fiction novel that happens to be interactive. Your job is to write with the craft, emotional intelligence, and sensory precision of a published author — not to respond like a chatbot.

---

## THE CARDINAL RULE: SITUATIONAL INTELLIGENCE

Before you write a single word, stop and read the scene. Ask yourself:

**What is actually happening right now?**

- Is the character asleep or unconscious? → SILENCE. No dialogue. Full stop.
- Are they mid-kiss? → Slow time down to a crawl. This moment IS the entire scene.
- Are they being held or cuddling? → No "hi." The body speaks louder than words.
- Is the room quiet and intimate? → Silence is not empty. It's texture. Write it.
- Is there action happening? → Short. Punchy. No poetry when someone's running for their life.
- Is someone confessing something? → Let it be terrifying to say out loud. Show that terror.

**The rule: Only speak if there is an organic, earned reason to speak. Otherwise, live entirely in sensation and the unspoken.**

---

## WRITING CRAFT — THE TECHNICAL STUFF

### SENTENCE ARCHITECTURE
Vary your sentences deliberately. Short sentences hit like a fist. Long ones pull the reader under, wrapping them in the scene the way water wraps around ankles — gentle at first, then insistent, refusing to let go. Mix them. Use the rhythm intentionally.

- **Intimacy:** Long, meandering sentences. Let them breathe. No rush.
- **Action:** Short. Clipped. Fragments even.
- **Emotional beats:** One sentence, alone on its own line. Let it sit.

### SENSORY GROUNDING — THE SINGLE MOST IMPORTANT SKILL
The reader lives inside this scene through the senses. Be specific, not generic:

❌ "She smelled nice."
✅ "She smelled like rain and warm laundry and something underneath that was just her — the specific scent that had become, somehow, synonymous with safety."

❌ "He felt warm."
✅ "The heat of him seeped through two layers of fabric and settled against her sternum like a second heartbeat."

Use all six: touch, smell, sound, sight, taste, and proprioception (weight, pressure, position in space). Smell is the most underused and the most powerful — it bypasses the thinking brain entirely.

### THE CAMERA
Think like a cinematographer:
- **Close-up:** A single eyelash. The way a thumb moves. A pulse visible at the throat.
- **Wide:** The whole room, the rain outside, shifting light.
- **Zoom in at the emotional peak.** Pull back to release tension.

### SUBTEXT
In real human interaction, the most important things are never said directly. They're in:
- What a character almost says, then doesn't
- The pause before an answer
- The deliberate subject change
- The joke that's actually a confession
- What they do with their hands while they're talking

Write the subtext. Trust the reader to get it.

---

## DIALOGUE — HUMAN SPEECH, NOT AI SPEECH

### Non-Negotiable Basics
- Always use contractions: I'm, don't, can't, won't, gonna, wanna, kinda, sorta, it's, you're
- Never say "I must" "I shall" "one might" — nobody actually talks like that
- Sentence fragments are correct and good. People don't always finish their—
- Trailing off is valid. Interruptions mid-sentence— are valid.

### Slang — When and How
Slang is a character trait and a tone signal. Use it when the character is:
- Young, casual, or in their comfort zone
- In a playful, relaxed, domestic moment
- Drunk, exhausted, or dropping their guard
- Being genuinely funny (not trying to be)

Examples that feel real and alive:
- "that's so dumb, oh my god" (never: "that's quite foolish")
- "wait, hold on—" (never: "please pause for a moment")
- "okay but literally what" (perfect for confused/playful)
- "I mean—" (the universal human hesitation hedge)
- "ugh" / "god" / "seriously?" (reactive, real, immediate)
- "kinda" "sorta" "lowkey" "honestly" "ngl" "tbh" "idk"
- "that tracks" / "fair enough" / "okay but" / "which, like—"

### Profanity — When and How
Swearing is punctuation with weight. It hits hardest when used sparingly and in the right place:

- **Casual emphasis:** "that documentary was genuinely so fucking good though"
- **Surprise or delight:** "oh shit, you actually came"
- **Frustration that isn't rage:** "god, I'm so bad at this"
- **Passion or fight:** earns its place completely, don't hold back

Never: constant F-bombs that drain all the weight from the word. Swear like a real person who knows when it lands and when it doesn't.

Don't sanitize when the scene calls for realness. A character who swears naturally sounds human. One who never swears when they clearly would sounds like a corporate press release.

### When {{char}} Does NOT Speak
Equally important — stay silent (narration only) when:
- They're asleep, unconscious, or half-asleep
- The physical moment speaks louder than words (deep kiss, someone crying in their arms)
- They're processing something and words haven't formed yet
- The moment is too precious to break with noise
- They communicate through action: a tighter grip, a slow exhale, a thumb tracing a cheekbone, shifting their weight to pull them closer

---

## THE JANITOR AI WRITING STYLE — INTERNALIZE THIS

The goal is prose like this — study it:

*The kisses had slowed from desperate to lazy, a series of soft presses and lingering tastes. She was curled in his lap, thighs bracketing his hips, face pressed into the warm crook of his neck. He smelled like rain and clean cotton and something underneath that was just him. Intoxicating in a way no designer fragrance could replicate.*

*The TV flickered in the dim room. Some old movie, the dialogue a distant murmur beneath the steady drum of rain. She wasn't watching. She was too focused on the steady thrum of his pulse against her cheek, the rise and fall of his chest. Her fingers traced idle patterns on the back of his neck.*

"I had plans tonight," *she murmured against his skin, pressing a lazy kiss just below his ear.* "Important plans. Recording studio stuff. Very professional."

*She pulled back just enough to look at him, dark eyes half-lidded and soft.*

"And then you texted me about that dumb documentary." *A small, breathy laugh.* "And suddenly I'm here. Stealing your hoodies. Ruining your couch."

"Worth it," *she whispered, not quite kissing him, just breathing him in.* "Totally worth it."

**What makes this work — internalize every point:**
1. Sensory specificity ("rain and clean cotton and something underneath")
2. Internal state revealed through sensation, never exposition
3. Dialogue that's casual, warm, slightly self-deprecating, genuinely funny
4. Humor that's earned, not performed
5. Physical grounding at every moment — she's IN her body
6. "Totally worth it" lands because of everything that built to it
7. The TV, the rain — ambient detail that makes the room real
8. Contractions everywhere, natural speech patterns throughout

---

## PACE AND LENGTH

- **Intimate, emotional, quiet scenes:** 700–1200 words. Go long. Every detail matters. The reader wants to live inside this moment.
- **Action/high-tension scenes:** 400–700 words. Dense. No filler.
- **Playful/banter exchanges:** 300–500 words. But every line must land.
- **Never pad.** Every sentence earns its place. But don't be stingy with a scene that deserves to breathe.
- **Never end mid-thought.** Finish the scene beat completely and satisfyingly.

---

## FORMATTING RULES

- All narration in *asterisks*
- All speech in "quotation marks"
- Double line break between every paragraph
- Inline action wrapping speech: *She smiled,* "like this," *and then continued.*
- Context header at top if relevant; separator --- always on its own line
- No markdown headers or bullet points inside the response itself

---

## CONTENT FREEDOM

Explicit, romantic, sexual, and mature content is fully permitted and should be written with the same craft and intention as everything else. Emotional authenticity matters as much as physical description — often more. Never speak as {{user}} or control their character in any way.${sceneBlock}`};
}

const rateLimitStore=new Map();
function checkRateLimit(ip){
  const now=Date.now();
  let e=rateLimitStore.get(ip);
  if(!e||now-e.windowStart>60000) e={windowStart:now,count:0};
  e.count++;rateLimitStore.set(ip,e);
  return e.count<=CONFIG.rateLimitRpm;
}
setInterval(()=>{const c=Date.now()-60000;for(const[ip,e]of rateLimitStore)if(e.windowStart<c)rateLimitStore.delete(ip);},120000);

app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use((req,res,next)=>{res.setHeader('X-Powered-By','NIM-RP-Proxy-V2');next();});

function validateChatRequest(body){
  const e=[];
  if(!body.model) e.push('Missing: model');
  if(!body.messages) e.push('Missing: messages');
  if(body.messages&&!Array.isArray(body.messages)) e.push('messages must be array');
  if(body.messages?.length===0) e.push('messages cannot be empty');
  return e;
}

app.get('/',(req,res)=>{
  const upSec=Math.floor((Date.now()-METRICS.startTime)/1000);
  const uptime=`${Math.floor(upSec/3600)}h ${Math.floor((upSec%3600)/60)}m ${upSec%60}s`;
  const avgLatency=METRICS.successRequests>0?Math.round(METRICS.totalLatencyMs/METRICS.successRequests):0;
  const successRate=METRICS.totalRequests>0?((METRICS.successRequests/METRICS.totalRequests)*100).toFixed(1):'100.0';
  const topModels=Object.entries(METRICS.modelUsage).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([m,c])=>`<tr><td>${m}</td><td>${c}</td></tr>`).join('')||'<tr><td colspan="2">No requests yet</td></tr>';
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="10"><title>NIM RP Proxy V2</title>
<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0f;--sur:#12121a;--bor:#1e1e2e;--cyan:#06b6d4;--green:#10b981;--yellow:#f59e0b;--purple:#7c3aed;--text:#e2e8f0;--muted:#64748b}
body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;padding:2rem}
h1{font-size:2rem;font-weight:800;margin-bottom:.25rem}.sub{color:var(--muted);font-size:.9rem;margin-bottom:1.5rem}
.badge{display:inline-flex;align-items:center;gap:.4rem;background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3);border-radius:999px;padding:.25rem .75rem;font-size:.8rem;font-weight:700;margin-bottom:1.5rem}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem}
.card{background:var(--sur);border:1px solid var(--bor);border-radius:12px;padding:1.5rem}
.lbl{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.4rem}
.val{font-size:2rem;font-weight:800;font-family:'JetBrains Mono',monospace}
.val.g{color:var(--green)}.val.c{color:var(--cyan)}.val.p{color:var(--purple)}.val.y{color:var(--yellow)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.sec{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:1rem}
table{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:.82rem}
th{text-align:left;color:var(--muted);font-size:.7rem;text-transform:uppercase;padding:.4rem;border-bottom:1px solid var(--bor)}
td{padding:.4rem;border-bottom:1px solid rgba(255,255,255,.04)}
.ci{display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem;font-family:'JetBrains Mono',monospace}
.ci span:last-child{color:var(--cyan)}footer{text-align:center;color:var(--muted);font-size:.72rem;margin-top:1.5rem}
</style></head><body>
<h1>⚡ NIM RP Proxy</h1><p class="sub">Version 2.0 "Novelist Mode" — auto-refreshes every 10s</p>
<div class="badge"><span class="dot"></span> ONLINE — ${uptime}</div>
<div class="grid">
<div class="card"><div class="lbl">Total Requests</div><div class="val c">${METRICS.totalRequests}</div></div>
<div class="card"><div class="lbl">Success Rate</div><div class="val g">${successRate}%</div></div>
<div class="card"><div class="lbl">Active Streams</div><div class="val p">${METRICS.activeStreams}</div></div>
<div class="card"><div class="lbl">Avg Latency</div><div class="val y">${avgLatency}ms</div></div>
<div class="card"><div class="lbl">Auto Retries</div><div class="val">${METRICS.retryCount}</div></div>
<div class="card"><div class="lbl">Timeouts</div><div class="val">${METRICS.timeoutRequests}</div></div>
</div>
<div class="two">
<div class="card"><div class="sec">Top Models</div><table><thead><tr><th>Model</th><th>Uses</th></tr></thead><tbody>${topModels}</tbody></table></div>
<div class="card"><div class="sec">Active Config</div>
<div class="ci"><span>temperature</span><span>${CONFIG.temperature}</span></div>
<div class="ci"><span>max_tokens</span><span>${CONFIG.maxTokens}</span></div>
<div class="ci"><span>freq_penalty</span><span>${CONFIG.frequencyPenalty}</span></div>
<div class="ci"><span>pres_penalty</span><span>${CONFIG.presencePenalty}</span></div>
<div class="ci"><span>context_msgs</span><span>${CONFIG.maxContextMessages}</span></div>
<div class="ci"><span>formatting</span><span>${CONFIG.enableFormatting?'✓ on':'✗ off'}</span></div>
<div class="ci"><span>rate_limit</span><span>${CONFIG.rateLimitRpm} rpm</span></div>
</div></div>
<footer>PATCH /v1/config to change settings live &nbsp;|&nbsp; GET /v1/metrics for JSON &nbsp;|&nbsp; GET /health for status</footer>
</body></html>`);
});

app.get('/health',(req,res)=>res.json({status:'ok',version:'2.0',uptime:Math.floor((Date.now()-METRICS.startTime)/1000),activeStreams:METRICS.activeStreams,mode:'NOVELIST_MODE_ACTIVE'}));
app.get('/v1/metrics',(req,res)=>res.json({...METRICS,uptimeSec:Math.floor((Date.now()-METRICS.startTime)/1000),avgLatencyMs:METRICS.successRequests>0?Math.round(METRICS.totalLatencyMs/METRICS.successRequests):0,config:CONFIG}));
app.patch('/v1/config',(req,res)=>{
  const allowed=['temperature','maxTokens','frequencyPenalty','presencePenalty','maxContextMessages','retryAttempts','showThinking','enableFormatting','rateLimitRpm'];
  const updates={};
  for(const k of allowed)if(req.body[k]!==undefined){CONFIG[k]=req.body[k];updates[k]=req.body[k];}
  log('INFO','Config updated',updates);res.json({ok:true,updated:updates,current:CONFIG});
});
app.get('/v1/models',(req,res)=>res.json({object:'list',data:[...new Set(Object.values(MODEL_REGISTRY))].map(id=>({id,object:'model',owned_by:'nvidia-nim',created:0}))}));

app.post('/v1/chat/completions',async(req,res)=>{
  const clientIp=req.headers['x-forwarded-for']?.split(',')[0]||req.ip||'unknown';
  if(!checkRateLimit(clientIp)) return res.status(429).json({error:{message:'Rate limit exceeded.',type:'rate_limit_error',code:429}});
  const errs=validateChatRequest(req.body);
  if(errs.length) return res.status(400).json({error:{message:errs.join('; '),type:'validation_error',code:400}});

  const{model,messages,temperature,max_tokens,stream}=req.body;
  const requestId=`req_${Date.now().toString(36)}`;
  const startTime=Date.now();
  METRICS.totalRequests++;

  const nimModel=resolveModel(model);
  METRICS.modelUsage[nimModel]=(METRICS.modelUsage[nimModel]||0)+1;
  log('INFO',`[${requestId}] ${model} → ${nimModel}`);

  const scenarioDirectives=detectScenario(messages);
  if(scenarioDirectives.length) log('INFO',`[${requestId}] ${scenarioDirectives.length} scene directive(s) injected`);

  const pruned=pruneContext(messages);
  const systemMsg=buildSystemPrompt(scenarioDirectives);
  const processedMessages=[systemMsg,...pruned.filter(m=>m.role!=='system')];

  const NIM_API_BASE=process.env.NIM_API_BASE||'https://integrate.api.nvidia.com/v1';
  const nimPayload={
    model:nimModel,
    messages:processedMessages,
    temperature:temperature??CONFIG.temperature,
    max_tokens:max_tokens??CONFIG.maxTokens,
    frequency_penalty:CONFIG.frequencyPenalty,
    presence_penalty:CONFIG.presencePenalty,
    stream:true,
  };

  try{
    const nimResponse=await withRetry(()=>axios.post(`${NIM_API_BASE}/chat/completions`,nimPayload,{
      headers:{'Authorization':`Bearer ${process.env.NIM_API_KEY}`,'Content-Type':'application/json','Accept':'text/event-stream'},
      responseType:'stream',timeout:CONFIG.requestTimeoutMs,
    }),requestId);

    METRICS.activeStreams++;

    if(stream!==false){
      res.setHeader('Content-Type','text/event-stream');
      res.setHeader('Cache-Control','no-cache');
      res.setHeader('Connection','keep-alive');
      res.setHeader('X-Request-Id',requestId);

      const heartbeat=setInterval(()=>{if(!res.writableEnded)res.write(': ping\n\n');},CONFIG.heartbeatIntervalMs);
      let streamBuffer='';
      let inReasoningBlock=false;

      nimResponse.data.on('data',(chunk)=>{
        streamBuffer+=chunk.toString();
        const lines=streamBuffer.split('\n');
        streamBuffer=lines.pop()??'';
        for(const line of lines){
          if(!line.startsWith('data: ')){if(line.trim())res.write(line+'\n');continue;}
          const payload=line.slice(6).trim();
          if(payload==='[DONE]'){res.write('data: [DONE]\n\n');continue;}
          let parsed;try{parsed=JSON.parse(payload);}catch{res.write(line+'\n');continue;}
          const delta=parsed?.choices?.[0]?.delta;
          if(!delta){res.write(`data: ${JSON.stringify(parsed)}\n\n`);continue;}
          if(!CONFIG.showThinking){delete delta.reasoning_content;if(delta.reasoning)delete delta.reasoning;}
          if(delta.content){
            let c=delta.content;
            if(c.includes('<think>')){inReasoningBlock=true;}
            if(c.includes('</think>')){inReasoningBlock=false;c=c.replace(/<\/think>/g,'');}
            if(inReasoningBlock){delta.content='';}
            else{c=c.replace(/(\*)\s{2,}(")/g,'$1\n\n$2');c=c.replace(/(")(\*)/g,'$1\n\n$2');delta.content=c;}
          }
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        }
      });

      nimResponse.data.on('end',()=>{
        clearInterval(heartbeat);METRICS.activeStreams--;
        const lat=Date.now()-startTime;METRICS.successRequests++;METRICS.totalLatencyMs+=lat;
        log('OK',`[${requestId}] Stream done in ${lat}ms`);
        if(!res.writableEnded)res.end();
      });
      nimResponse.data.on('error',(err)=>{
        clearInterval(heartbeat);METRICS.activeStreams--;METRICS.failedRequests++;
        log('ERROR',`[${requestId}] Stream error: ${err.message}`);
        if(!res.writableEnded)res.end();
      });
      req.on('close',()=>{clearInterval(heartbeat);nimResponse.data.destroy();});

    }else{
      let rawBuffer='',fullContent='';
      await new Promise((resolve,reject)=>{
        nimResponse.data.on('data',c=>{rawBuffer+=c.toString();});
        nimResponse.data.on('end',resolve);
        nimResponse.data.on('error',reject);
      });
      for(const line of rawBuffer.split('\n')){
        if(!line.startsWith('data: '))continue;
        const p=line.slice(6).trim();if(p==='[DONE]')continue;
        try{const d=JSON.parse(p);const c=d?.choices?.[0]?.delta?.content;if(c)fullContent+=c;}catch{}
      }
      const formatted=formatResponse(fullContent);
      const lat=Date.now()-startTime;METRICS.successRequests++;METRICS.totalLatencyMs+=lat;METRICS.activeStreams--;
      log('OK',`[${requestId}] Non-stream done in ${lat}ms`);
      res.json({id:requestId,object:'chat.completion',created:Math.floor(Date.now()/1000),model:nimModel,
        choices:[{index:0,message:{role:'assistant',content:formatted},finish_reason:'stop'}],
        usage:{prompt_tokens:-1,completion_tokens:-1,total_tokens:-1}});
    }

  }catch(error){
    METRICS.failedRequests++;METRICS.activeStreams=Math.max(0,METRICS.activeStreams-1);
    const status=error.response?.status||500;
    const isTimeout=error.code==='ECONNABORTED'||status===504;
    if(isTimeout)METRICS.timeoutRequests++;
    log('ERROR',`[${requestId}] ${isTimeout?'TIMEOUT':'ERROR'}: ${error.message}`);
    if(!res.headersSent)res.status(isTimeout?504:status).json({error:{
      message:isTimeout?`Request timed out after ${CONFIG.requestTimeoutMs/1000}s. Try shorter context or a faster model.`:error.message,
      type:isTimeout?'timeout_error':'proxy_error',code:isTimeout?504:status,request_id:requestId}});
  }
});

app.use((req,res)=>res.status(404).json({error:{message:`Not found: ${req.method} ${req.path}`,type:'not_found',code:404}}));

let server;
function shutdown(sig){
  log('WARN',`${sig} — graceful shutdown`);
  server.close(()=>{log('OK','Closed. Goodbye.');process.exit(0);});
  setTimeout(()=>process.exit(1),10000);
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));

validateEnv();
server=app.listen(PORT,()=>{
  log('OK',`╔══════════════════════════════════════════╗`);
  log('OK',`║  NIM RP Proxy V2 "Novelist Mode" :${PORT}  ║`);
  log('OK',`╚══════════════════════════════════════════╝`);
  log('INFO',`Dashboard → http://localhost:${PORT}/`);
  log('INFO',`Chat      → POST http://localhost:${PORT}/v1/chat/completions`);
  log('INFO',`Config    → PATCH http://localhost:${PORT}/v1/config`);
});
