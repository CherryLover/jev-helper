export const DEFAULTS = Object.freeze({ apiBase: 'https://api.typesafe.ai/v1', model: 'jev-latest', hotkey: 'Alt+Shift+J', autoCamera: true, maxDecisions: 2000, language:'zh-CN' });
export const GAME_HOSTS = ['ra2web.github.io', 'staging.wangerhuoda.com', 'wangerhuoda.com', 'www.wangerhuoda.com'];
export const CHANNEL = 'werhd-jev-extension-v1';
export function supportedGame(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && GAME_HOSTS.includes(u.hostname) || u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname); } catch { return false; }
}
export function apiEndpoint(value) {
  let u; try { u = new URL(value.trim()); } catch { throw new Error('请输入有效的 API 地址。'); }
  if (u.username || u.password || u.search || u.hash) throw new Error('API 地址不能包含账号、查询参数或片段。');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) throw new Error('API 地址须使用 HTTPS；本机调试地址可使用 HTTP。');
  u.pathname = u.pathname.replace(/\/+$/, '');
  if (!u.pathname.endsWith('/systemone')) u.pathname += '/systemone';
  return u.href;
}
export const originPattern = value => { const u = new URL(apiEndpoint(value)); return `${u.protocol}//${u.hostname}/*`; };
export function normalizeHotkey(value) {
  const parts = String(value).split('+').map(s => s.trim());
  const key = parts.pop()?.toUpperCase();
  const mods = ['Ctrl','Alt','Shift','Meta'].filter(m => parts.some(p => p.toLowerCase() === m.toLowerCase()));
  if (!/^[A-Z0-9]$|^F(?:[1-9]|1[0-2])$/.test(key ?? '') || !mods.some(m=>m !== 'Shift') || mods.length !== new Set(parts.map(p=>p.toLowerCase())).size) throw new Error('快捷键需要 Ctrl、Alt 或 Meta 加一个字母、数字或 F1–F12。');
  return [...mods, key].join('+');
}
export function hotkeyFromEvent(e) {
  const key = /^(Key|Digit)/.test(e.code) ? e.code.replace(/^(Key|Digit)/,'') : e.code;
  try { return normalizeHotkey([e.ctrlKey&&'Ctrl',e.altKey&&'Alt',e.shiftKey&&'Shift',e.metaKey&&'Meta',key].filter(Boolean).join('+')); } catch { return ''; }
}
export function validateSettings(input, prior = {}) {
  const s = {...DEFAULTS, ...prior, ...input};
  s.apiBase = String(s.apiBase).trim(); apiEndpoint(s.apiBase);
  s.model = String(s.model).trim();
  if (!/^[\w.\/-]{1,80}$/.test(s.model)) throw new Error('模型名称无效。');
  s.hotkey = normalizeHotkey(s.hotkey);
  s.maxDecisions = Number(s.maxDecisions);
  if (!Number.isInteger(s.maxDecisions) || s.maxDecisions < 1 || s.maxDecisions > 10000) throw new Error('每局决策上限应为 1–10000。');
  s.autoCamera = Boolean(s.autoCamera);
  s.language = s.language === 'en' ? 'en' : 'zh-CN';
  s.apiKey = String(s.apiKey ?? '').trim();
  if (s.apiKey.length > 4096 || /[\r\n]/.test(s.apiKey)) throw new Error('密钥格式无效。');
  return s;
}
export const publicSettings = s => ({apiBase:s.apiBase, model:s.model, hotkey:s.hotkey, autoCamera:s.autoCamera, maxDecisions:s.maxDecisions, language:s.language??DEFAULTS.language, hasKey:!!s.apiKey});
export function prepareQuestions(body) {
  if (!body || JSON.stringify(body).length > 256000 || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) throw new Error('战况请求格式或大小无效。');
  const entries = Object.entries(body.groups ?? {});
  if (!entries.length || entries.length > 8) throw new Error('一次请求需要 1–8 个决策组。');
  return Object.fromEntries(entries.map(([id,g]) => {
    const criteria = Object.entries(g?.criteria ?? {});
    if (!/^[a-z_]+$/.test(id) || typeof g.instructions !== 'string' || !g.instructions || !criteria.length || criteria.length > 255 || criteria.some(([k,v])=>!k || typeof v !== 'string')) throw new Error('决策候选无效。');
    return [id,{type:'choice',instructions:g.instructions,criteria:Object.fromEntries(criteria)}];
  }));
}
export function validateAnswer(result, questions) {
  const answers = {};
  for (const [id,q] of Object.entries(questions)) {
    const a = result.answers?.[id];
    if (a?.type !== 'choice' || !Object.hasOwn(q.criteria,a.choice)) throw new Error('Jev 返回了未提供的候选，已拒绝执行。');
    answers[id] = {type:'choice',choice:a.choice,confidence:Number(a.confidence)||0,probabilities:Object.fromEntries(Object.entries(a.probabilities??{}).filter(([k,v])=>Object.hasOwn(q.criteria,k)&&Number.isFinite(v)))};
  }
  return {answers,model:typeof result.model==='string'?result.model:'',usage:{input_tokens:Number(result.usage?.input_tokens)||0,output_tokens:Number(result.usage?.output_tokens)||0}};
}
export function httpError(status) {
  return ({401:'Jev 拒绝了密钥（HTTP 401），请检查密钥。',402:'Jev 返回 HTTP 402，请检查账户额度或计费状态。',403:'Jev 拒绝访问（HTTP 403），请检查密钥权限和 API 地址。',429:'Jev 请求过于频繁或额度受限（HTTP 429），请稍后再试。'})[status] ?? `Jev 请求失败（HTTP ${status}）。`;
}
