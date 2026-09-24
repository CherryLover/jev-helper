// The player's own match objective ("摧毁五角大楼", "destroy the Pentagon") turned into a concrete
// target: small local models cannot connect a Chinese sentence to a building labelled "Pentagon",
// so the match is done here and offered to the model as a ready-made option.
const distance = (a, b) => Math.hypot(a.rx - b.rx, a.ry - b.ry);

// Chinese names -> English keywords found in rule labels (lower case, substring match).
export const OBJECTIVE_NAMES = [
  [/五角大楼|五角大厦/, ['pentagon']],
  [/白宫/, ['white house']],
  [/自由女神/, ['statue of liberty', 'liberty']],
  [/克里姆林/, ['kremlin']],
  [/埃菲尔|艾菲尔/, ['eiffel']],
  [/华盛顿纪念碑/, ['washington monument']],
  [/国会大厦/, ['capitol']],
  [/雷达|空指部|空军指挥部/, ['radar', 'air force command']],
  [/发电厂|电厂|核电站|反应炉|磁能反应/, ['power plant', 'reactor']],
  [/兵营/, ['barracks']],
  [/战车工厂|坦克工厂|重工|工厂/, ['war factory', 'factory']],
  [/建造厂|主基地|基地车/, ['construction yard']],
  [/矿场|精炼厂|矿厂/, ['refinery']],
  [/核弹|核弹发射井|导弹发射井/, ['nuclear missile', 'missile silo', 'nuke']],
  [/天气控制/, ['weather control', 'weather']],
  [/超时空传送|时空传送/, ['chronosphere']],
  [/铁幕/, ['iron curtain']],
  [/作战实验室|实验室/, ['battle lab', 'laboratory']],
  [/心灵信标|心灵控制|心灵控制器/, ['psychic']],
  [/船厂|造船厂/, ['shipyard', 'naval yard']],
  [/碉堡/, ['pill box', 'pillbox', 'bunker']],
  [/光棱塔/, ['prism tower']],
  [/磁暴线圈/, ['tesla coil']],
  [/爱国者/, ['patriot']],
  [/油井|钻油/, ['oil derrick', 'derrick']],
  [/医院/, ['hospital']],
  [/机场/, ['airport', 'airfield']],
];
const PROTECT = /保护|守护|守住|保卫|护送|营救|救出|占领|夺取|俘获|protect|defend|guard|escort|rescue|capture|save/i;
const DESTROY = /摧毁|消灭|击毁|炸毁|拆除|破坏|打掉|推平|摧垮|destroy|eliminate|kill|demolish|raze|take out|wipe out/i;

// "Protect the Pentagon" or "capture the lab" must never turn into an attack order.
const protectOnly = (text) => PROTECT.test(text) && !DESTROY.test(text);
export function objectiveKeywords(text) {
  if (!text || protectOnly(text)) return [];
  const out = new Set();
  for (const [pattern, words] of OBJECTIVE_NAMES) if (pattern.test(text)) words.forEach(w => out.add(w));
  const lower = text.toLowerCase();
  // English objective text: any known English name written directly.
  for (const [, words] of OBJECTIVE_NAMES) for (const w of words) if (w.length >= 4 && new RegExp(`\\b${w}\\b`).test(lower)) out.add(w);
  return [...out];
}

export function matchesObjective(text, keywords, rule, name) {
  if (!text || protectOnly(text)) return false;
  const label = String(rule?.label ?? '').toLowerCase(), code = String(name ?? '').toLowerCase();
  const hay = `${label} ${code}`;
  if (keywords.some(k => hay.includes(k))) return true;
  // The objective names the building by its label ("destroy the Pentagon").
  return label.length >= 4 && text.toLowerCase().includes(label);
}

// Keeps memory.objectiveTarget up to date: the matched building (id, name, label, position, last
// seen tick) survives the fog; once its tile is visible and the building is gone it is marked done.
export function trackObjective(api, catalog, memory, from) {
  const text = memory.objective;
  if (!text) return undefined;
  if (memory.objectiveKeys?.text !== text) { memory.objectiveKeys = { text, words: objectiveKeywords(text) }; memory.objectiveTarget = undefined; memory.objectiveDone = new Set(); }
  memory.objectiveDone ??= new Set();
  const tick = api.tick(), B = api.ObjectType.Building;
  let hostile = []; try { hostile = api.units('hostile') ?? []; } catch { hostile = []; }
  let target = memory.objectiveTarget;
  if (target && !target.done) {
    const seen = hostile.find(u => u.id === target.id);
    if (seen) Object.assign(target, { x: seen.tile.rx, y: seen.tile.ry, lastSeen: tick, visible: true });
    else if (api.map.visible(target.x, target.y)) { Object.assign(target, { done: true, destroyedTick: tick, visible: false }); memory.objectiveDone.add(target.id); }
    else target.visible = false;
  }
  if (!target || target.done) {
    const words = memory.objectiveKeys.words;
    const origin = from ?? hostile[0]?.tile;
    const match = hostile.filter(u => u.type === B && !memory.objectiveDone.has(u.id) && matchesObjective(text, words, catalog[u.name], u.name))
      .sort((a, b) => origin ? distance(a.tile, origin) - distance(b.tile, origin) : 0)[0];
    if (match) target = memory.objectiveTarget = { id: match.id, name: match.name, label: catalog[match.name]?.label ?? match.name,
      x: match.tile.rx, y: match.tile.ry, firstSeen: tick, lastSeen: tick, visible: true };
  }
  return memory.objectiveTarget;
}
