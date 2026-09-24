// UI-only fixtures. No model requests, game control or real credentials; never packaged.
import http from 'node:http';
import fs from 'node:fs/promises';
const mock=`
let settings={provider:localStorage.previewProvider||'jev',providerName:(localStorage.previewProvider||'jev')==='local'?'Laya':'Jev',apiBase:'https://api.typesafe.ai/v1',model:'jev-latest',localBase:'http://127.0.0.1:8742/v1',localModel:'laya',hasLocalKey:false,hotkey:'Alt+Shift+J',autoCamera:true,showOverlay:true,maxDecisions:2000,hasKey:true,language:localStorage.previewLanguage||'zh-CN'};
const now=Date.now();
let observation={at:now,tick:5400,gameSeconds:360,credits:8450,freeCredits:5250,army:18,harvesters:3,antiAir:4,health:.86,visibleEnemies:9,nearbyEnemies:3,power:{total:500,drain:375},threat:'pressure',rangeThreats:[{name:'SREF',range:10}],enemyMix:{vehicles:2,infantry:1,air:0},base:{x:24,y:40},ownPoints:[{x:28,y:30},{x:36,y:34},{x:38,y:30},{x:32,y:37},{x:28,y:27}],enemyPoints:[{x:44,y:24},{x:48,y:20},{x:50,y:29}],queues:[{type:'0',items:[{name:'GATECH',quantity:1,progress:.7}]},{type:'3',items:[{name:'MTNK',quantity:2,progress:.32}]}],inventory:[{kind:'E1',label:'美国大兵',count:6},{kind:'MTNK',label:'灰熊坦克',count:8},{kind:'AMCV',label:'移动基地车',count:1}]};
const history=Array.from({length:40},(_,i)=>({at:now-(39-i)*5000,gameSeconds:160+i*5,credits:10000-i*60+Math.sin(i*.6)*900,freeCredits:Math.max(0,7000-i*70+Math.sin(i*.6)*900),decisions:Math.floor(i/3)}));
let status={supported:true,running:true,title:'界面预览 · 模拟对局 / UI fixture',decisions:13,credits:8450,latencyMs:287,lastTick:5400,mission:'模拟显示：派遣主力拦截基地附近的敌人',events:[{at:now,kind:'action',actionType:'produce',choice:'produce_MTNK',accepted:true,text:'生产灰熊坦克'}],observation,history,liveObservation:true,acceptedActions:31,waits:8};
if(new URL(location.href).searchParams.has('empty'))status={supported:true,running:false,title:'UI fixture · Lobby',events:[]};
window.chrome={permissions:{request:async()=>true},tabs:{query:async()=>[{id:1}]},runtime:{sendMessage:async m=>{
 if(m.type==='GET_SETTINGS')return {ok:true,value:settings};
 if(m.type==='SET_LANGUAGE'){settings.language=m.language;localStorage.previewLanguage=m.language;return {ok:true,value:{language:m.language}};}
 if(m.type==='SET_OVERLAY'){settings.showOverlay=m.showOverlay;return {ok:true,value:{showOverlay:m.showOverlay}};}
 if(m.type==='TEST_CONNECTION')return {ok:true,value:{latencyMs:settings.provider==='local'?9:123,providerName:settings.providerName,model:settings.provider==='local'?'laya-multilingual-mlx':'jev-1.13'}};
 if(m.type==='GET_STATUS'){if(status.observation)status.observation.at=Date.now();return {ok:true,value:status};}
 if(m.type==='SAVE_SETTINGS'){const {apiKey,localKey,...rest}=m.settings;settings={...rest,hasKey:!!apiKey||settings.hasKey,hasLocalKey:!!localKey||settings.hasLocalKey,providerName:rest.provider==='local'?'Laya':'Jev'};localStorage.previewProvider=rest.provider;status.providerName=settings.providerName;return {ok:true,value:settings};}
 if(m.type==='CLEAR_KEY'){if(m.provider==='local')settings.hasLocalKey=false;else settings.hasKey=false;status.running=false;return {ok:true,value:{}};}
 if(m.type==='START'){status.running=true;return {ok:true,value:status};}
 if(m.type==='STOP'){status.running=false;status.reason='manual';return {ok:true,value:status};}
 return {ok:false,error:'Unknown preview operation'};
}}};`;
const allowed=new Set(['popup.html','popup.css','popup.js','help.html','help.css','help.js']);
http.createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'popup.html';
 if(name==='preview-mock.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
 if(!allowed.has(name)){res.writeHead(404);res.end();return;}
 try{let body=await fs.readFile(new URL('../dist/'+name,import.meta.url));if(name==='popup.html')body=body.toString().replace('<script type="module"','<script src="preview-mock.js"></script><script type="module"');res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript');res.setHeader('Cache-Control','no-store');res.end(body);}catch{res.writeHead(404);res.end();}
}).listen(4318,'127.0.0.1',()=>console.log('UI fixtures only: http://127.0.0.1:4318/ (populated), /?empty (lobby). No model or game connection.'));
