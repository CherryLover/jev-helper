import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackground} from '../src/background-core.mjs';
import {DEFAULTS} from '../src/shared.mjs';

const extension={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
const sender={id:'test-extension',frameId:0,documentId:'document-1',url:'https://staging.wangerhuoda.com/',tab:{id:7}};
const body={state:{tick:100},groups:{tactics:{instructions:'Choose',criteria:{wait:'Wait',attack:'Attack'}}}};
function mockChrome(shared){
  const data=shared??{local:{settings:{...DEFAULTS,apiKey:'test-only-secret'}},session:{}};
  const messages=[],scripts=[],listeners={};
  const area=name=>({setAccessLevel:async x=>{listeners[name+'Access']=x;},get:async key=>structuredClone(key===null?data[name]:{[key]:data[name][key]}),set:async values=>Object.assign(data[name],structuredClone(values)),remove:async key=>{delete data[name][key];}});
  const c={storage:{local:area('local'),session:area('session')},runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener:fn=>{listeners.message=fn;}}},permissions:{contains:async()=>true},tabs:{get:async()=>({id:7,url:sender.url,title:'王二火大'}),query:async()=>[{id:7,url:sender.url}],sendMessage:async(id,m)=>{messages.push(m);return {ok:true};},onUpdated:{addListener:fn=>{listeners.updated=fn;}},onRemoved:{addListener:fn=>{listeners.removed=fn;}}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},scripting:{executeScript:async x=>{scripts.push(x);return [{documentId:sender.documentId,result:x.args?.[0]==='start'?{running:true}:x.args?.[0]==='stop'?{running:false}:{available:true,running:!!data.session['session:7']?.running}}];}}};
  return {c,data,messages,scripts,listeners};
}
const answer=()=>new Response(JSON.stringify({answers:{tactics:{type:'choice',choice:'attack',confidence:.8}},model:'jev-test',usage:{input_tokens:40,output_tokens:8}}));
async function setup(fetchImpl,shared){const mock=mockChrome(shared);const app=createBackground(mock.c,{fetchImpl,uuid:()=>crypto.randomUUID()});await app.ready;await app.handle({type:'START',tabId:7},extension);const s=await app.getSession(7);return {...mock,app,s,request:{type:'DECIDE',token:s.token,body}};}

test('settings and key operations reject content scripts; injection and status never expose the key',async()=>{
  const x=await setup(async()=>answer());
  assert.equal(x.listeners.localAccess.accessLevel,'TRUSTED_CONTEXTS');
  for(const type of ['GET_SETTINGS','SAVE_SETTINGS','CLEAR_KEY','START'])await assert.rejects(x.app.handle({type,tabId:7},sender));
  const settings=await x.app.handle({type:'GET_SETTINGS'},extension);assert.equal(settings.hasKey,true);assert.equal(settings.apiKey,undefined);
  const status=await x.app.handle({type:'GET_STATUS',tabId:7},extension);assert.equal(status.token,undefined);
  assert.doesNotMatch(JSON.stringify([x.messages,x.scripts]),/test-only-secret/);
});
test('background pins configured endpoint and authenticates tab, origin, frame, document and session',async()=>{
  let request;const x=await setup(async(url,options)=>{request={url,options};return answer();});
  for(const other of [{...sender,documentId:'old-document'},{...sender,frameId:1},{...sender,url:'https://evil.test/'},{...sender,tab:{id:8}}])await assert.rejects(x.app.handle(x.request,other));
  await assert.rejects(x.app.handle({...x.request,token:'wrong'},sender));
  const result=await x.app.handle({...x.request,url:'https://evil.test',body:{...body,url:'https://evil.test'}},sender);
  assert.equal(request.url,'https://api.typesafe.ai/v1/systemone');assert.equal(request.options.headers.Authorization,'Bearer test-only-secret');
  assert.equal(request.options.redirect,'error');assert.equal(result.answers.tactics.choice,'attack');
  assert.equal(JSON.parse(request.options.body).questions.tactics.type,'choice');
});
test('simultaneous requests are refused and stop rejects a late response',async()=>{
  let release,signal;const x=await setup(async(_url,options)=>{signal=options.signal;return new Promise(resolve=>{release=()=>resolve(answer());});});
  const first=x.app.handle(x.request,sender);while(!release)await new Promise(r=>setTimeout(r,0));
  await assert.rejects(x.app.handle(x.request,sender),/尚未完成/);
  await x.app.handle({type:'STOP',tabId:7},extension);assert.equal(signal.aborted,true);release();
  await assert.rejects(first,/已停止/);assert.equal((await x.app.getSession(7)).decisions,0);
});
test('a 402 stops immediately with a useful error and prevents further upstream requests',async()=>{
  let count=0;const x=await setup(async()=>{count++;return new Response('',{status:402});});
  await assert.rejects(x.app.handle(x.request,sender),/HTTP 402/);
  const s=await x.app.getSession(7);assert.equal(s.running,false);assert.equal(s.reason,'http_402');assert.equal(s.failures,1);
  await assert.rejects(x.app.handle(x.request,sender));assert.equal(count,1);
});
test('session budget survives worker restart and observations cannot overwrite counters',async()=>{
  const x=await setup(async()=>answer());x.data.session['session:7'].maxDecisions=1;
  await Promise.all([x.app.handle(x.request,sender),x.app.handle({type:'EVENT',token:x.s.token,event:{kind:'observation',tick:101,credits:200}},sender)]);
  assert.equal((await x.app.getSession(7)).requests,1);assert.equal((await x.app.getSession(7)).credits,200);
  const next=mockChrome(x.data),restarted=createBackground(next.c,{fetchImpl:async()=>{throw Error('must not run');}});
  await assert.rejects(restarted.handle(x.request,sender),/上限/);
  assert.equal((await restarted.getSession(7)).running,false);
  assert.equal((await restarted.getSession(7)).reason,'decision_budget');
});
test('saving another API origin requires a new key; changing credentials stops the old session',async()=>{
  const x=await setup(async()=>answer());
  await assert.rejects(x.app.handle({type:'SAVE_SETTINGS',settings:{apiBase:'https://custom.example/v1'}},extension),/重新输入/);
  await x.app.handle({type:'SAVE_SETTINGS',settings:{apiBase:'https://custom.example/v1',apiKey:'custom-test-key'}},extension);
  assert.equal((await x.app.getSession(7)).running,false);assert.equal(x.data.local.settings.apiKey,'custom-test-key');
});
test('invalid candidates never reach the executor; navigation revokes the session',async()=>{
  const x=await setup(async()=>new Response(JSON.stringify({answers:{tactics:{type:'choice',choice:'not-supplied'}}})));
  await assert.rejects(x.app.handle(x.request,sender),/未提供/);
  assert.equal((await x.app.getSession(7)).decisions,0);
  x.listeners.updated(7,{status:'loading'});await new Promise(r=>setTimeout(r,0));
  await assert.rejects(x.app.handle(x.request,sender),/失效/);
});
test('connection probe is trusted-only, bounded, and does not create a game session',async()=>{
  const x=mockChrome();let calls=0,body;
  const app=createBackground(x.c,{fetchImpl:async(url,options)=>{calls++;body=JSON.parse(options.body);assert.equal(url,'https://api.typesafe.ai/v1/systemone');return new Response(JSON.stringify({answers:{connection:{type:'choice',choice:'ok'}}}));}});
  await assert.rejects(app.handle({type:'TEST_CONNECTION'},sender));assert.equal(calls,0);
  const result=await app.handle({type:'TEST_CONNECTION'},extension);
  assert.ok(result.latencyMs>=0);assert.equal(calls,1);assert.equal(body.state.purpose,'extension_connection_check');
  assert.deepEqual(Object.keys(body.questions.connection.criteria),['ok']);assert.equal(await app.getSession(7),undefined);
  const failure=createBackground(x.c,{fetchImpl:async()=>new Response('do-not-echo-upstream-body',{status:402})});
  await assert.rejects(failure.handle({type:'TEST_CONNECTION'},extension),/HTTP 402/);
});

test('popup monitoring is read-only and bounded, persists across worker restart, and detects a new battle',async()=>{
 const x=mockChrome();let upstream=0,battleId='battle-A',available=true;
 const snapshot={at:0,tick:100,gameSeconds:10,credits:5000,freeCredits:4000};
 const original=x.c.scripting.executeScript;
 x.c.scripting.executeScript=async args=>args.args?.[0]==='observe'?[{documentId:sender.documentId,result:{available,battleId,snapshot}}]:original(args);
 const app=createBackground(x.c,{fetchImpl:async()=>{upstream++;throw Error('monitor must not fetch');}});
 await assert.rejects(app.handle({type:'GET_STATUS',tabId:7},sender));
 let status=await app.handle({type:'GET_STATUS',tabId:7},extension);
 assert.equal(status.running,false);assert.equal(status.liveObservation,true);assert.equal(status.observation.credits,5000);assert.equal(status.history.length,1);assert.equal(upstream,0);
 const restarted=createBackground(x.c,{fetchImpl:async()=>assert.fail('monitor fetched')});
 status=await restarted.handle({type:'GET_STATUS',tabId:7},extension);assert.equal(status.history.length,1);
 available=false;status=await app.handle({type:'GET_STATUS',tabId:7},extension);assert.equal(status.liveObservation,false);assert.equal(status.observation.credits,5000);
 available=true;battleId='battle-B';snapshot.gameSeconds=0;status=await app.handle({type:'GET_STATUS',tabId:7},extension);assert.equal(status.history.length,1);assert.equal(status.decisions,0);
 assert.ok(!x.scripts.some(s=>s.args?.[0]==='start'));assert.equal(upstream,0);
});
test('language changes preserve a running session and credentials and are trusted-only',async()=>{
 const x=await setup(async()=>answer());
 await assert.rejects(x.app.handle({type:'SET_LANGUAGE',language:'en'},sender));
 const result=await x.app.handle({type:'SET_LANGUAGE',language:'en'},extension);
 assert.deepEqual(result,{language:'en'});assert.equal(x.data.local.settings.apiKey,'test-only-secret');assert.equal((await x.app.getSession(7)).running,true);
 assert.equal(x.messages.at(-1).language,'en');assert.doesNotMatch(JSON.stringify(result),/test-only-secret/);
});
