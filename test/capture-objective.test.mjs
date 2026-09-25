import test from 'node:test';
import assert from 'node:assert/strict';
import { collectState, candidateGroups, RICH_SPEND } from '../src/player/werhd-jev-player.mjs';
import { parseObjective, matchesCapture, isGuardedByObjective } from '../src/player/werhd-jev-objective.mjs';
import { catalog, T, u, infantry, world, home, brief } from './commander-world.mjs';

// 0.7.2 report (Laya, "使用工程师占领盟军战略实验室", defeat): "占领" was read as "protect", so the
// objective was never found although the Allied Battle Lab stood in view all game; no engineer was
// sent for it; it was even offered as an assault target, and the mission was lost when it fell.
// Meanwhile the model answered "wait" to a Rhino tank 251 times and credits rose to 14,000.
catalog.GATECH = { label: 'Allied Battle Lab', armor: 'wood', cost: 2000, techLevel: 3 };
catalog.NAWEAP = { factory: 'UnitType', label: 'Soviet War Factory', armor: 'heavy', cost: 2000 };
const TEXT = '使用工程师占领盟军战略实验室';
const lab = () => u(1470, 'GATECH', T.Building, 101, 27);
const labBase = () => [lab(), u(1434, 'GACNST', T.Building, 107, 18), u(1467, 'GAPILL', T.Building, 99, 30)];
const engineer = (id = 60, x = 101, y = 117) => u(id, 'SENGINEER', T.Infantry, x, y);
const tanks = (from, n) => Array.from({ length: n }, (_, i) => u(from + i, 'HTNK', T.Vehicle, 95 + i, 60));
const groupsOf = (x, objective = TEXT) => { x.memory.objective = objective; const snap = collectState(x.api, catalog); return { snap, groups: candidateGroups(x.api, catalog, snap, x.memory) }; };

test('"占领 / capture" names a building to take, not one to protect or destroy', () => {
  for (const text of [TEXT, 'Capture the Allied Battle Lab with an engineer', '夺取战略实验室']) {
    const p = parseObjective(text);
    assert.deepEqual(p.words, [], `${text}: nothing to destroy`);
    assert.ok(p.capture.includes('battle lab'), `${text}: the battle lab is a capture target`);
    assert.equal(matchesCapture(text, catalog.GATECH, 'GATECH'), 'name');
    assert.ok(isGuardedByObjective(text, catalog.GATECH, 'GATECH'), 'and it is never attacked');
    assert.ok(!isGuardedByObjective(text, catalog.GACNST, 'GACNST'), 'the yard next to it still is');
  }
  const mixed = parseObjective('摧毁建造厂，占领实验室，保护兵营');
  assert.deepEqual(mixed.words, ['construction yard']);
  assert.deepEqual(mixed.capture, ['battle lab', 'laboratory']);
  assert.ok(mixed.guarded.includes('barracks') && mixed.guarded.includes('battle lab'));
});

test('the Battle Lab is the capture objective: never an assault, engineers go for it first even defended', () => {
  const x = world({ own: [...home(), ...tanks(10, 8), engineer()], enemies: labBase(), credits: 4000 });
  const { snap, groups } = groupsOf(x);
  assert.deepEqual({ id: snap.state.objectiveTarget.id, mode: snap.state.objectiveTarget.mode }, { id: 1470, mode: 'capture' });
  const tactics = Object.keys(groups.tactics.criteria);
  assert.ok(!tactics.includes('assault_1470') && !tactics.includes('objective_1470'), 'the lab is never an attack option');
  assert.ok(tactics.includes('assault_1467'), 'the pillbox guarding it is');
  assert.ok(tactics.indexOf('assault_1467') < tactics.indexOf('assault_1434'), 'and comes before the yard');
  assert.match(groups.tactics.instructions, /CAPTURE target: Allied Battle Lab #1470 .*never attack it/);
  const capture = groups.engineering?.actions.capture_1470;
  assert.ok(capture, 'the engineer is offered the lab although a pillbox stands next to it');
  assert.equal(Object.keys(groups.engineering.criteria).filter((k) => k !== 'wait')[0], 'capture_1470', 'first');
  assert.match(groups.engineering.criteria.capture_1470, /^MISSION OBJECTIVE CAPTURE/);
  assert.equal(capture.auto, 3, 'defended: automatic after three declines');
  x.enemies.splice(x.enemies.findIndex((e) => e.id === 1467), 1);
  const calm = groupsOf(x).groups;
  assert.equal(calm.engineering.actions.capture_1470.auto, 1, 'undefended: automatic after one decline');
});

test('with no engineer, one is trained for the objective even when money is short', () => {
  const x = world({ own: [...home(), ...tanks(10, 8)], enemies: labBase(), credits: 900 });
  const { groups } = groupsOf(x);
  const train = groups.infantry?.actions.produce_SENGINEER;
  assert.ok(train, 'an engineer is offered with 900 credits');
  assert.equal(train.auto, 1);
  assert.match(groups.infantry.criteria.produce_SENGINEER, /^MISSION OBJECTIVE: train an engineer to capture Allied Battle Lab #1470/);
});

test('the capture objective ends as captured when the lab becomes ours, or as lost when it is destroyed', () => {
  const taken = world({ own: [...home(), ...tanks(10, 8), engineer()], enemies: labBase() });
  groupsOf(taken);
  const ours = taken.enemies.splice(0, 1)[0]; taken.self.push(ours);
  let s = groupsOf(taken).snap.state;
  assert.equal(taken.memory.objectiveTarget.captured, true); assert.equal(taken.memory.objectiveTarget.lost, undefined);
  const lost = world({ own: [...home(), ...tanks(10, 8), engineer()], enemies: labBase() });
  groupsOf(lost);
  lost.enemies.splice(0, 1);
  const { snap, groups } = groupsOf(lost);
  assert.equal(snap.state.objectiveTarget.lost, true);
  assert.match(groups.tactics.instructions, /Allied Battle Lab was destroyed; the capture failed/);
});

test('buildings the objective says to protect are not assault targets either', () => {
  const x = world({ own: [...home(), ...tanks(10, 8)], enemies: [u(1434, 'GACNST', T.Building, 107, 18), u(1600, 'GAPILE', T.Building, 100, 20)] });
  const { groups } = groupsOf(x, '摧毁建造厂，保护兵营');
  const keys = Object.keys(groups.tactics.criteria);
  assert.ok(keys.includes('objective_1434'));
  assert.ok(!keys.includes('assault_1600'), 'the barracks we were told to protect is not attacked');
});

test('commander mode: the lab is a legal capture and never a legal attack target', () => {
  const x = world({ own: [...home(), ...tanks(10, 8), engineer()], enemies: labBase() });
  const b = brief(x, TEXT);
  assert.equal(b.objective.target.mode, 'capture');
  assert.ok(b.legal.captures.includes(1470), 'the engineer may capture it although it is defended');
  assert.ok(!b.legal.attackTargets.includes(1470), 'no squad may attack it');
  assert.ok(b.legal.attackTargets.includes(1467) && b.legal.attackTargets.includes(1434));
});

test('money piling up while the model waits: a combat unit is trained anyway; not below the threshold', () => {
  const offers = [{ name: 'HTNK', type: 7, queue: 3 }, { name: 'HARV', type: 7, queue: 3 }, { name: 'E2', type: 3, queue: 2 }, { name: 'SENGINEER', type: 3, queue: 2 }];
  const own = () => [...home(), u(4, 'NAWEAP', T.Building, 108, 122), u(5, 'NAREFN', T.Building, 92, 118), u(6, 'HARV', T.Vehicle, 90, 110), u(7, 'HARV', T.Vehicle, 91, 110), ...tanks(10, 6)];
  const rich = world({ own: own(), enemies: [u(1434, 'GACNST', T.Building, 107, 18)], credits: 14000, offers });
  let { groups } = groupsOf(rich, '');
  const produce = Object.entries(groups.vehicles?.actions ?? {}).find(([k]) => k !== 'wait');
  assert.ok(produce, 'a vehicle is offered');
  assert.equal(catalog[produce[1].name].harvester, undefined, 'a combat vehicle, not a miner');
  assert.equal(produce[1].auto, 2, '14,000 credits: automatic after two declines');
  const modest = world({ own: own(), enemies: [u(1434, 'GACNST', T.Building, 107, 18)], credits: RICH_SPEND - 1000, offers });
  ({ groups } = groupsOf(modest, ''));
  for (const [k, a] of Object.entries(groups.vehicles?.actions ?? {})) if (k !== 'wait') assert.equal(a.auto, undefined, `${k}: left to the model below ${RICH_SPEND}`);
});
