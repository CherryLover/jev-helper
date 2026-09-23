// Parse only Jev's three existing dotenv settings; never evaluate dotenv expressions.
export function importSettings(text) {
  if(typeof text!=='string' || text.length>65536)throw new Error('配置文件过大，请仅保留 Jev 配置。');
  const mapping={JEV_API_KEY:'apiKey',JEV_BASE_URL:'apiBase',JEV_MODEL:'model'},out={};
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\s*(?:export\s+)?(JEV_API_KEY|JEV_BASE_URL|JEV_MODEL)\s*=\s*(.*?)\s*$/);
    if(!match)continue;
    let value=match[2];
    if(value.startsWith('"')||value.startsWith("'")){
      const quote=value[0],end=value.indexOf(quote,1);
      if(end<0||!/^\s*(?:#.*)?$/.test(value.slice(end+1)))throw new Error('Jev 配置格式无效。');
      value=value.slice(1,end);
    }else value=value.replace(/\s+#.*$/,'').trim();
    out[mapping[match[1]]]=value;
  }
  if(!out.apiKey)throw new Error('文件中没有有效的 JEV_API_KEY。');
  return out;
}
