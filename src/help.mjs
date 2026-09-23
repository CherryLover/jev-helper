import {t,officialWebsiteUrl} from './i18n.mjs';
let language=new URL(location.href).searchParams.get('lang')==='en'?'en':'zh-CN';
function render(){const website=document.getElementById('official-site');website.href=officialWebsiteUrl(language);website.title=t(language,'officialWebsiteHint');document.documentElement.lang=language;document.title=t(language,'title');for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=t(language,e.dataset.i18n);for(const [id,lang]of [['lang-zh','zh-CN'],['lang-en','en']])document.getElementById(id).setAttribute('aria-pressed',language===lang);}
for(const [id,lang]of [['lang-zh','zh-CN'],['lang-en','en']])document.getElementById(id).onclick=()=>{language=lang;history.replaceState(null,'',`?lang=${lang}`);render();};render();
