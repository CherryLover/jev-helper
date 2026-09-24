import {DEFAULTS,validateSettings,originPattern,hotkeyFromEvent} from './shared.mjs';
import {importSettings} from './import-settings.mjs';
import {t,errorText,messages,officialWebsiteUrl} from './i18n.mjs';
import {drawChart,drawPositions} from './charts.mjs';
const $=id=>document.getElementById(id);
let tabId,config={...DEFAULTS,hasKey:false},lastStatus,dirty=false,refreshing=false,activePanel='battlefield',noticeState;
const tr=(key,vars)=>t(config.language,key,vars);
const providerName=()=>config.providerName||'Jev';
const selectedProvider=()=>$('provider-local').getAttribute('aria-checked')==='true'?'local':'jev';
const rpc=async message=>{const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw new Error(r?.error||'插件后台未响应。');return r.value;};
const format=n=>typeof n==='number'&&Number.isFinite(n)?Math.round(n).toLocaleString(config.language):'—';
function notice(text,success=false,key,vars){noticeState={text,success,key,vars};$('notice').textContent=key?tr(key,vars):errorText(config.language,text);$('notice').classList.toggle('success',success);$('notice').hidden=!text&&!key;}
const notify=(key,success=false,vars)=>notice('',success,key,vars);
function translate(){
 document.documentElement.lang=config.language;document.title=tr('title');
 for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=tr(e.dataset.i18n);
 $('lang-en').setAttribute('aria-pressed',config.language==='en');$('lang-zh').setAttribute('aria-pressed',config.language!=='en');
 $('official-site').href=officialWebsiteUrl(config.language);$('official-site').title=tr('officialWebsiteHint');
 $('help-link').href=`help.html?lang=${config.language}`;
 keyPlaceholder();showProvider(selectedProvider());
 if(noticeState)notice(noticeState.text,noticeState.success,noticeState.key,noticeState.vars);
 if(lastStatus)displayStatus(lastStatus);
}
function keyPlaceholder(){$('api-key').placeholder=tr(config.hasKey?'keySaved':'keyEmpty');$('local-key').placeholder=tr(config.hasLocalKey?'localKeySaved':'localKeyEmpty');$('clear-key').hidden=!(selectedProvider()==='local'?config.hasLocalKey:config.hasKey);}
// Only the selected source's fields are shown; both sets stay saved.
function showProvider(provider){
 for(const btn of document.querySelectorAll('[data-provider]'))btn.setAttribute('aria-checked',btn.dataset.provider===provider);
 for(const id of ['jev','local']){$(`fields-${id}`).hidden=id!==provider;$(`advanced-${id}`).hidden=id!==provider;}
 $('provider-hint').textContent=tr(provider==='local'?'providerLocalHint':'providerJevHint');
 $('clear-key').hidden=!(provider==='local'?config.hasLocalKey:config.hasKey);
}
function displayConfig(){
 $('api-base').value=config.apiBase;$('model').value=config.model;$('local-base').value=config.localBase;$('local-model').value=config.localModel;showProvider(config.provider);$('hotkey').value=config.hotkey;$('budget').value=config.maxDecisions;$('auto-camera').checked=config.autoCamera;$('show-overlay').checked=config.showOverlay;keyPlaceholder();
}
function renderAwareness(s){
 const o=s.observation;$('awareness').hidden=!o;$('no-battle').hidden=!!o;
 const live=s.liveObservation&&o&&Date.now()-o.at<6000;
 $('freshness').textContent=o?tr(live?'live':'stale'):'';$('freshness').classList.toggle('live',!!live);
 if(!o)return;
 $('threat').className=`threat ${o.threat}`;$('threat-title').textContent=tr(o.threat);$('threat-detail').textContent=tr(o.threat==='clear'?'clearDetail':'pressureDetail');
 $('range-warning').hidden=!o.rangeThreats.length;$('range-warning').textContent=tr('rangeWarning',{n:o.rangeThreats.length});
 for(const [id,value] of [['army',o.army],['enemies',o.visibleEnemies],['nearby',o.nearbyEnemies],['miners',o.harvesters],['anti-air',o.antiAir]])$(id).textContent=format(value);
 $('health').textContent=o.health===null?'—':`${Math.round(o.health*100)}%`;
 const known=o.power.total!==null&&o.power.drain!==null,low=known&&o.power.total<o.power.drain;
 $('power').textContent=`${format(o.power.total)} / ${format(o.power.drain)}`;$('power-state').textContent=known?tr(low?'lowPower':'powerOK'):'—';$('power-state').classList.toggle('low',low);
 drawPositions($('position-map'),o,config.language);
 const items=o.queues.flatMap(q=>q.items);
 const label=kind=>config.language==='en'?kind:o.inventory.find(u=>u.kind===kind)?.label||kind;
 $('queues').replaceChildren(...items.map(i=>{const li=document.createElement('li'),name=document.createElement('span'),progress=document.createElement('progress'),value=document.createElement('span');name.textContent=`${label(i.name)} × ${i.quantity}`;progress.max=1;progress.value=Math.max(0,Math.min(1,i.progress??0));progress.setAttribute('aria-label',name.textContent);value.textContent=i.progress===null?'—':`${Math.round(progress.value*100)}%`;li.append(name,progress,value);return li;}));
 if(!items.length){const li=document.createElement('li');li.textContent=tr('queueEmpty');$('queues').append(li);}
 $('inventory').replaceChildren(...o.inventory.map(u=>{const tag=document.createElement('span');tag.textContent=`${label(u.kind)} × ${u.count}`;return tag;}));
}
function renderCharts(s){
 drawChart($('decision-chart'),s.history??[],[{key:'decisions',label:'decisionLegend',color:'#d9b76f'}],config.language,tr('decisionChart'));
 drawChart($('economy-chart'),s.history??[],[{key:'credits',label:'creditsLegend',color:'#d9b76f'},{key:'freeCredits',label:'freeLegend',color:'#91cbb1'}],config.language,tr('economyChart'));
 $('accepted').textContent=tr('accepted',{n:s.acceptedActions??0});$('waits').textContent=tr('waits',{n:s.waits??0});
}
function eventText(e){
 if(config.language!=='en')return e.text;
 const key=`event_${e.kind}`,name=tr(messages[key]?key:'event_other');
 if(e.kind==='action')return `${name} · ${e.choice||e.actionType||''} · ${tr(e.reason==='wait'?'waitLabel':e.accepted?'acceptedLabel':'skippedLabel')}`;
 if(e.kind==='stop'&&messages[e.reason])return `${name} · ${tr(e.reason)}`;
 return `${name}${e.choice?' · '+e.choice:''}`;
}
function displayStatus(s){
 lastStatus=s;$('status').textContent=tr(s.running?'running':s.error||s.reason?'stopped':s.supported?'ready':'switchGame',{name:s.providerName||providerName()});$('dot').classList.toggle('on',s.running);
 $('game').textContent=config.language==='en'?tr(s.supported?'game':'switchGame'):s.title||tr('switchGame');$('tick').textContent=s.lastTick!=null?`TICK ${s.lastTick}`:'';
 $('decisions').textContent=format(s.decisions??0);$('credits').textContent=format(s.credits);$('latency').textContent=s.latencyMs!=null?`${format(s.latencyMs)}ms`:'—';
 $('mission').textContent=s.running?(config.language==='en'?tr('thinking'):s.mission||tr('thinking')):tr(messages[s.reason]?s.reason:'idleMission',{name:providerName()});
 $('start').disabled=!s.supported||s.running||dirty;$('stop').disabled=!s.running;$('failures').textContent=s.failures?tr('failures',{n:s.failures}):'';
 $('events').replaceChildren(...(s.events??[]).slice(0,8).map(e=>{const li=document.createElement('li');li.textContent=`${new Date(e.at).toLocaleTimeString(config.language,{hour12:false})} · ${eventText(e)}`;return li;}));
 if(!s.events?.length){const li=document.createElement('li');li.textContent=tr('noEvents');$('events').append(li);}
 if(activePanel==='battlefield')renderAwareness(s);if(activePanel==='trends')renderCharts(s);
 if(s.error)notice(s.error);
}
async function refresh(){if(tabId===undefined||refreshing)return;refreshing=true;try{displayStatus(await rpc({type:'GET_STATUS',tabId}));}finally{refreshing=false;}}
for(const btn of document.querySelectorAll('[data-panel]'))btn.addEventListener('click',()=>{
 activePanel=btn.dataset.panel;
 for(const other of document.querySelectorAll('[data-panel]')){const on=other===btn;other.setAttribute('aria-pressed',on);$(`panel-${other.dataset.panel}`).hidden=!on;}
 if(lastStatus)displayStatus(lastStatus);
});
for(const [id,language]of [['lang-zh','zh-CN'],['lang-en','en']])$(id).addEventListener('click',async()=>{
 try{await rpc({type:'SET_LANGUAGE',language});config.language=language;translate();}catch(e){notice(e.message);}
});
for(const btn of document.querySelectorAll('[data-provider]'))btn.addEventListener('click',()=>{if(selectedProvider()===btn.dataset.provider)return;showProvider(btn.dataset.provider);dirty=true;if(lastStatus)displayStatus(lastStatus);});
$('import-config').addEventListener('click',()=>$('config-file').click());
$('config-file').addEventListener('change',async()=>{
 try{
  const file=$('config-file').files[0];if(!file)return;if(file.size>65536)throw new Error('配置文件过大，请仅保留 Jev 配置。');
  const imported=importSettings(await file.text());validateSettings({...config,...imported});$('api-key').value=imported.apiKey;
  if(imported.apiBase)$('api-base').value=imported.apiBase;if(imported.model)$('model').value=imported.model;
  dirty=true;$('start').disabled=true;notify('imported',true);
 }catch(e){notice(e.message);}finally{$('config-file').value='';}
});
$('test-connection').addEventListener('click',async()=>{
 if(dirty){notify('saveFirst');return;}$('test-connection').disabled=true;notify('testing',false,{name:providerName()});
 try{const result=await rpc({type:'TEST_CONNECTION'});notify('tested',true,{name:result.providerName||providerName(),ms:result.latencyMs,model:result.model?` · ${result.model}`:''});}catch(e){notice(e.message);}finally{$('test-connection').disabled=false;}
});
$('show-overlay').addEventListener('change',async()=>{
 const input=$('show-overlay');input.disabled=true;
 try{const result=await rpc({type:'SET_OVERLAY',showOverlay:input.checked});config.showOverlay=result.showOverlay;notify(config.showOverlay?'overlayEnabled':'overlayDisabled',true);}
 catch(e){input.checked=config.showOverlay;notice(e.message);}finally{input.disabled=false;}
});
$('settings').addEventListener('input',e=>{if(e.target.id==='show-overlay')return;dirty=true;if(lastStatus)displayStatus(lastStatus);});
$('hotkey').addEventListener('keydown',e=>{if(e.key==='Tab')return;e.preventDefault();const value=hotkeyFromEvent(e);if(value){$('hotkey').value=value;dirty=true;$('start').disabled=true;notify('hotkeyChanged',true);}});
$('settings').addEventListener('submit',async e=>{
 e.preventDefault();
 try{
  const input={language:config.language,provider:selectedProvider(),apiKey:$('api-key').value.trim(),apiBase:$('api-base').value,model:$('model').value,localKey:$('local-key').value.trim(),localBase:$('local-base').value,localModel:$('local-model').value,hotkey:$('hotkey').value,autoCamera:$('auto-camera').checked,showOverlay:$('show-overlay').checked,maxDecisions:Number($('budget').value)};validateSettings(input);
  if(!await chrome.permissions.request({origins:[originPattern(input.provider==='local'?input.localBase:input.apiBase)]}))throw new Error('未获得 API 访问授权，设置未保存。');
  config=await rpc({type:'SAVE_SETTINGS',settings:input});$('api-key').value='';$('local-key').value='';dirty=false;displayConfig();notify('saved',true);await refresh();
 }catch(error){notice(error.message);}
});
$('clear-key').addEventListener('click',async()=>{try{const provider=selectedProvider();await rpc({type:'CLEAR_KEY',provider});if(provider==='local'){config.hasLocalKey=false;$('local-key').value='';}else{config.hasKey=false;$('api-key').value='';}keyPlaceholder();notify('keyCleared',true);await refresh();}catch(e){notice(e.message);}});
for(const [id,type]of [['start','START'],['stop','STOP']])$(id).addEventListener('click',async()=>{
 $(id).disabled=true;notice('');try{await rpc({type,tabId});await refresh();}catch(e){notice(e.message);$(id).disabled=false;}
});
try{config=await rpc({type:'GET_SETTINGS'});translate();displayConfig();const [tab]=await chrome.tabs.query({active:true,currentWindow:true});tabId=tab?.id;await refresh();}catch(e){notice(e.message);$('status').textContent=tr('connectionFailed');}
const timer=setInterval(()=>refresh().catch(e=>{if(lastStatus)displayStatus({...lastStatus,liveObservation:false});notice(e.message);}),1500);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
