import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayMonitor,clampPosition} from '../src/overlay.mjs';

function harness(){
  let status={running:false,showOverlay:true},view,reads=0,pending;
  const timers=new Set();
  const monitor=createOverlayMonitor({
    rpc:async message=>{assert.equal(message.type,'OVERLAY_STATUS');reads++;return pending?pending():structuredClone(status);},
    createView:()=>{assert.equal(view,undefined);view={render(s,c){this.status=s;this.config=c;},destroy(){view=undefined;}};return view;},
    schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn),
  });
  return {monitor,timers,get view(){return view;},get reads(){return reads;},state:s=>{status={...status,...s};},pending:fn=>{pending=fn;}};
}

test('floating status requires both active control and opt-in, across start/stop and setting changes',async()=>{
  const x=harness();await x.monitor.refresh();assert.equal(x.view,undefined);assert.equal(x.timers.size,0);
  x.state({running:true,decisions:3});await x.monitor.changed(true);assert.equal(x.view.status.decisions,3);assert.equal(x.timers.size,1);
  await x.monitor.configure({showOverlay:false});assert.equal(x.view,undefined);assert.equal(x.timers.size,0);
  const before=x.reads;await x.monitor.changed(true);assert.equal(x.reads,before);assert.equal(x.view,undefined);
  await x.monitor.changed(false);x.state({running:false});await x.monitor.configure({showOverlay:true});assert.equal(x.view,undefined);
  x.state({running:true});await x.monitor.changed(true);assert.ok(x.view);
  x.monitor.changed(false);assert.equal(x.view,undefined);assert.equal(x.timers.size,0);
  x.monitor.dispose();
});

test('late status cannot resurrect the window after stop, opt-out, tab hiding or disposal',async()=>{
  for(const action of [x=>x.changed(false),x=>x.configure({showOverlay:false}),x=>x.setActive(false),x=>x.dispose()]){
    const x=harness();x.state({running:true});await x.monitor.refresh();assert.ok(x.view);
    let resolve;x.pending(()=>new Promise(r=>{resolve=r;}));const pending=x.monitor.refresh();
    action(x.monitor);assert.equal(x.view,undefined);
    resolve({running:true,showOverlay:true});await pending;assert.equal(x.view,undefined);assert.equal(x.timers.size,0);x.monitor.dispose();
  }
});

test('status polling stops when idle, hidden or disconnected; visibility restoration checks fresh state',async()=>{
  const x=harness();x.state({running:true});await x.monitor.refresh();assert.ok(x.view);
  await x.monitor.configure({language:'en'});assert.equal(x.view.config.language,'en');assert.equal(x.timers.size,1);
  await x.monitor.setActive(false);assert.equal(x.view,undefined);assert.equal(x.timers.size,0);
  x.state({running:false});await x.monitor.setActive(true);assert.equal(x.view,undefined);assert.equal(x.timers.size,0);
  x.state({running:true});await x.monitor.changed(true);assert.ok(x.view);
  x.pending(()=>Promise.reject(Error('Extension context invalidated')));await [...x.timers][0]();
  assert.equal(x.view,undefined);assert.equal(x.timers.size,0);x.monitor.dispose();
});

test('re-enabling display waits for current status instead of showing the previous session',async()=>{
  const x=harness();x.state({running:true});await x.monitor.refresh();await x.monitor.configure({showOverlay:false});
  let resolve;x.pending(()=>new Promise(r=>{resolve=r;}));const update=x.monitor.configure({showOverlay:true});assert.equal(x.view,undefined);
  resolve({running:false,showOverlay:true});await update;assert.equal(x.view,undefined);x.monitor.dispose();
});

test('drag placement remains inside normal and small viewports',()=>{
  assert.deepEqual(clampPosition({x:900,y:-30},282,150,800,600),{x:510,y:8});
  assert.deepEqual(clampPosition({x:400,y:500},282,150,240,100),{x:8,y:8});
});
