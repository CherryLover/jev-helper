import test from 'node:test';
import assert from 'node:assert/strict';
import {apiEndpoint,originPattern,validateSettings,publicSettings,normalizeHotkey,hotkeyFromEvent,prepareQuestions,validateAnswer,supportedGame} from '../src/shared.mjs';
test('API configuration accepts a base/full endpoint, confines plaintext to loopback and strips no secret into public settings',()=>{
  assert.equal(apiEndpoint('https://api.typesafe.ai/v1/'),'https://api.typesafe.ai/v1/systemone');
  assert.equal(apiEndpoint('https://example.test/proxy/systemone'),'https://example.test/proxy/systemone');
  assert.equal(originPattern('http://127.0.0.1:8742/v1'),'http://127.0.0.1/*');
  for(const bad of ['http://example.com/v1','https://secret@example.com/v1','https://example.com/?key=secret','file:///tmp/api','https://example.com/#x'])assert.throws(()=>apiEndpoint(bad));
  assert.equal('apiKey' in publicSettings(validateSettings({apiKey:'test-only-secret'})),false);
  assert.equal(supportedGame('https://ra2web.github.io/'),true);assert.equal(supportedGame('https://ra2web.github.io.evil.test/'),false);
});
test('custom keyboard chord uses physical keys and exact modifiers',()=>{
  assert.equal(normalizeHotkey('alt+SHIFT+j'),'Alt+Shift+J');
  assert.equal(hotkeyFromEvent({code:'KeyJ',altKey:true,shiftKey:true,key:'Ô'}),'Alt+Shift+J');
  assert.equal(hotkeyFromEvent({code:'KeyJ',metaKey:true}),'Meta+J');
  for(const bad of ['J','Shift+J','Bogus+J','Ctrl+Bogus+J'])assert.throws(()=>normalizeHotkey(bad));
});
test('Jev results are constrained to the submitted candidate set',()=>{
  const questions=prepareQuestions({state:{tick:1},groups:{tactics:{instructions:'Select',criteria:{wait:'Wait',attack:'Attack'}}}});
  assert.throws(()=>validateAnswer({answers:{tactics:{type:'choice',choice:'sell_everything'}}},questions));
  assert.throws(()=>validateAnswer({answers:{}},questions));
  const result=validateAnswer({answers:{tactics:{type:'choice',choice:'attack'},injected:{choice:'bad'}},apiKey:'malicious'},questions);
  assert.deepEqual(Object.keys(result.answers),['tactics']);assert.equal('apiKey' in result,false);
  assert.throws(()=>prepareQuestions({state:{},groups:Object.fromEntries(Array.from({length:9},(_,i)=>['x'+i,{}]))}));
});
