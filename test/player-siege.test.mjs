import test from 'node:test';
import assert from 'node:assert/strict';
import { specialGroups, SIEGE_RANGE } from '../src/player/werhd-jev-special.mjs';
import { collectState, candidateGroups, historyHints, rememberChoice, MIN_ATTACK_UNITS } from '../src/player/werhd-jev-player.mjs';

// From four real matches (0.5.6): a road with a pillbox on each side; infantry only ever entered
// houses at home, one pillbox was attacked over and over, survivors were fed in one at a time, and
// the "recent answers" hint never fired because a few enemies died each time.
const catalog = {
  YARD:{yard:true,label:'YARD'}, BARRACKS:{factory:'InfantryType',label:'BARRACKS',cost:500},
  E2:{occupier:true,cost:100,weapon:{damage:15,range:4},label:'Conscript'},
  PILL:{isBaseDefense:true,weapon:{damage:40,range:5},label:'Pill Box',cost:500}, HOUSE:{label:'House'}, EPOWER:{power:200,label:'Power Plant',cost:800},
};
const unit = (id,name,type,x,y,extra={}) => ({ id,name,type,tile:{rx:x,ry:y},hitPoints:100,maxHitPoints:100,isIdle:true,primaryWeapon:catalog[name].weapon,...extra });
const house = (id,x,y) => unit(id,'HOUSE',2,x,y,{garrison:{count:0,capacity:5,canOccupy:true}});
function world({ own, enemies = [], neutral = [], credits = 5000, tick = 5000, offers = {2:[{name:'E2',type:3}]} }) {
  const all = () => [...own, ...enemies, ...neutral];
  const api = {
    ObjectType:{Building:2,Vehicle:7,Infantry:3,Aircraft:1}, QueueType:{Structures:0,Armory:1,Infantry:2,Vehicles:3,Aircrafts:4,Ships:5}, OrderType:{Move:1,Attack:2,Capture:7,Occupy:8,Repair:9,DeploySelected:10,Stop:11}, LandType:{Clear:0}, ZoneType:{Air:1,Water:2},
    units:r=>r==='self'?own:r==='enemy'?enemies:r==='allied'?[]:[...enemies,...neutral], unit:id=>all().find(u=>u.id===id),
    me:()=>({credits,power:{total:500,drain:100},combatant:true,defeated:false,isObserver:false}), tick:()=>tick, time:()=>tick/15, players:()=>[],
    map:{size:()=>({width:120,height:120}),visible:()=>true,tile:(x,y)=>({rx:x,ry:y,landType:0})}, canPlace:()=>true,
    production:{queues:()=>Array.from({length:6},(_,type)=>({type,size:0,maxSize:99,items:[]})),available:q=>q===undefined?Object.values(offers).flat():(offers[q]??[])},
    weaponVs:()=>undefined, inRange:()=>false, attack(){}, move(){}, attackMove(){}, deploy:()=>true, order:()=>true, produce(){}, gather(){}, repair(){}, onTick(){}, offTick(){},
  };
  const memory = { frontiers:new Map(), enemyBuildings:new Map(), orders:new Map(), postureOrders:new Map(), specialOrders:new Map(), specialTargets:new Map(), plannedSites:new Map(), observedSpecial:new Map(), repairing:new Set(), lastMaintenance:tick, lastMicroReport:-1000 };
  return { api, memory };
}
const squad = (n, x = 60, y = 60) => Array.from({length:n}, (_, i) => unit(30 + i, 'E2', 3, x + (i % 4), y + Math.floor(i / 4)));
const road = () => ({ enemies:[unit(500,'PILL',2,70,50), unit(501,'PILL',2,80,50), unit(502,'EPOWER',2,90,20)], neutral:[house(600,70,56), house(601,80,56), house(602,12,12)] });

test('each pillbox on the road gets its own siege option from a building within reach', () => {
  const own=[unit(1,'YARD',2,10,10), unit(2,'BARRACKS',2,12,10), ...squad(6)];
  const { enemies, neutral } = road();
  const w=world({ own, enemies, neutral });
  const groups={}; specialGroups(w.api, catalog, collectState(w.api, catalog), w.memory, groups);
  const g=groups.garrison;
  assert.ok(g.actions.siege_600 && g.actions.siege_601, 'one siege option per pillbox, both sides of the road');
  assert.match(g.criteria.siege_600, /^SIEGE Pill Box #500 at \(70,50\): garrison 4 infantry into building #600 at \(70,56\), 6 tiles from it \(its weapon range 5\)/);
  assert.equal(g.actions.siege_600.order.type, 8); assert.equal(g.actions.siege_600.auto, undefined);
  assert.ok(6 <= SIEGE_RANGE);
  assert.ok(!g.actions.occupy_602, 'no home strongpoint without a threat and with only six infantry');
});

test('when attacks are failing, siege becomes a priority with an automatic fallback', () => {
  const own=[unit(1,'YARD',2,10,10), ...squad(6)];
  const w=world({ own, ...road() });
  const snapshot=collectState(w.api, catalog); snapshot.state.combatAssessment={level:1,staleAttack:false};
  const groups={}; specialGroups(w.api, catalog, snapshot, w.memory, groups);
  assert.match(groups.garrison.criteria.siege_600, /^PRIORITY SIEGE .*attacks in the open are failing/);
  assert.equal(groups.garrison.actions.siege_600.auto, 2);
});

test('home strongpoints are offered when the base is threatened or infantry is plentiful', () => {
  const plenty=world({ own:[unit(1,'YARD',2,10,10), ...squad(9, 14, 14)], neutral:[house(602,12,12)] });
  let groups={}; specialGroups(plenty.api, catalog, collectState(plenty.api, catalog), plenty.memory, groups);
  assert.ok(groups.garrison.actions.occupy_602);
  const threatened=world({ own:[unit(1,'YARD',2,10,10), ...squad(4, 14, 14)], neutral:[house(602,12,12)] });
  const snapshot=collectState(threatened.api, catalog); snapshot.state.nearbyEnemyCount=2;
  groups={}; specialGroups(threatened.api, catalog, snapshot, threatened.memory, groups);
  assert.ok(groups.garrison.actions.occupy_602);
});

test('assault options list the headline targets plus every nearby defense, and a handful of units does not attack', () => {
  const own=[unit(1,'YARD',2,10,10), unit(2,'BARRACKS',2,12,10), ...squad(10)];
  const w=world({ own, enemies:[unit(502,'EPOWER',2,90,20), unit(503,'EPOWER',2,95,20), unit(500,'PILL',2,70,50), unit(501,'PILL',2,80,50)] });
  w.memory.forceProgress={count:10,tick:0};
  const snapshot=collectState(w.api, catalog); const groups=candidateGroups(w.api, catalog, snapshot, w.memory);
  assert.equal(snapshot.state.forceReadiness.ready, true);
  for (const id of [500, 501, 502, 503]) assert.ok(groups.tactics.actions[`assault_${id}`], `assault_${id}`);
  const few=world({ own:[unit(1,'YARD',2,10,10), unit(2,'BARRACKS',2,12,10), ...squad(MIN_ATTACK_UNITS - 1)], enemies:[unit(500,'PILL',2,70,50)] });
  few.memory.forceProgress={count:MIN_ATTACK_UNITS - 1,tick:0};
  const s2=collectState(few.api, catalog); const g2=candidateGroups(few.api, catalog, s2, few.memory);
  assert.equal(s2.state.forceReadiness.ready, false); assert.ok(!g2.tactics.actions.assault_500);
});

test('a repeated choice that loses more than it kills is marked stale even when it kills a few', () => {
  const memory={ ledger:{ownUnitsLost:0,ownBuildingsLost:0,enemyUnitsDestroyed:0,enemyBuildingsDestroyed:0} };
  for (let i = 0; i < 4; i++) { rememberChoice(memory, 'tactics', 'assault_1593', {accepted:true}, i * 100); memory.ledger.ownUnitsLost += 3; memory.ledger.enemyUnitsDestroyed += 1; }
  const groups={ tactics:{ instructions:'Choose.', criteria:{wait:'Wait', assault_1593:'Assault the yard', engage_visible:'Engage'}, actions:{wait:{}, assault_1593:{}, engage_visible:{}} } };
  const out=historyHints(groups, memory, {}, {level:0});
  assert.equal(out.tactics.stale, true); assert.equal(out.tactics.lostSince, 12); assert.equal(out.tactics.killedSince, 4);
  assert.match(groups.tactics.criteria.assault_1593, /^STALE ×4/);
  assert.match(groups.tactics.instructions, /we lost 12 and destroyed 4/);
});

test('after six losing repeats the choice is removed for a turn, whatever the model does with hints', () => {
  const memory={ ledger:{ownUnitsLost:0,ownBuildingsLost:0,enemyUnitsDestroyed:0,enemyBuildingsDestroyed:0} };
  for (let i = 0; i < 6; i++) { rememberChoice(memory, 'tactics', 'engage_visible', {accepted:true}, i * 100); memory.ledger.ownUnitsLost += 2; }
  const groups={ tactics:{ instructions:'Choose.', criteria:{wait:'Wait', assault_1593:'Assault', engage_visible:'Engage'}, actions:{wait:{}, assault_1593:{}, engage_visible:{}} } };
  const out=historyHints(groups, memory, {}, {level:0});
  assert.equal(out.tactics.removed, true); assert.ok(!groups.tactics.actions.engage_visible); assert.ok(groups.tactics.actions.assault_1593);
  const defend={ tactics:{ instructions:'Choose.', criteria:{wait:'Wait', defend_base:'Defend', engage_visible:'Engage'}, actions:{wait:{}, defend_base:{}, engage_visible:{}} } };
  const m2={ ledger:{ownUnitsLost:0,ownBuildingsLost:0,enemyUnitsDestroyed:0,enemyBuildingsDestroyed:0} };
  for (let i = 0; i < 6; i++) { rememberChoice(m2, 'tactics', 'defend_base', {accepted:true}, i * 100); m2.ledger.ownUnitsLost += 2; }
  historyHints(defend, m2, {}, {level:3}); assert.ok(defend.tactics.actions.defend_base, 'defending the base is never removed');
});
