import {DEFAULTS, supportedGame, apiEndpoint, originPattern, validateSettings, publicSettings, prepareQuestions, validateAnswer, httpError} from './shared.mjs';
import {summarize,recordObservation} from './telemetry.mjs';

export function createBackground(c, {fetchImpl = fetch, now = Date.now, uuid = () => crypto.randomUUID()} = {}) {
  const inflight = new Map(), controlLocks = new Map(), stateLocks = new Map();
  let probing=false;
  const ready = Promise.all([
    c.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
    c.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  ]);
  const key = tabId => `session:${tabId}`;
  const getSession = async tabId => (await c.storage.session.get(key(tabId)))[key(tabId)];
  const getSettings = async () => ({...DEFAULTS,...(await c.storage.local.get('settings')).settings});
  function serial(map, id, task) {
    const next = (map.get(id) ?? Promise.resolve()).catch(()=>{}).then(task);
    map.set(id,next); next.finally(()=>{if(map.get(id)===next)map.delete(id);}).catch(()=>{});
    return next;
  }
  async function patch(tabId, mutate) {
    return serial(stateLocks,tabId,async()=>{const next=mutate(await getSession(tabId));if(next)await c.storage.session.set({[key(tabId)]:next});else await c.storage.session.remove(key(tabId));return next;});
  }
  const badge = async (tabId,text,color='#d1a653') => {
    await Promise.all([c.action.setBadgeText({tabId,text}),c.action.setBadgeBackgroundColor({tabId,color})]).catch(()=>{});
  };
  const pageCall = async (tabId, method, value, documentId) => {
    const [r] = await c.scripting.executeScript({
      target:{tabId,...(documentId?{documentIds:[documentId]}:{frameIds:[0]})},world:'MAIN',
      func: async (method,value) => {
        const p=window.__werhdJevExtension;
        if(!p || typeof p[method]!=='function')return {running:false,available:false,missing:true};
        return p[method](value);
      },args:[method,value],
    });
    return r?.result;
  };
  async function stop(tabId, reason='manual') {
    inflight.get(tabId)?.abort();
    const s=await patch(tabId,s=>s?{...s,running:false,busyUntil:0,reason,updatedAt:now()}:undefined);
    if(s)await pageCall(tabId,'stop',reason,s.documentId).catch(()=>{});
    await badge(tabId,'');
    return {running:false,reason};
  }
  function trustExtension(sender) {
    return !sender.tab && sender.id === c.runtime.id && sender.url?.startsWith(c.runtime.getURL(''));
  }
  async function authorize(sender, token) {
    if(sender.id!==c.runtime.id || sender.frameId!==0 || !sender.tab || !supportedGame(sender.url))throw new Error('不接受此页面的请求。');
    const s=await getSession(sender.tab.id);
    if(!s?.running || s.token!==token || s.documentId!==sender.documentId || s.origin!==new URL(sender.url).origin)throw new Error('托管会话已失效。');
    return s;
  }
  async function start(tabId) {
    const tab=await c.tabs.get(tabId);
    if(!supportedGame(tab.url))throw new Error('请先切换到王二火大的游戏标签页。');
    const config=validateSettings(await getSettings());
    if(!config.apiKey)throw new Error('请先填写并保存 JEV 密钥。');
    if(!await c.permissions.contains({origins:[originPattern(config.apiBase)]}))throw new Error('请在插件中保存设置，授权访问所填 API 地址。');
    const old=await getSession(tabId);
    if(old?.running) {
      const live=await pageCall(tabId,'status',null,old.documentId).catch(()=>null);
      if(live?.running)return live;
      await stop(tabId,'stale_session');
    }
    const [injection]=await c.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',files:['content.js']});
    const documentId=injection.documentId;
    await c.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',files:['page.js']});
    const status=await pageCall(tabId,'status',null,documentId);
    if(!status?.available)throw new Error(status?.error || '请先进入一场正在运行的对局，再开启托管。');
    const session={tabId,token:uuid(),documentId,origin:new URL(tab.url).origin,running:true,startedAt:now(),updatedAt:now(),requests:0,decisions:0,failures:0,inputTokens:0,outputTokens:0,busyUntil:0,events:[],reason:'',error:'',maxDecisions:config.maxDecisions};
    await patch(tabId,()=>session);
    try {
      await c.tabs.sendMessage(tabId,{type:'BIND_SESSION',token:session.token},{documentId});
      const result=await pageCall(tabId,'start',{token:session.token,maxDecisions:config.maxDecisions,autoCamera:config.autoCamera},documentId);
      if(!result?.running)throw new Error(result?.error || '托管未能启动。');
      await badge(tabId,'ON');
      return result;
    } catch(e) { await stop(tabId,'start_failed');throw e; }
  }
  async function decide(message,sender) {
    const tabId=sender.tab?.id;
    const questions=prepareQuestions(message.body);
    const auth=await authorize(sender,message.token);
    const config=await getSettings();
    // URL and credentials are read exclusively from trusted extension settings.
    const endpoint=apiEndpoint(config.apiBase);
    if(!await c.permissions.contains({origins:[originPattern(endpoint)]}))throw new Error('API 访问权限已被撤销，请重新保存设置。');
    try { await patch(tabId,s=>{
      if(!s?.running || s.token!==auth.token)throw new Error('托管会话已停止。');
      if(s.busyUntil>now() || inflight.has(tabId))throw new Error('上一条决策尚未完成。');
      if(s.requests>=s.maxDecisions)throw Object.assign(new Error('已达到本局决策上限，托管已停止。'),{code:'DECISION_BUDGET'});
      return {...s,requests:s.requests+1,busyUntil:now()+12000};
    }); } catch(e) {
      if(e.code==='DECISION_BUDGET')await stop(tabId,'decision_budget');
      throw e;
    }
    const abort=new AbortController();inflight.set(tabId,abort);
    const timeout=setTimeout(()=>abort.abort(),8000),started=now();
    try {
      const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,state:message.body.state,questions}),signal:abort.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok){const error=new Error(httpError(response.status));error.status=response.status;throw error;}
      const raw=await response.text();if(raw.length>256000)throw new Error('Jev 响应过大，已拒绝处理。');
      const result={...validateAnswer(JSON.parse(raw),questions),latencyMs:now()-started};
      await authorize(sender,message.token);
      await patch(tabId,s=>s?.token===auth.token?{...s,decisions:s.decisions+1,inputTokens:s.inputTokens+result.usage.input_tokens,outputTokens:s.outputTokens+result.usage.output_tokens,latencyMs:result.latencyMs,lastTick:message.body.state.tick,lastChoices:Object.fromEntries(Object.entries(result.answers).map(([id,a])=>[id,a.choice])),error:'',updatedAt:now()}:s);
      return result;
    } catch(e) {
      const current=await getSession(tabId);
      if(current?.running && current.token===auth.token){
        const error=e.name==='AbortError'?'Jev 请求超时，请检查网络或 API 服务。':e.status?e.message:e.message?.startsWith('Jev')?e.message:'模型请求未完成，请检查 API 地址、网络或响应格式。';
        await patch(tabId,s=>s?.token===auth.token?{...s,failures:s.failures+1,error,updatedAt:now()}:s);
        if([401,402,403].includes(e.status))await stop(tabId,`http_${e.status}`);
        await badge(tabId,'!', '#bd5656');
        throw new Error(error);
      }
      throw new Error('托管已停止，本次回答不再执行。');
    } finally {
      clearTimeout(timeout);if(inflight.get(tabId)===abort)inflight.delete(tabId);
      await patch(tabId,s=>s?.token===auth.token?{...s,busyUntil:0}:s);
    }
  }
  async function event(message,sender) {
    await authorize(sender,message.token);
    const e=message.event,tabId=sender.tab.id;
    if(!e || JSON.stringify(e).length>256000)throw new Error('事件无效。');
    await patch(tabId,s=>{
      if(!s || s.token!==message.token)return s;
      let next={...s,updatedAt:now()};
      if(e.kind==='observation'){
        next=recordObservation(next,summarize({...e.state,tick:e.tick,self:{...e.state?.self,credits:e.credits}},now()),now());
        next.mission=e.mission;
      }
      else {
        next.events=[{at:now(),kind:String(e.kind).slice(0,40),actionType:String(e.action?.type??'').slice(0,40),choice:String(e.choice??e.action?.name??'').slice(0,80),accepted:e.accepted===true,reason:String(e.reason??'').slice(0,80),text:String(e.message??e.description??e.action?.label??e.action?.name??e.choice??e.reason??e.kind).slice(0,240)},...s.events].slice(0,20);
        if(e.kind==='action'){
          if(e.accepted)next.acceptedActions=(s.acceptedActions??0)+1;
          if(e.reason==='wait')next.waits=(s.waits??0)+1;
        }
      }
      if(e.kind==='stop'){next.running=false;next.reason=e.reason;next.busyUntil=0;}
      if(e.kind==='error')next.error=String(e.message).slice(0,240);
      return next;
    });
    if(e.kind==='stop'){inflight.get(tabId)?.abort();await badge(tabId,'');}
    return {ok:true};
  }
  async function handle(message,sender) {
    await ready;
    if(!message || typeof message.type!=='string')throw new Error('消息无效。');
    if(message.type==='PUBLIC_CONFIG'){const s=await getSettings();return {hotkey:s.hotkey,language:s.language};}
    if(message.type==='DECIDE')return decide(message,sender);
    if(message.type==='EVENT')return event(message,sender);
    if(message.type==='HOTKEY_TOGGLE'){
      if(sender.id!==c.runtime.id || sender.frameId!==0 || !supportedGame(sender.url))throw new Error('不支持此游戏页面。');
      return serial(controlLocks,sender.tab.id,async()=> (await getSession(sender.tab.id))?.running?stop(sender.tab.id):start(sender.tab.id));
    }
    if(!trustExtension(sender))throw new Error('此操作只允许在插件窗口中执行。');
    if(message.type==='GET_SETTINGS')return publicSettings(await getSettings());
    if(message.type==='SET_LANGUAGE'){
      const settings=await getSettings();settings.language=message.language==='en'?'en':'zh-CN';
      await c.storage.local.set({settings});
      for(const tab of await c.tabs.query({}))if(supportedGame(tab.url))await c.tabs.sendMessage(tab.id,{type:'CONFIG_CHANGED',hotkey:settings.hotkey,language:settings.language}).catch(()=>{});
      return {language:settings.language};
    }
    if(message.type==='TEST_CONNECTION'){
      if(probing)throw new Error('连接测试正在进行，请稍候。');
      probing=true;
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000),started=now();
      try{
        const config=validateSettings(await getSettings());
        if(!config.apiKey)throw new Error('请先填写并保存 JEV 密钥。');
        if(!await c.permissions.contains({origins:[originPattern(config.apiBase)]}))throw new Error('请先保存设置并授权 API 访问。');
        const questions={connection:{type:'choice',instructions:'Connection check only. Select ok. No game actions will be executed.',criteria:{ok:'Connection accepted'}}};
        const response=await fetchImpl(apiEndpoint(config.apiBase),{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,state:{purpose:'extension_connection_check'},questions}),signal:abort.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
        if(!response.ok)throw new Error(httpError(response.status));
        const raw=await response.text();if(raw.length>256000)throw new Error('Jev 响应过大。');
        validateAnswer(JSON.parse(raw),questions);
        return {latencyMs:now()-started};
      }catch(e){throw new Error(e.name==='AbortError'?'Jev 连接测试超时。':/^(Jev|请先)/.test(e.message)?e.message:'Jev 连接失败，请检查地址、网络或响应格式。');}
      finally{probing=false;clearTimeout(timer);}
    }
    if(message.type==='SAVE_SETTINGS'){
      const prior=await getSettings(),input=message.settings??{};
      if(input.apiBase && new URL(apiEndpoint(input.apiBase)).origin!==new URL(apiEndpoint(prior.apiBase)).origin && !input.apiKey?.trim())throw new Error('更换 API 服务时，请重新输入该服务的密钥。');
      const config=validateSettings({...input,apiKey:input.apiKey?.trim()||prior.apiKey},prior);
      if(!await c.permissions.contains({origins:[originPattern(config.apiBase)]}))throw new Error('API 访问权限未获授权。');
      if(config.apiKey!==prior.apiKey || config.apiBase!==prior.apiBase || config.model!==prior.model){for(const s of Object.values(await c.storage.session.get(null)))if(s?.running)await stop(s.tabId,'settings_changed');}
      await c.storage.local.set({settings:config});
      for(const tab of await c.tabs.query({}))if(supportedGame(tab.url))await c.tabs.sendMessage(tab.id,{type:'CONFIG_CHANGED',hotkey:config.hotkey,language:config.language}).catch(()=>{});
      return publicSettings(config);
    }
    if(message.type==='CLEAR_KEY'){
      for(const s of Object.values(await c.storage.session.get(null)))if(s?.running)await stop(s.tabId,'key_removed');
      await c.storage.local.set({settings:{...await getSettings(),apiKey:''}});return {hasKey:false};
    }
    const tabId=message.tabId;
    if(!Number.isInteger(tabId))throw new Error('未找到当前游戏标签页。');
    if(message.type==='GET_STATUS'){
      const tab=await c.tabs.get(tabId),s=await getSession(tabId);
      let live;
      if(s?.running){live=await pageCall(tabId,'status',null,s.documentId).catch(()=>null);if(!live?.running)await stop(tabId,'page_disconnected');}
      let observed;
      if(supportedGame(tab.url)){
        observed=await pageCall(tabId,'observe',null,s?.documentId).catch(()=>null);
        if(observed?.missing){
          await c.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',files:['page.js']});
          observed=await pageCall(tabId,'observe',null).catch(()=>null);
        }
        if(observed?.available && observed.snapshot){
          await patch(tabId,current=>{
            const changed=current?.battleId && current.battleId!==observed.battleId;
            const base=changed||!current?{tabId,running:false,decisions:0,events:[]}:current;
            return {...recordObservation(base,observed.snapshot,now()),battleId:observed.battleId};
          });
        }
      }
      const current=await getSession(tabId);
      if(!current)return {running:false,supported:supportedGame(tab.url),title:tab.title,liveObservation:false};
      const {token,documentId,origin,...safe}=current;
      return {...safe,supported:supportedGame(tab.url),title:tab.title,liveObservation:!!observed?.available};
    }
    if(message.type==='START')return serial(controlLocks,tabId,()=>start(tabId));
    if(message.type==='STOP')return serial(controlLocks,tabId,()=>stop(tabId));
    throw new Error('未知插件操作。');
  }
  c.runtime.onMessage.addListener((message,sender,respond)=>{handle(message,sender).then(value=>respond({ok:true,value}),e=>respond({ok:false,error:e.message}));return true;});
  c.tabs.onRemoved.addListener(tabId=>{inflight.get(tabId)?.abort();patch(tabId,()=>undefined).catch(()=>{});});
  c.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading'){inflight.get(tabId)?.abort();patch(tabId,()=>undefined).catch(()=>{});badge(tabId,'');}});
  return {handle,ready,getSession};
}
