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

// Objectives are read clause by clause: "摧毁五角大楼，保护白宫" names one target and one building
// that must never be attacked. A clause without a verb inherits the previous one ("摧毁A和B").
const CLAUSE = /[，,。.;；！!？?、\n]|和|与|以及|然后|再|\band\b|\bthen\b/i;
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// English names match whole words only ("Pent" is not "Pentagon", "destroy everything" is not "Thing").
const wordIn = (hay, word) => new RegExp(`(^|[^a-z0-9])${escape(word)}([^a-z0-9]|$)`).test(hay);
export function parseObjective(text) {
  const destroy = [], protect = [];
  let intent = 'destroy';
  for (const clause of String(text ?? '').split(CLAUSE).map(c => c?.trim()).filter(Boolean)) {
    if (PROTECT.test(clause) && !DESTROY.test(clause)) intent = 'protect';
    else if (DESTROY.test(clause)) intent = 'destroy';
    (intent === 'destroy' ? destroy : protect).push(clause.toLowerCase());
  }
  const namesIn = (clauses) => {
    const out = new Set();
    for (const c of clauses) for (const [pattern, words] of OBJECTIVE_NAMES) {
      if (pattern.test(c)) words.forEach(w => out.add(w));
      for (const w of words) if (w.length >= 4 && wordIn(c, w)) out.add(w);
    }
    return out;
  };
  const guarded = namesIn(protect);
  return { words: [...namesIn(destroy)].filter(w => !guarded.has(w)), destroyText: destroy.join(' | '), protectText: protect.join(' | '), guarded: [...guarded] };
}
export const objectiveKeywords = (text) => parseObjective(text).words;

export function matchesObjective(text, keywords, rule, name) {
  const { destroyText, protectText, guarded } = parseObjective(text);
  if (!destroyText) return false;
  const label = String(rule?.label ?? '').toLowerCase(), code = String(name ?? '').toLowerCase();
  const hay = `${label} ${code}`;
  // A building the objective says to protect is never a target, even if another clause also fits it.
  if (guarded.some(w => wordIn(hay, w)) || (label.length >= 4 && wordIn(protectText, label))) return false;
  if (keywords.some(k => wordIn(hay, k))) return 'name';
  // The objective names the building by its label ("destroy the Pentagon"); a weaker match.
  return label.length >= 4 && wordIn(destroyText, label) ? 'label' : false;
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
    // Taken by our engineer: no longer something to attack, and not a kill either.
    const ours = !seen && (api.units('self') ?? []).some(u => u.id === target.id);
    if (seen) Object.assign(target, { x: seen.tile.rx, y: seen.tile.ry, lastSeen: tick, visible: true });
    else if (ours) { Object.assign(target, { done: true, captured: true, capturedTick: tick, visible: true }); memory.objectiveDone.add(target.id); }
    else if (api.map.visible(target.x, target.y)) { Object.assign(target, { done: true, destroyedTick: tick, visible: false }); memory.objectiveDone.add(target.id); }
    else target.visible = false;
  }
  if (!target || target.done) {
    const words = memory.objectiveKeys.words;
    const origin = from ?? hostile[0]?.tile;
    const match = hostile.map(u => ({ u, how: u.type === B && !memory.objectiveDone.has(u.id) && matchesObjective(text, words, catalog[u.name], u.name) }))
      .filter(m => m.how).sort((a, b) => (a.how === 'name' ? 0 : 1) - (b.how === 'name' ? 0 : 1) || (origin ? distance(a.u.tile, origin) - distance(b.u.tile, origin) : 0))[0]?.u;
    if (match) target = memory.objectiveTarget = { id: match.id, name: match.name, label: catalog[match.name]?.label ?? match.name,
      x: match.tile.rx, y: match.tile.ry, firstSeen: tick, lastSeen: tick, visible: true };
  }
  return memory.objectiveTarget;
}
