import test from 'node:test';
import assert from 'node:assert/strict';
import { attachJevPlayer, collectState, candidateGroups, executeCandidate, forceReadiness, acceptMission, missionGate, respondToThreats, maintainBattle,
  MISSION_LOCK_TICKS, THREAT_REPLY_TICKS, MAX_ASSAULTS, ENGAGE_RADIUS } from '../src/player/werhd-jev-player.mjs';
import { objectiveKeywords, trackObjective } from '../src/player/werhd-jev-objective.mjs';

// From two 0.5.9 reports (local Laya model): the player set "摧毁五角大楼" as the match objective, but
// the Pentagon never appeared among the options (three Patriot sites took the defense slots), the
// army marched back and forth between targets and ended up rallying at home 53 times, and infantry
// stood still while a pillbox out of their reach shot them.
const weapon = (range, damage, { aa = false, ag = true, verses = [1, 1, 1, 1, 1, 1, 1] } = {}) => ({ range, damage, rof: 40, aa, ag, verses });
const catalog = {
  YARD:{yard:true,label:'Construction Yard'}, BARRACKS:{factory:'InfantryType',label:'Barracks',cost:500}, FACTORY:{factory:'UnitType',label:'War Factory'},
  GI:{category:'Soldier',cost:200,speed:8,armor:'none',weapon:weapon(4,15,{verses:[1,1,1,1,1,0,0.5]}),label:'Conscript'},
  EGI:{category:'Soldier',armor:'none',weapon:weapon(4,15),label:'GI'},
  TANK:{category:'AFV',cost:700,armor:'heavy',weapon:weapon(6,60),label:'Rhino Tank'},
  PENTAGON:{label:'Pentagon',armor:'concrete'}, POWER:{power:200,label:'Power Plant',armor:'concrete'},
  EBARR:{factory:'InfantryType',label:'Allied Barracks',armor:'concrete'}, EREF:{refinery:true,label:'Ore Refinery',armor:'concrete'},
  PATRIOT:{isBaseDefense:true,label:'Patriot Missile',armor:'concrete',weapon:weapon(8,50,{aa:true,ag:false})},
  PILL:{isBaseDefense:true,label:'Pill Box',armor:'concrete',weapon:weapon(5.5,40)},
  SENTRY:{isBaseDefense:true,label:'Sentry Gun',cost:500,weapon:weapon(5,20)},
};
const unit = (id, name, type, x, y, extra = {}) => ({ id, name, type, tile:{rx:x,ry:y}, hitPoints:100, maxHitPoints:100, isIdle:true, primaryWeapon:catalog[name].weapon, canDeploy:false, isDeployed:false, ...extra });
function world({ own, enemies = [], neutral = [], credits = 25000, tick = 3000, offers = {2:[{name:'GI',type:3}]}, queues = [], visible = () => true }) {
  const calls = [];
  const api = {
    ObjectType:{Building:2,Vehicle:7,Infantry:3,Aircraft:1}, QueueType:{Structures:0,Armory:1,Infantry:2,Vehicles:3,Aircrafts:4,Ships:5},
    OrderType:{Move:1,Attack:2,Capture:7,Occupy:8,Repair:9,DeploySelected:10,Stop:11}, LandType:{Clear:0}, ZoneType:{Air:1,Water:2},
    ArmorType:{0:'None',3:'Light',5:'Heavy',6:'Concrete',None:0,Light:3,Heavy:5,Concrete:6},
    units:r=>r==='self'?own:r==='enemy'?enemies:r==='allied'?[]:[...enemies,...neutral], unit:id=>[...own,...enemies,...neutral].find(u=>u.id===id),
    me:()=>({credits,power:{total:500,drain:100},combatant:true,defeated:false,isObserver:false}), tick:()=>tick, time:()=>tick/15, players:()=>[],
    map:{size:()=>({width:100,height:100}),visible:(x,y)=>visible(x,y),tile:(x,y)=>({rx:x,ry:y,landType:0})}, canPlace:()=>true,
    production:{queues:()=>Array.from({length:6},(_,type)=>({type,size:queues.filter(q=>q.type===type).length,maxSize:99,items:queues.filter(q=>q.type===type)})),
      available:q=>q===undefined?Object.values(offers).flat():(offers[q]??[])},
    weaponVs:()=>undefined, inRange:()=>false, attack:(...a)=>calls.push(['attack',...a]), move:(...a)=>calls.push(['move',...a]), attackMove:(...a)=>calls.push(['attackMove',...a]), deploy:()=>true,
    order:(ids,o)=>{calls.push(['order',ids,o]);return true;}, produce:(...a)=>calls.push(['produce',...a]), gather(){}, repair(){},
    onTick:h=>{api._tick=h;}, offTick(){},
  };
  const memory = { frontiers:new Map(), enemyBuildings:new Map(), orders:new Map(), postureOrders:new Map(), specialOrders:new Map(), specialTargets:new Map(), plannedSites:new Map(), observedSpecial:new Map(), repairing:new Set(), lastMaintenance:tick, lastMicroReport:-1000 };
  return { api, memory, calls, setTick:t=>{tick=t;}, own, enemies };
}
const home = () => [unit(1,'YARD',2,10,10), unit(2,'BARRACKS',2,12,10)];
const squad = (n, x = 40, y = 40, name = 'GI') => Array.from({length:n}, (_, i) => unit(10 + i, name, name === 'TANK' ? 7 : 3, x + (i % 4), y + Math.floor(i / 4)));
const enemyBase = () => [unit(801,'EBARR',2,62,60), unit(802,'EREF',2,64,60), unit(803,'POWER',2,60,60),
  unit(910,'PATRIOT',2,50,44), unit(911,'PATRIOT',2,52,44), unit(912,'PATRIOT',2,54,44), unit(920,'PILL',2,59,47), unit(990,'PENTAGON',2,58,45)];
const choices = (g) => Object.keys(g.criteria).filter(k => k !== 'wait');

test('"摧毁五角大楼" becomes the first tactics option; Patriot sites are not assault targets, the pillbox is', () => {
  const w = world({ own:[...home(), ...squad(12)], enemies:enemyBase() });
  w.memory.objective = '摧毁五角大楼';
  const snap = collectState(w.api, catalog), groups = candidateGroups(w.api, catalog, snap, w.memory);
  const t = groups.tactics, keys = choices(t);
  assert.equal(keys[0], 'objective_990', 'the objective is listed first');
  assert.equal(t.actions.objective_990.auto, 2);
  assert.equal(t.actions.objective_990.targetId, 990); assert.equal(t.actions.objective_990.objective, true);
  assert.equal(t.criteria.objective_990, 'OBJECTIVE: destroy Pentagon #990 at (58,45) with 11 units.', 'short enough for a 48-token option');
  assert.match(t.instructions, /^MISSION OBJECTIVE: 摧毁五角大楼 Target: Pentagon #990 at \(58,45\)\. Force READY/);
  assert.ok(t.actions.assault_920, 'the pillbox shoots ground troops and is offered');
  for (const id of [910, 911, 912]) assert.ok(!t.actions[`assault_${id}`], `Patriot #${id} only shoots aircraft`);
  assert.ok(!t.actions.assault_990, 'the objective is not duplicated as an assault');
  const assaults = keys.filter(k => k.startsWith('assault_'));
  assert.ok(assaults.length <= MAX_ASSAULTS); assert.deepEqual(assaults, ['assault_801', 'assault_802', 'assault_803', 'assault_920'], 'factory, refinery, power, then the defense');
  assert.deepEqual({ id:snap.state.objectiveTarget.id, label:snap.state.objectiveTarget.label, visible:snap.state.objectiveTarget.visible }, { id:990, label:'Pentagon', visible:true });
});

test('the objective is offered whatever the force size, and a threatened base is defended first', () => {
  const few = world({ own:[...home(), ...squad(3)], enemies:enemyBase() });
  few.memory.objective = '摧毁五角大楼';
  let groups = candidateGroups(few.api, catalog, collectState(few.api, catalog), few.memory);
  assert.ok(groups.tactics.actions.objective_990, 'two free soldiers still get the objective option');
  assert.ok(!choices(groups.tactics).some(k => k.startsWith('assault_')), 'but no ordinary assault');
  const raided = world({ own:[...home(), ...squad(12)], enemies:[...enemyBase(), unit(700,'TANK',7,14,14)] });
  raided.memory.objective = '摧毁五角大楼';
  groups = candidateGroups(raided.api, catalog, collectState(raided.api, catalog), raided.memory);
  assert.deepEqual(choices(groups.tactics).slice(0, 2), ['defend_base', 'objective_990']);
  assert.equal(groups.tactics.actions.objective_990.auto, undefined, 'not automatic while the base is under attack');
});

test('an English objective matches too; the target is remembered in the fog and dropped once destroyed', () => {
  let fog = false;
  const enemies = enemyBase();
  const w = world({ own:[...home(), ...squad(12)], enemies, visible:(x,y)=>!(fog && x===58 && y===45) });
  w.memory.objective = 'destroy the Pentagon';
  let groups = candidateGroups(w.api, catalog, collectState(w.api, catalog), w.memory);
  assert.ok(groups.tactics.actions.objective_990);
  // Out of sight: the remembered position is used.
  enemies.splice(enemies.findIndex(e => e.id === 990), 1); fog = true;
  const snap = collectState(w.api, catalog);
  groups = candidateGroups(w.api, catalog, snap, w.memory);
  assert.equal(groups.tactics.criteria.objective_990, 'OBJECTIVE: destroy Pentagon #990 last seen at (58,45) with 11 units.');
  assert.equal(snap.state.objectiveTarget.visible, false);
  const execution = executeCandidate(w.api, groups.tactics.actions.objective_990, catalog);
  assert.equal(execution.accepted, true);
  assert.deepEqual(w.calls.at(-1).slice(0, 1).concat(w.calls.at(-1).slice(2)), ['attackMove', 58, 45], 'attack-move to the remembered position');
  // Its tile is in sight again and it is gone: destroyed, the option disappears.
  fog = false;
  const after = collectState(w.api, catalog);
  groups = candidateGroups(w.api, catalog, after, w.memory);
  assert.ok(!choices(groups.tactics).some(k => k.startsWith('objective_')));
  assert.equal(after.state.objectiveTarget.done, true);
  assert.match(groups.tactics.instructions, /Target Pentagon destroyed/);
});

test('protect / capture objectives never become attack orders; an unseen objective keeps scouting going', () => {
  assert.deepEqual(objectiveKeywords('保护五角大楼'), []);
  assert.deepEqual(objectiveKeywords('capture the Pentagon'), []);
  assert.deepEqual(objectiveKeywords('摧毁五角大楼'), ['pentagon']);
  const guard = world({ own:[...home(), ...squad(12)], enemies:enemyBase() });
  guard.memory.objective = '保护五角大楼';
  assert.equal(trackObjective(guard.api, catalog, guard.memory), undefined);
  // Enemy buildings are known and the force is ready, but the Pentagon has never been seen.
  const search = world({ own:[...home(), ...squad(12)], enemies:[unit(803,'POWER',2,60,60)], visible:(x)=>x<70 });
  search.memory.objective = '摧毁五角大楼';
  const snap = collectState(search.api, catalog), groups = candidateGroups(search.api, catalog, snap, search.memory);
  assert.equal(snap.state.forceReadiness.ready, true);
  assert.deepEqual(snap.state.objectiveTarget, { found:false, keywords:['pentagon'] });
  assert.match(groups.scouting.instructions, /^SEARCHING FOR THE OBJECTIVE \(pentagon\)/);
  assert.ok(choices(groups.scouting).length && choices(groups.scouting).every(k => /^Find the objective: /.test(groups.scouting.criteria[k])));
});

test('a sentry gun in the defense queue does not count as vehicle production', () => {
  const w = world({ own:[...home(), ...squad(8)], offers:{2:[{name:'GI',type:3}]}, queues:[{type:1,name:'SENTRY',quantity:1,creditsEach:500,creditsSpent:0}] });
  const snap = collectState(w.api, catalog);
  let r = forceReadiness(w.api, catalog, snap.state, snap.raw.army, [], w.memory);
  assert.equal(r.canBuildVehicles, false); assert.equal(r.ready, true, 'eight soldiers are the army');
  const tank = world({ own:[...home(), ...squad(8)], offers:{}, queues:[{type:3,name:'TANK',quantity:1,creditsEach:700,creditsSpent:0}] });
  const s2 = collectState(tank.api, catalog);
  r = forceReadiness(tank.api, catalog, s2.state, s2.raw.army, [], tank.memory);
  assert.equal(r.canBuildVehicles, true, 'a tank being built still counts');
});

test('after a failed attack the higher threshold drives automatic training', () => {
  const w = world({ own:[...home(), ...squad(8, 14, 14)] });
  w.memory.escalation = { level:1, changedAt:2900, reason:'test' };
  const snap = collectState(w.api, catalog), groups = candidateGroups(w.api, catalog, snap, w.memory);
  assert.equal(snap.state.forceReadiness.threshold, 12); assert.equal(snap.state.forceReadiness.ready, false);
  assert.equal(groups.infantry.actions.produce_GI.auto, 2, '8 of 12 with 25,000 credits: training is not optional');
  const calm = world({ own:[...home(), ...squad(8, 14, 14)] });
  const g2 = candidateGroups(calm.api, catalog, collectState(calm.api, catalog), calm.memory);
  assert.equal(g2.infantry.actions.produce_GI?.auto, undefined, 'at the normal threshold of 8 nothing is forced');
});

test('once ready, the force stays ready around the threshold and only drops below 75%', () => {
  const w = world({ own:home(), offers:{3:[{name:'TANK',type:7}]} });
  const state = { queues:[], airThreatCount:0, mobileAntiAirCount:0 };
  const at = (n) => { const tanks = squad(n, 30, 30, 'TANK'); return forceReadiness(w.api, catalog, state, tanks, tanks, w.memory); };
  assert.equal(at(7).ready, false);
  assert.equal(at(8).ready, true);
  for (const n of [7, 9, 7, 8, 6]) assert.equal(at(n).ready, true, `${n} tanks stay ready`);
  assert.match(at(7).reason, /still above 75% of the threshold/);
  assert.equal(at(5).ready, false, 'below 6 of 8 the force regroups');
  assert.equal(at(7).ready, false, 'and must reach the full threshold again');
  assert.equal(at(8).ready, true);
  w.memory.escalation = { level:1, changedAt:2900 };
  assert.equal(at(9).ready, false, 'a failed attack raises the bar and clears the latch');
});

test('mission clock and lock: same target keeps its clock; another attack is refused for a while', () => {
  let tick = 1000, enemies = [unit(801,'EBARR',2,62,60), unit(802,'EREF',2,64,60)];
  const api = { tick:()=>tick, units:r=>r==='self'?[]:enemies, map:{visible:()=>true} };
  const memory = {};
  const A = { type:'mission', mode:'attack', ids:[10,11], targetId:801, x:62, y:60 };
  const B = { ...A, targetId:802, x:64, y:60 };
  acceptMission(memory, A, { ids:[10,11] }, tick);
  tick = 1500; acceptMission(memory, A, { ids:[10] }, tick);
  assert.equal(memory.mission.since, 1000, 're-issuing the same target keeps the stall clock');
  assert.equal(memory.mission.issuedAt, 1500);
  tick = 1036;
  memory.missionLock.tick = 1000;
  assert.equal(missionGate(api, memory, B)?.reason, 'mission_locked');
  assert.equal(missionGate(api, memory, { ...B, mode:'rally', targetId:undefined, x:20, y:20 })?.reason, 'mission_locked', 'no turning back home either');
  assert.equal(missionGate(api, memory, A), undefined, 'the same target is fine');
  assert.equal(missionGate(api, memory, { ...B, mode:'defend' }), undefined, 'base defense breaks the lock');
  assert.equal(missionGate(api, memory, { ...B, objective:true }), undefined, 'the player objective breaks the lock');
  assert.equal(missionGate(api, memory, { ...B, mode:'retreat' }), undefined, 'retreat is always allowed');
  tick = 1000 + MISSION_LOCK_TICKS; assert.equal(missionGate(api, memory, B), undefined, 'the lock expires');
  tick = 1100; enemies = enemies.filter(e => e.id !== 801); assert.equal(missionGate(api, memory, B), undefined, 'a destroyed target releases the lock');
  tick = 1600; acceptMission(memory, B, { ids:[10] }, tick);
  assert.equal(memory.mission.since, 1600, 'a new target restarts the clock'); assert.equal(memory.missionLock.targetId, 802);
});

test('in the decision loop, alternating attack targets only executes the first one; the objective runs after two waits', async () => {
  const w = world({ own:[...home(), ...squad(12)], enemies:[unit(801,'EBARR',2,62,60), unit(802,'EREF',2,64,60)], offers:{} });
  const script = ['assault_801', 'assault_802', 'assault_801', 'assault_802'];
  let turn = 0;
  const player = await attachJevPlayer(w.api, { catalog, intervalMs:1e9, wakeIntervalMs:0, disableMicro:true, maxDecisions:50,
    requestDecision:async body => ({ answers:Object.fromEntries(Object.keys(body.groups).map(id => [id, { choice:id === 'tactics' ? script[turn] ?? 'wait' : 'wait', confidence:1 }])) }) });
  try {
    await new Promise(r => setTimeout(r, 5));
    for (turn = 1; turn < script.length; turn++) { w.setTick(3000 + turn * 36); w.api._tick({}); await new Promise(r => setTimeout(r, 5)); }
    const attacks = w.calls.filter(c => c[0] === 'attack');
    assert.deepEqual(attacks.map(c => c[2]), [801], 'the column is not turned round');
    const tactics = player.status.events.filter(e => e.kind === 'action' && e.question === 'tactics');
    assert.deepEqual(tactics.map(e => e.reason ?? 'executed'), ['executed', 'mission_locked', 'mission_continues', 'mission_locked']);
    assert.match(player.memory.recent.tactics.map(r => r.reason).join(','), /mission_locked/, 'the model sees why');
  } finally { player.stop('manual'); }
  // With an objective on offer, two turns of "wait" (or of going home to gather) execute it anyway.
  const o = world({ own:[...home(), ...squad(12)], enemies:enemyBase(), offers:{} });
  const p2 = await attachJevPlayer(o.api, { catalog, objective:'摧毁五角大楼', intervalMs:1e9, wakeIntervalMs:0, disableMicro:true, maxDecisions:50,
    requestDecision:async body => ({ answers:Object.fromEntries(Object.keys(body.groups).map(id => [id, { choice:'wait', confidence:1 }])) }) });
  try {
    await new Promise(r => setTimeout(r, 5));
    o.setTick(3036); o.api._tick({}); await new Promise(r => setTimeout(r, 5));
    const auto = p2.status.events.filter(e => e.kind === 'action' && e.auto && e.question === 'tactics');
    assert.equal(auto.length, 1); assert.equal(auto[0].choice, 'objective_990'); assert.equal(auto[0].reason, 'auto_tactics');
    assert.ok(o.calls.some(c => c[0] === 'attack' && c[2] === 990), 'the army is sent at the Pentagon');
    assert.equal(p2.memory.mission.targetId, 990);
  } finally { p2.stop('manual'); }
});

test('a unit shot from beyond its reach closes in with its neighbours, or falls back when it cannot hurt the shooter', () => {
  const pill = unit(920,'PILL',2,55,50);
  const conscript = unit(30,'GI',3,50,50,{isIdle:false}), buddy = unit(31,'GI',3,47,50,{isIdle:false});
  const w = world({ own:[...home(), conscript, buddy], enemies:[pill, unit(700,'EGI',3,46,53)] });
  w.memory.orders = new Map([[30, { tick:2990, targetId:700 }]]);
  const events = [];
  respondToThreats(w.api, catalog, w.memory, e => events.push(e), [conscript, buddy], w.enemies);
  assert.deepEqual(w.calls, [['attack', [30, 31], 920]], 'the conscript (range 4) and its neighbour go for the pillbox (range 5.5) 5 tiles away');
  assert.match(events[0].description, /#30 受到 Pill Box #920 射程外攻击，2 个单位抵近还击/);
  w.setTick(3000 + THREAT_REPLY_TICKS - 1);
  respondToThreats(w.api, catalog, w.memory, e => events.push(e), [conscript, buddy], w.enemies);
  assert.equal(w.calls.length, 1, 'no new order during the cooldown');
  w.setTick(3000 + THREAT_REPLY_TICKS);
  respondToThreats(w.api, catalog, w.memory, e => events.push(e), [conscript, buddy], w.enemies);
  assert.equal(w.calls.length, 2, 'after the cooldown it may answer again');
  // A conscript cannot hurt a tank: it steps out of the tank's range instead.
  const lone = unit(40,'GI',3,20,30), tank = unit(701,'TANK',7,25,30);
  const t = world({ own:[...home(), lone], enemies:[tank] });
  respondToThreats(t.api, catalog, t.memory, e => events.push(e), [lone], [tank]);
  assert.deepEqual(t.calls, [['move', [40], 16, 30]], 'back to 9 tiles from a range-6 tank');
  assert.match(events.at(-1).description, /打不动它，后撤到 \(16,30\)/);
  // Wired into the regular micro loop.
  const m = world({ own:[...home(), unit(30,'GI',3,50,50,{isIdle:false})], enemies:[unit(920,'PILL',2,55,50)] });
  const micro = [];
  maintainBattle(m.api, catalog, m.memory, e => micro.push(e));
  assert.ok(m.calls.some(c => c[0] === 'attack' && c[2] === 920)); assert.ok(micro.some(e => e.reply === 'close_in'));
});

test('engage_visible only offers enemies near the troops and says where they are', () => {
  const far = world({ own:[...home(), ...squad(12)], enemies:[unit(700,'EGI',3,62,40)] });
  let groups = candidateGroups(far.api, catalog, collectState(far.api, catalog), far.memory);
  assert.ok(!groups.tactics.actions.engage_visible, `more than ${ENGAGE_RADIUS} tiles away`);
  const near = world({ own:[...home(), ...squad(12)], enemies:[unit(700,'EGI',3,50,40)] });
  groups = candidateGroups(near.api, catalog, collectState(near.api, catalog), near.memory);
  assert.equal(groups.tactics.actions.engage_visible.targetId, 700);
  assert.match(groups.tactics.criteria.engage_visible, /^Engage GI #700 at \(50,40\), 8 tiles from our 11 troops/);
});

test('the defense question is asked only while the base is threatened', () => {
  const calm = world({ own:[...home(), ...squad(4, 14, 14)], offers:{1:[{name:'SENTRY',type:2}],2:[{name:'GI',type:3}]} });
  let groups = candidateGroups(calm.api, catalog, collectState(calm.api, catalog), calm.memory);
  assert.equal(groups.defenses, undefined);
  const raided = world({ own:[...home(), ...squad(4, 14, 14)], enemies:[unit(700,'TANK',7,18,18)], offers:{1:[{name:'SENTRY',type:2}],2:[{name:'GI',type:3}]} });
  groups = candidateGroups(raided.api, catalog, collectState(raided.api, catalog), raided.memory);
  assert.ok(groups.defenses, 'under attack the question is back');
});
