import {collectState} from './player/werhd-jev-player.mjs';
import {assessStrategy} from './player/werhd-jev-strategy.mjs';
import {summarize} from './telemetry.mjs';
// Read-only monitoring is demand-driven by an open popup; no player, orders or model calls.
export function createObserver(getApi, id = () => crypto.randomUUID()) {
  let previous, battleId, catalog={}, memory={}, lastTick=-1;
  return () => {
    const api=getApi();
    try {
      if(!api)return {available:false};
      const self=api.me();
      if(!self?.combatant || self.isObserver || self.defeated)return {available:false};
      const tick=api.tick();
      if(api!==previous || tick<lastTick){previous=api;battleId=id();catalog={};memory={};}
      lastTick=tick;
      const snap=collectState(api,catalog);
      assessStrategy(api,catalog,snap,memory);
      return {available:true,battleId,snapshot:summarize(snap.state)};
    } catch {return {available:false};}
  };
}
