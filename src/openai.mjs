// OpenAI-compatible chat models answering the same choice questions Jev answers. The model gets
// the battlefield state plus every decision group with its legal option keys, and replies through
// a forced function call (or a bare JSON object). Replies are mapped back to Jev's answer shape,
// so validation, execution and logging stay the same for every provider.
export const OPENAI_MODES = /* @__PURE__ */ Object.freeze(['tools', 'json']);
export const TOOL_NAME = 'submit_choices';
const STATE_LIMIT = 48000; // characters of state JSON per request; keeps token use bounded

const SYSTEM = [
  'You command one player in WannaFire, a browser remake of Command & Conquer: Red Alert 2.',
  'Each turn you receive the battlefield state visible to that player and several decision groups.',
  'Every group lists its only legal options as "key": "what it does". For each group choose exactly one option key.',
  'Follow each group\'s instructions. Choose "wait" only when no other option is useful or affordable right now.',
  'Answer every group. Keep each reason to one short sentence.',
].join(' ');

// Scalars first, long arrays and objects after; when still too large, arrays are shortened.
export function compactState(state, limit = STATE_LIMIT) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const short = {}, long = {};
  for (const [k, v] of Object.entries(state)) (v && typeof v === 'object' ? long : short)[k] = v;
  let out = { ...short, ...long };
  for (const n of [24, 8, 2]) {
    if (JSON.stringify(out).length <= limit) return out;
    out = JSON.parse(JSON.stringify(out, (k, v) => Array.isArray(v) && v.length > n ? [...v.slice(0, n), `…${v.length - n} more`] : v));
  }
  return out;
}

export function choiceSchema(questions) {
  const properties = {};
  for (const [id, q] of Object.entries(questions)) {
    properties[id] = {
      type: 'object',
      properties: {
        choice: { type: 'string', enum: Object.keys(q.criteria) },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are, 0 to 1.' },
        reason: { type: 'string', description: 'One short sentence.' },
      },
      required: ['choice'],
    };
  }
  return { type: 'object', properties, required: Object.keys(questions) };
}

export function buildChatRequest({ model, mode = 'tools', state, questions }) {
  const decisions = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { instructions: q.instructions, options: q.criteria }]));
  const user = JSON.stringify({ state: compactState(state), decisions });
  if (mode === 'json') {
    const shape = Object.fromEntries(Object.keys(questions).map(id => [id, { choice: '<option key>', confidence: 0.8, reason: '<short>' }]));
    return {
      model,
      messages: [
        { role: 'system', content: `${SYSTEM} Reply with only one JSON object shaped like ${JSON.stringify(shape)}, no other text.` },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    };
  }
  return {
    model,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    tools: [{ type: 'function', function: { name: TOOL_NAME, description: 'Submit one option key for every decision group.', parameters: choiceSchema(questions) } }],
    tool_choice: { type: 'function', function: { name: TOOL_NAME } },
  };
}

// The first JSON object in a text reply, tolerating code fences and surrounding prose.
function parseObject(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}
const textOf = content => Array.isArray(content) ? content.map(p => typeof p === 'string' ? p : p?.text ?? '').join('') : content;

// Returns {answers, model, usage}. A group with a missing or unknown choice falls back to its
// "wait" option and is flagged; only when no group has a usable choice is the reply rejected.
export function parseChatResponse(body, questions, name = 'OpenAI') {
  const message = body?.choices?.[0]?.message ?? {};
  const call = message.tool_calls?.find(c => c?.function?.name === TOOL_NAME) ?? message.tool_calls?.[0];
  const raw = call?.function?.arguments ?? message.function_call?.arguments ?? textOf(message.content);
  let data = parseObject(raw);
  if (!data) throw new Error(`${name} 返回的内容无法解析。`);
  const ids = Object.keys(questions);
  if (!ids.some(id => id in data)) data = [data.answers, data.choices, data.decisions].find(x => x && typeof x === 'object' && ids.some(id => id in x)) ?? data;
  const answers = {};
  let valid = 0;
  for (const [id, q] of Object.entries(questions)) {
    const a = data[id], choice = typeof a === 'string' ? a : a?.choice;
    const confidence = Number(a?.confidence);
    const reason = typeof a?.reason === 'string' ? a.reason.slice(0, 200) : '';
    if (typeof choice === 'string' && Object.hasOwn(q.criteria, choice)) {
      valid++;
      answers[id] = { type: 'choice', choice, confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0, probabilities: {}, ...(reason ? { reason } : {}) };
    } else if (Object.hasOwn(q.criteria, 'wait')) {
      answers[id] = { type: 'choice', choice: 'wait', confidence: 0, probabilities: {}, fallback: true };
    } else throw new Error(`${name} 返回了未提供的候选，已拒绝执行。`);
  }
  if (!valid) throw new Error(`${name} 返回了未提供的候选，已拒绝执行。`);
  const u = body?.usage ?? {};
  return {
    answers,
    model: typeof body?.model === 'string' ? body.model.slice(0, 160) : '',
    usage: { input_tokens: Number(u.prompt_tokens ?? u.input_tokens) || 0, output_tokens: Number(u.completion_tokens ?? u.output_tokens) || 0 },
  };
}

// GET /models → sorted ids. Accepts {data:[{id}]} (OpenAI), {models:[…]} and plain arrays.
export function modelIds(body) {
  const list = Array.isArray(body) ? body : body?.data ?? body?.models ?? [];
  const ids = list.map(m => typeof m === 'string' ? m : m?.id ?? m?.name).filter(id => typeof id === 'string' && /^[\w.\/:@+-]{1,160}$/.test(id));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

// The service's own error text, when it sends one, for a clearer failure message.
export function serviceError(raw) {
  try { const e = JSON.parse(raw)?.error; return String(typeof e === 'string' ? e : e?.message ?? '').replace(/\s+/g, ' ').slice(0, 160); } catch { return ''; }
}
