import test from 'node:test';
import assert from 'node:assert/strict';
import {importSettings} from '../src/import-settings.mjs';
test('local import only reads Jev settings and treats unrelated secrets and expressions as data',()=>{
  assert.deepEqual(importSettings(`UNRELATED_SECRET=must-not-import\nexport JEV_API_KEY="test-key" # comment\nJEV_BASE_URL=https://api.typesafe.ai/v1\nJEV_MODEL='jev-latest'\n`),{apiKey:'test-key',apiBase:'https://api.typesafe.ai/v1',model:'jev-latest'});
  assert.equal(importSettings('JEV_API_KEY=$(do-not-execute)').apiKey,'$(do-not-execute)');
  for(const bad of ['UNRELATED_SECRET=x','JEV_API_KEY="unterminated','x'.repeat(65537)])assert.throws(()=>importSettings(bad));
});
