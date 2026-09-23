import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {build} from 'esbuild';

// Keep the real page/content adapter code, replace only the separately tested game player.
const playerStub = `export const collectState=()=>({raw:{},state:{}}); export async function attachJevPlayer(api, options) {
  const controller = new AbortController(), status = {running:true};
  const player = {status, stop(reason) {if(!status.running)return; status.running=false; controller.abort(); options.onEvent({kind:'stop',reason});},
    decide: body => options.requestDecision(body,{signal:controller.signal})};
  api.instances.push(player); options.onEvent({kind:'start'}); return player;
}`;
const pageBuild = await build({entryPoints:['src/page.mjs'],bundle:true,format:'iife',write:false,plugins:[{name:'test-player',setup(b){b.onLoad({filter:/werhd-jev-player\.mjs$/},()=>({contents:playerStub,loader:'js'}));}}]});
const pageSource=pageBuild.outputFiles[0].text,contentSource=await fs.readFile('dist/content.js','utf8');
function world() {
  const listeners=new Map(),sent=[],intervals=new Map();let intervalId=0,contentListener,resolveDecision;
  const window={addEventListener:(type,fn)=>{const list=listeners.get(type)??[];list.push(fn);listeners.set(type,list);},removeEventListener:(type,fn)=>listeners.set(type,(listeners.get(type)??[]).filter(f=>f!==fn))};
  const deliver=(data,origin='https://ra2web.github.io')=>{for(const fn of listeners.get('message')??[])fn({data,origin,source:window});};
  window.postMessage=data=>queueMicrotask(()=>deliver(data));
  const api={instances:[],me:()=>({combatant:true}),tick:()=>100,rules(){},order(){}};window.werhd=api;
  const common={window,location:{origin:'https://ra2web.github.io'},crypto,DOMException,AbortController,setTimeout,clearTimeout,setInterval:fn=>{intervals.set(++intervalId,fn);return intervalId;},clearInterval:id=>intervals.delete(id)};
  const page=vm.createContext({...common}),content=vm.createContext({...common,document:{addEventListener(){}},chrome:{runtime:{onMessage:{addListener:fn=>{contentListener=fn;}},sendMessage:async message=>{
    sent.push(message);if(message.type==='PUBLIC_CONFIG')return {ok:true,value:{hotkey:'Alt+Shift+J',showOverlay:false}};
    if(message.type==='DECIDE')return new Promise(resolve=>{resolveDecision=resolve;});return {ok:true,value:{}};
  }}}});
  vm.runInContext(contentSource,content);vm.runInContext(pageSource,page);
  return {window,api,sent,intervals,deliver,bind:token=>contentListener({type:'BIND_SESSION',token},{},()=>{}),resolve:value=>resolveDecision(value),inject:()=>vm.runInContext(pageSource,page)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('page/content round trip relays choices, rejects forged responses and never receives credentials',async()=>{
  const x=world();x.bind('session-A');
  await x.window.__werhdJevExtension.start({token:'session-A'});
  const pending=x.api.instances[0].decide({state:{tick:100},groups:{tactics:{criteria:{wait:'Wait'}}}});
  let resolved=false;pending.then(()=>{resolved=true;});await flush();
  assert.equal(x.sent.filter(m=>m.type==='DECIDE').length,1);
  x.deliver({channel:'werhd-jev-extension-v1',direction:'to-page',token:'wrong',id:'wrong',ok:true,value:{}});await flush();assert.equal(resolved,false);
  x.resolve({ok:true,value:{answers:{tactics:{choice:'wait'}}}});
  assert.equal((await pending).answers.tactics.choice,'wait');
  assert.doesNotMatch(JSON.stringify(x.sent),/apiKey|Authorization|Bearer/);
  x.window.__werhdJevExtension.dispose();
});
test('stop aborts a pending page request; reinjection is idempotent and replacement sessions stop old players',async()=>{
  const x=world();x.bind('session-A');await x.window.__werhdJevExtension.start({token:'session-A'});
  x.inject();await x.window.__werhdJevExtension.start({token:'session-A'});assert.equal(x.api.instances.length,1);
  const pending=x.api.instances[0].decide({state:{tick:100},groups:{}});const rejected=assert.rejects(pending,{name:'AbortError'});await flush();
  x.window.__werhdJevExtension.stop();await rejected;x.resolve({ok:true,value:{late:true}});await flush();
  x.bind('session-B');await x.window.__werhdJevExtension.start({token:'session-B'});
  x.bind('session-C');await x.window.__werhdJevExtension.start({token:'session-C'});
  assert.equal(x.api.instances[1].status.running,false);assert.equal(x.api.instances[2].status.running,true);
  x.window.werhd={...x.api};for(const fn of x.intervals.values())fn();
  assert.equal(x.api.instances[2].status.running,false);x.window.__werhdJevExtension.dispose();
});
test('lobby and observer pages fail before attaching a player',async()=>{
  const x=world();x.window.werhd=undefined;assert.equal((await x.window.__werhdJevExtension.start({token:'session'})).available,false);
  x.window.werhd={...x.api,me:()=>({combatant:true,isObserver:true})};assert.equal((await x.window.__werhdJevExtension.start({token:'session'})).running,false);
  assert.equal(x.api.instances.length,0);x.window.__werhdJevExtension.dispose();
});
