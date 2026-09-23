import assert from "node:assert/strict";
import {
  findVisibleOre,
  executeCandidate,
  collectState,
  candidateGroups,
  attachJevPlayer,
} from "../src/player/werhd-jev-player.mjs";

const calls = [];
let self = { credits: 1000, defeated: false, isObserver: false };
let own = [
  {
    id: 1,
    name: "TANK",
    type: 7,
    tile: { rx: 10, ry: 10 },
    primaryWeapon: {},
    isIdle: true,
  },
];
let enemy = [{ id: 9, name: "ENEMY", type: 7, tile: { rx: 15, ry: 15 } }];
let queue = { type: 3, size: 0, items: [] };
const api = {
  me: () => self,
  units: (relation) => (relation === "enemy" ? enemy : own),
  inRange: () => false,
  tick: () => 100,
  time: () => 10,
  ObjectType: { Building: 2, Infantry: 3, Vehicle: 7 },
  production: {
    available: () => [{ name: "TANK", type: 7 }],
    queues: () => [queue],
  },
  produce: (name) => calls.push(["produce", name]),
  attack: (ids, id) => calls.push(["attack", ids, id]),
  move: (...args) => calls.push(["move", ...args]),
  map: {
    tile: () => undefined,
    visible: () => false,
    size: () => ({ width: 30, height: 30 }),
  },
};
const action = { type: "attack", ids: [1], targetId: 9 };
enemy = [];
assert.equal(
  executeCandidate(api, action, {}).reason,
  "enemy_no_longer_visible",
);
enemy = [{ id: 9 }];
own = [];
assert.equal(executeCandidate(api, action, {}).reason, "unit_gone");
const produce = { type: "produce", name: "TANK", queue: 3, cost: 750 };
queue.size = 1;
assert.equal(executeCandidate(api, produce, {}).reason, "queue_changed");
queue.size = 0;
self.credits = 200;
assert.equal(executeCandidate(api, produce, {}).reason, "production_changed");
self.credits = 1000;
self.defeated = true;
assert.equal(executeCandidate(api, produce, {}).reason, "not_commandable");
self.defeated = false;
assert.equal(
  executeCandidate(api, { type: "invented" }, {}).reason,
  "unknown_action",
);
assert.deepEqual(calls, []);
assert.equal(executeCandidate(api, produce, {}).accepted, true);
queue.size = 1;
assert.equal(executeCandidate(api, produce, {}).accepted, false);
assert.deepEqual(calls, [["produce", "TANK"]]);
enemy = [];
const snapshot = collectState(api, {});
assert.deepEqual(snapshot.state.visibleEnemies, []);
const groups = candidateGroups(api, {}, snapshot, {
  visited: new Set(),
  lastCombatTick: 0,
  lastScoutTick: 0,
});
assert.ok(Object.values(groups).every((g) => g.actions.wait.type === "wait"));
assert.ok(
  Object.values(groups).every(
    (g) => !Object.keys(g.actions).some((id) => id.startsWith("attack_")),
  ),
);
const frontierApi = {
  ...api,
  map: {
    size: () => ({ width: 30, height: 30 }),
    tile: (x, y) =>
      x === 2 && y === 2 ? { rx: x, ry: y, landType: 0 } : undefined,
    visible: (x, y) => x === 2 && y === 2,
  },
};
const strandedScout = {
  id: 1,
  name: "TANK",
  type: 7,
  tile: { rx: 15, ry: 15 },
  isIdle: true,
  primaryWeapon: {},
};
const frontierSnapshot = {
  ...snapshot,
  raw: { ...snapshot.raw, army: [strandedScout], units: [strandedScout] },
};
const frontierGroups = candidateGroups(frontierApi, {}, frontierSnapshot, {
  visited: new Set(),
  scoutId: 1,
  lastCombatTick: 0,
  lastScoutTick: 0,
});
assert.ok(
  Object.values(frontierGroups.scouting.actions).some(
    (a) =>
      a.type === "mission" && a.mode === "explore" && a.x === 2 && a.y === 2,
  ),
  "a scout with no local destinations must get another visible frontier",
);
// A casualty between snapshot and response must not discard surviving troops' orders.
own = [{ id: 1 }];
enemy = [{ id: 9 }];
assert.equal(
  executeCandidate(api, { ...action, ids: [1, 2] }, {}).accepted,
  true,
);
assert.deepEqual(calls.pop(), ["attack", [1], 9]);
assert.ok(
  !groups.tactics.actions.regroup,
  "healthy troops must not receive a retreat candidate",
);
// Deploy is a toggle: recheck posture and never toggle an already-deployed unit.
api.deploy = (ids) => {
  calls.push(["deploy", ids]);
  return true;
};
own = [
  { id: 1, canDeploy: true, isDeployed: true },
  { id: 2, canDeploy: true, isDeployed: false },
  { id: 3 },
];
assert.equal(
  executeCandidate(
    api,
    { type: "set_deployed", deployed: true, ids: [1, 2, 3] },
    {},
  ).accepted,
  true,
);
assert.deepEqual(calls.pop(), ["deploy", [2]]);
assert.equal(
  executeCandidate(
    api,
    { type: "set_deployed", deployed: true, ids: [1, 3] },
    {},
  ).reason,
  "deployment_state_changed",
);
assert.equal(
  executeCandidate(
    api,
    { type: "set_deployed", deployed: false, ids: [1, 2] },
    {},
  ).accepted,
  true,
);
assert.deepEqual(calls.pop(), ["deploy", [1]]);
const gi = {
  id: 1,
  name: "GI",
  type: 3,
  canDeploy: true,
  isDeployed: false,
  hitPoints: 125,
  maxHitPoints: 125,
  tile: { rx: 10, ry: 10 },
  primaryWeapon: {},
  isIdle: true,
};
const giCatalog = {
  GI: {
    deployer: true,
    weapon: { damage: 15, rof: 20, range: 4 },
    secondary: { damage: 15, rof: 15, range: 5 },
  },
};
own = [gi];
enemy = [{ id: 9, type: 7, tile: { rx: 14, ry: 10 }, primaryWeapon: {} }];
let postureGroups = candidateGroups(
  api,
  giCatalog,
  collectState(api, giCatalog),
  {},
);
assert.deepEqual(postureGroups.deployment.actions.deploy_combat.ids, [1]);
gi.isDeployed = true;
postureGroups = candidateGroups(
  api,
  giCatalog,
  collectState(api, giCatalog),
  {},
);
assert.equal(postureGroups.deployment.actions.deploy_combat, undefined);
enemy = [];
postureGroups = candidateGroups(api, giCatalog, collectState(api, giCatalog), {
  mission: { ids: [1], x: 25, y: 25, since: 100 },
});
assert.deepEqual(postureGroups.deployment.actions.undeploy_mobile.ids, [1]);
// Do not buy a fourth miner while the second refinery already supplies the third.
const economyCatalog = {
  YARD: { yard: true },
  REF: { refinery: true },
  WF: { factory: "UnitType" },
  BARRACKS: { factory: "InfantryType" },
  MINER: { harvester: true, cost: 1400 },
  TANK: { category: "AFV", cost: 750, weapon: { damage: 65, range: 5 } },
  IFV: {
    category: "Transport",
    cost: 600,
    weapon: { damage: 25, range: 6, aa: true },
  },
  GI: { cost: 180, weapon: { damage: 15, range: 4 } },
  ENGINEER: { cost: 500, engineer: true, weapon: { damage: 0, range: 1 } },
};
const economyUnits = [
  "YARD",
  "REF",
  "WF",
  "BARRACKS",
  "MINER",
  "MINER",
  "TANK",
  "TANK",
  "TANK",
  "TANK",
  "GI",
].map((name, i) => ({
  id: i + 1,
  name,
  type: i < 4 ? 2 : name === "GI" ? 3 : 7,
  tile: { rx: 10, ry: 10 },
  hitPoints: 100,
  maxHitPoints: 100,
  primaryWeapon: i >= 6 ? {} : undefined,
}));
const economyApi = {
  ...api,
  me: () => ({ credits: 5000, power: { total: 200, drain: 100 } }),
  units: (r) => (r === "self" ? economyUnits : []),
  production: {
    queues: () => [
      {
        type: 0,
        size: 1,
        items: [
          { name: "REF", quantity: 1, creditsEach: 2000, creditsSpent: 1000 },
        ],
      },
      { type: 3, size: 0, items: [] },
      { type: 2, size: 0, items: [] },
    ],
    available: (q) =>
      (q === 3
        ? ["MINER", "TANK", "IFV"]
        : q === 2
          ? ["GI", "ENGINEER"]
          : []
      ).map((name) => ({ name })),
  },
};
const economyGroups = candidateGroups(
  economyApi,
  economyCatalog,
  collectState(economyApi, economyCatalog),
  {},
);
assert.equal(economyGroups.vehicles.actions.produce_MINER, undefined);
assert.ok(
  economyGroups.vehicles.actions.produce_IFV,
  "armor needs anti-air escorts",
);
assert.ok(
  economyGroups.vehicles.actions.produce_TANK,
  "keep tank production available before an air threat is observed",
);
assert.ok(economyGroups.infantry.actions.produce_GI);
assert.equal(economyGroups.infantry.actions.produce_ENGINEER, undefined);
// Transport is injected by the extension; exercise lifecycle without HTTP or credentials.
queue.size = 0;
own = [];
enemy = [];
api.QueueType = { Structures: 0, Armory: 1 };
const catalog = { TANK: { label: "Tank", cost: 750, speed: 5, primary: "Cannon", power: 100 } };
let finish, entered;
const pending = new Promise(resolve => { entered = resolve; });
const player = await attachJevPlayer(api, {
  catalog, intervalMs: 10, disableMicro: true,
  requestDecision: async (_body, {signal}) => {
    entered();
    return new Promise(resolve => { finish = () => {
      assert.equal(signal.aborted, true);
      resolve({ answers: { construction: { choice: "produce_TANK" } } });
    }; });
  },
});
await pending;
player.stop();
finish();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(player.status.running, false);
assert.equal(player.status.accepted, 0);
assert.deepEqual(calls, [["produce", "TANK"]], "late responses must not issue commands");

let tick = 100, staleResolve;
api.tick = () => tick;
const staleDone = new Promise(resolve => { staleResolve = resolve; });
const stalePlayer = await attachJevPlayer(api, {
  catalog, intervalMs: 10, disableMicro: true,
  requestDecision: async () => { tick = 1000; return { answers: { construction: { choice: "produce_TANK" } } }; },
  onEvent: event => { if (event.kind === "stale") staleResolve(); },
});
await staleDone;
stalePlayer.stop();
assert.equal(stalePlayer.status.rejected, 1);
assert.equal(stalePlayer.status.accepted, 0);
assert.deepEqual(calls, [["produce", "TANK"]], "stale snapshots must not issue commands");

let ended = false, endedResolve;
const endEvents = [];
api.tick = () => { if (ended) throw new Error("werhd is not available outside a running battle"); return 100; };
const endDone = new Promise(resolve => { endedResolve = resolve; });
const endedPlayer = await attachJevPlayer(api, {
  catalog, intervalMs: 10, disableMicro: true,
  requestDecision: async () => { ended = true; return { answers: { construction: { choice: "produce_TANK" } } }; },
  onEvent: event => { endEvents.push(event); if (event.kind === "stop") endedResolve(); },
});
await endDone;
assert.equal(endedPlayer.status.running, false);
assert.equal(endedPlayer.status.failures, 0);
assert.ok(endEvents.some(e => e.kind === "stop" && e.reason === "battle_ended"));
assert.ok(!endEvents.some(e => e.kind === "error"));
assert.deepEqual(calls, [["produce", "TANK"]]);
console.log(
  "Jev deployment/economy and guards passed: stale targets/snapshots, cancellation, missing units, changed queues/funds, defeat, unknown actions and fog.",
);

const oreApi = { map: { size: () => ({ width: 5, height: 5 }),
  tile: (x, y) => x === 3 && y === 2 ? { rx: x, ry: y, landType: 9 } : undefined } };
assert.deepEqual(findVisibleOre(oreApi, { rx: 2, ry: 2 }), { rx: 3, ry: 2, landType: 9 });
assert.equal(findVisibleOre({ map: { ...oreApi.map, tile: () => undefined } }, { rx: 2, ry: 2 }), undefined,
  'unrevealed ore cannot become a gather target');
