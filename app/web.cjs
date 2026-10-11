'use strict';
// Web access for tools: provider-based search, a lightweight page reader and short-lived caches.
// Every request made on behalf of a model goes through guardedFetch: http(s) only, no credentials in URLs,
// DNS answers are checked before connecting (so a public name cannot rebind to a private address),
// and each redirect target is checked again. Bodies are size-limited and decompressed with the same limit.
const http=require('node:http'),https=require('node:https'),dns=require('node:dns'),net=require('node:net'),zlib=require('node:zlib');

const USER_AGENT='LumenBeta/0.0 (local desktop research assistant; Electron)';
const MAX_REDIRECTS=5;

function ipv4Private(ip){
 const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
 const [a,b]=p;return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0&&p[2]===0)||(a===192&&b===0&&p[2]===2)||(a===198&&(b===18||b===19))||(a===198&&b===51&&p[2]===100)||(a===203&&b===0&&p[2]===113);
}
function privateAddress(address){
 if(net.isIPv4(address))return ipv4Private(address);
 if(!net.isIPv6(address))return true;
 const ip=address.toLowerCase().replace(/^\[|\]$/g,'');
 const mapped=/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)||/^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);if(mapped)return ipv4Private(mapped[1]);
 if(ip==='::'||ip==='::1')return true;
 const first=parseInt(ip.split(':')[0]||'0',16);
 return (first&0xfe00)===0xfc00||(first&0xffc0)===0xfe80||(first&0xff00)===0xff00||ip.startsWith('64:ff9b:')||ip.startsWith('2001:db8:')||ip.startsWith('2002:');
}
function blockedHostname(host){const h=host.toLowerCase().replace(/\.$/,'');return h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.home.arpa')||h==='metadata.google.internal';}

// Throws a user-readable error for anything a model-driven request must not reach.
function checkUrl(raw,{allowPrivate=false}={}){
 let url;try{url=new URL(String(raw));}catch{throw webError('invalid-url','That is not a valid web address.');}
 if(!['http:','https:'].includes(url.protocol))throw webError('blocked','Only http and https pages can be opened.');
 if(url.username||url.password)throw webError('blocked','Addresses with embedded credentials are not opened.');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(!allowPrivate){if(blockedHostname(host))throw webError('blocked','Local and private network addresses are blocked.');if(net.isIP(host)&&privateAddress(host))throw webError('blocked','Local and private network addresses are blocked.');}
 url.hash='';return url;
}
function webError(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}

// lookup hook for http(s).request: resolves, rejects private answers and connects to the checked address.
function guardedLookup(allowPrivate){
 return (hostname,options,callback)=>{
  dns.lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
   if(error)return callback(webError('dns','Could not resolve '+hostname+'.'));
   const usable=allowPrivate?addresses:addresses.filter(a=>!privateAddress(a.address));
   if(!usable.length)return callback(webError('blocked','Local and private network addresses are blocked.'));
   if(options&&options.all)return callback(null,usable);
   callback(null,usable[0].address,usable[0].family);
  });
 };
}

function requestOnce(url,{method='GET',headers={},body=null,signal,timeoutMs=15000,maxBytes=3*1048576,allowPrivate=false}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(webError('aborted','Cancelled'));
  const client=url.protocol==='https:'?https:http;let settled=false,timer;
  const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);fn(value);};
  const request=client.request(url,{method,headers:{'user-agent':USER_AGENT,'accept-encoding':'gzip, deflate, br','accept-language':'en,tr;q=0.8',...headers},lookup:guardedLookup(allowPrivate),timeout:timeoutMs},response=>{
   const status=response.statusCode||0;
   if(status>=300&&status<400&&response.headers.location){response.resume();return finish(resolve,{status,headers:response.headers,redirect:response.headers.location});}
   const encoding=String(response.headers['content-encoding']||'').toLowerCase();
   let stream=response;if(encoding==='gzip'||encoding==='x-gzip')stream=response.pipe(zlib.createGunzip());else if(encoding==='deflate')stream=response.pipe(zlib.createInflate());else if(encoding==='br')stream=response.pipe(zlib.createBrotliDecompress());
   const chunks=[];let size=0,truncated=false;
   stream.on('data',chunk=>{if(truncated)return;size+=chunk.length;if(size>maxBytes){chunks.push(chunk.subarray(0,chunk.length-(size-maxBytes)));truncated=true;response.destroy();finish(resolve,{status,headers:response.headers,body:Buffer.concat(chunks),truncated:true});return;}chunks.push(chunk);});
   stream.on('end',()=>finish(resolve,{status,headers:response.headers,body:Buffer.concat(chunks),truncated}));
   stream.on('error',error=>finish(reject,truncated?error:webError('network','The connection failed while reading the page.')));
  });
  const onAbort=()=>{request.destroy();finish(reject,webError('aborted','Cancelled'));};
  signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{request.destroy();finish(reject,webError('timeout','The site did not respond in time.'));},timeoutMs);
  request.on('timeout',()=>{request.destroy();finish(reject,webError('timeout','The site did not respond in time.'));});
  request.on('error',error=>finish(reject,error.code==='blocked'||error.code==='dns'?error:webError('network',error.code==='ERR_TLS_CERT_ALTNAME_INVALID'||/certificate/i.test(error.message)?'The site’s security certificate is not valid.':'Could not connect to the site.')));
  request.end(body||undefined);
 });
}

async function guardedFetch(raw,options={}){
 let url=checkUrl(raw,options);
 for(let hop=0;hop<=MAX_REDIRECTS;hop++){
  const response=await requestOnce(url,options);
  if(!response.redirect)return {...response,url:url.href};
  url=checkUrl(new URL(response.redirect,url).href,options);
 }
 throw webError('redirects','The page redirected too many times.');
}

// ---------- Lightweight readable-text extraction (no DOM, no scripts executed) ----------
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',copy:'©',reg:'®',trade:'™',middot:'·',bull:'•',laquo:'«',raquo:'»',deg:'°',euro:'€',pound:'£',times:'×'};
function decodeEntities(text){return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(match,code)=>{if(code[0]==='#'){const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return n>0&&n<0x110000?String.fromCodePoint(n):'';}return entities[code.toLowerCase()]??match;});}
function stripTags(html){return decodeEntities(html.replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim();}
function metaContent(html,pattern){const tags=html.match(/<meta\b[^>]*>/gi)||[];for(const tag of tags){if(!pattern.test(tag))continue;const m=/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);if(m)return decodeEntities(m[2]??m[3]).trim();}return '';}
function extractReadable(html,pageUrl){
 const head=html.slice(0,200000);
 const title=metaContent(head,/property\s*=\s*["']og:title["']/i)||stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)||[])[1]||'');
 const description=metaContent(head,/(?:name|property)\s*=\s*["'](?:description|og:description)["']/i);
 const published=metaContent(head,/(?:property|name|itemprop)\s*=\s*["'](?:article:published_time|datePublished|date|dc\.date|pubdate|publish-date)["']/i)||((/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i.exec(html)||[])[1]||'');
 let body=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg|template|iframe|canvas|object|form|select|button)\b[\s\S]*?<\/\1\s*>/gi,' ');
 const main=/<article\b[\s\S]*?<\/article>/i.exec(body)?.[0]||/<main\b[\s\S]*?<\/main>/i.exec(body)?.[0]||'';
 if(stripTags(main).length>600)body=main;else body=body.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1\s*>/gi,' ');
 // Paragraph-first: headings, paragraphs and substantial list items in document order. Navigation menus and language
 // lists are mostly short items and drop out here. Falls back to whole-body text for pages without paragraphs.
 const blocks=[];for(const match of body.matchAll(/<(h[1-4]|p|li|blockquote|pre|dd)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)){const tag=match[1].toLowerCase(),text=stripTags(match[2]);if(!text||tag==='li'&&text.length<50)continue;blocks.push(tag[0]==='h'?'## '+text:tag==='li'?'- '+text:text);}
 const paragraphs=blocks.join('\n\n');if(paragraphs.length>500)return {title:title.slice(0,300),description:description.slice(0,500),published:normalizeDate(published),text:paragraphs.replace(/\[(?:\d+|edit|citation needed)\]/gi,'')};
 body=body.replace(/<h([1-6])\b[^>]*>/gi,'\n\n## ').replace(/<\/h[1-6]>/gi,'\n').replace(/<li\b[^>]*>/gi,'\n- ').replace(/<(br|hr)\b[^>]*>/gi,'\n').replace(/<\/(p|div|section|article|li|tr|table|blockquote|pre|ul|ol|dd|dt)>/gi,'\n').replace(/<\/t[dh]>/gi,' | ');
 const text=decodeEntities(body.replace(/<[^>]+>/g,' ')).replace(/[ \t\f\v ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {title:title.slice(0,300),description:description.slice(0,500),published:normalizeDate(published),text};
}
function normalizeDate(value){if(!value)return null;const d=new Date(value);return Number.isNaN(d.getTime())||d.getFullYear()<1990||d.getTime()>Date.now()+864e5?null:d.toISOString();}
function siteOf(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}}

// ---------- Short-lived cache with in-flight de-duplication ----------
function createCache(limit,ttl){
 const values=new Map(),flights=new Map();
 return {
  async get(key,load){
   const hit=values.get(key);if(hit&&hit.expires>Date.now())return hit.value;values.delete(key);
   if(flights.has(key))return flights.get(key);
   const flight=load().then(value=>{if(values.size>=limit)values.delete(values.keys().next().value);values.set(key,{value,expires:Date.now()+ttl});return value;}).finally(()=>flights.delete(key));
   flights.set(key,flight);return flight;
  },
  clear(){values.clear();}
 };
}

// ---------- Search providers ----------
// Each provider returns normalized results: {title,url,site,snippet,published,dateKind}. Links always come from the provider response.
function cleanResult(item){
 let url;try{url=checkUrl(item.url).href;}catch{return null;}
 const title=stripTags(String(item.title||'')).slice(0,200)||siteOf(url);
 return {title,url,site:siteOf(url),snippet:stripTags(String(item.snippet||'')).slice(0,400),published:normalizeDate(item.published),dateKind:item.published?(item.dateKind||'published'):null};
}
// A rate limit or temporary outage, with the server's Retry-After (seconds) when it sent one.
function busy(name,response,message){const after=Number(response.headers?.['retry-after']);return webError(response.status===429?'rate-limit':'busy',message||(name+(response.status===429?' is limiting requests right now.':' is temporarily unavailable.')),{retryAfter:Number.isFinite(after)?after:null});}
const providers={
 wikipedia:{
  label:'Wikipedia',needsKey:false,scope:'wikipedia',
  async search(query,{count,language,signal}){
   const lang=/^[a-z]{2,3}$/.test(language||'')?language:'en';
   const url=`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srprop=snippet%7Ctimestamp&srlimit=${count}&srsearch=${encodeURIComponent(query)}`;
   const response=await guardedFetch(url,{signal,timeoutMs:12000,maxBytes:1048576,headers:{accept:'application/json'}});
   if(response.status===429||response.status===503)throw busy('Wikipedia',response);
   if(response.status!==200)throw webError('provider','Wikipedia search is unavailable ('+response.status+').');
   const data=JSON.parse(response.body.toString('utf8'));
   return (data.query?.search||[]).map(r=>({title:r.title,url:`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g,'_'))}`,snippet:r.snippet,published:r.timestamp,dateKind:'updated'}));
  }
 },
 brave:{
  label:'Brave Search',needsKey:true,scope:'web',
  async search(query,{count,key,language,signal}){
   if(!key)throw webError('needs-key','Brave Search needs an API key. Add it in Settings → Search.');
   const url=`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&safesearch=moderate&text_decorations=false${language==='tr'?'&search_lang=tr':''}`;
   const response=await guardedFetch(url,{signal,timeoutMs:12000,maxBytes:2*1048576,headers:{accept:'application/json','x-subscription-token':key}});
   // An invalid key comes back as 422 with an authentication error code.
   if(response.status===401||response.status===403||response.status===422&&/SUBSCRIPTION_TOKEN|authentication/i.test(response.body?.toString('utf8')||''))throw webError('needs-key','Brave Search rejected the API key.');
   if(response.status===429||response.status===503)throw busy('Brave Search',response);
   if(response.status===402)throw webError('needs-key','Brave Search says this key has no remaining credit or plan.');
   if(response.status!==200)throw webError('provider','Brave Search is unavailable ('+response.status+').');
   const data=JSON.parse(response.body.toString('utf8'));
   return (data.web?.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.description,published:r.page_age||null,dateKind:'published'}));
  }
 },
 searxng:{
  label:'SearXNG',needsKey:false,scope:'instance',
  async search(query,{count,endpoint,language,signal}){
   if(!endpoint)throw webError('needs-endpoint','Add your SearXNG address in Settings → Search.');
   const base=new URL(endpoint);base.pathname=base.pathname.replace(/\/?$/,'/')+'search';base.search=new URLSearchParams({q:query,format:'json',language:language==='tr'?'tr':'en'}).toString();
   // The instance address is chosen by the user in Settings, so a self-hosted instance on this machine is allowed.
   const response=await guardedFetch(base.href,{signal,timeoutMs:15000,maxBytes:2*1048576,headers:{accept:'application/json'},allowPrivate:true});
   if(response.status===429||response.status===503)throw busy('The SearXNG instance',response);
   if(response.status===403)throw webError('provider','This SearXNG instance does not allow JSON results.');
   if(response.status!==200)throw webError('provider','SearXNG is unavailable ('+response.status+').');
   let data;try{data=JSON.parse(response.body.toString('utf8'));}catch{throw webError('provider','SearXNG did not return JSON results.');}
   return (data.results||[]).slice(0,count).map(r=>({title:r.title,url:r.url,snippet:r.content,published:r.publishedDate||null,dateKind:'published'}));
  }
 },
 // DuckDuckGo's HTML results page: general web search without an account or key. It is not an official API, so it can
 // change or ask for a human check under heavy use; Lumen then says so and never tries to get around the check.
 duckduckgo:{
  label:'DuckDuckGo',needsKey:false,scope:'web',
  async search(query,{count,language,signal}){
   const body=Buffer.from(new URLSearchParams({q:query,kl:language==='tr'?'tr-tr':'us-en'}).toString());
   const response=await guardedFetch('https://html.duckduckgo.com/html/',{method:'POST',body,signal,timeoutMs:12000,maxBytes:1048576,headers:{accept:'text/html','content-type':'application/x-www-form-urlencoded','content-length':String(body.length)}});
   if(response.status===429||response.status===503)throw busy('DuckDuckGo',response);
   const html=response.body.toString('utf8');
   if(response.status===202||/anomaly-modal|bots use DuckDuckGo|challenge-form/i.test(html))throw webError('rate-limit','DuckDuckGo is asking for a human check right now. Try again in a few minutes, or use Tavily or Brave in Settings → Search.');
   if(response.status!==200)throw webError('provider','DuckDuckGo search is unavailable ('+response.status+').');
   const results=[];
   for(const block of html.split(/<div class="result results_links/).slice(1)){
    if(/result--ad\b/.test(block.slice(0,200)))continue;
    const link=/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);if(!link)continue;
    let url=decodeEntities(link[1]);
    // Older pages wrap links in a redirect (//duckduckgo.com/l/?uddg=<target>); use the target itself.
    if(/^(https?:)?\/\/duckduckgo\.com\/l\//.test(url)){try{url=new URL(url,'https://duckduckgo.com').searchParams.get('uddg')||'';}catch{url='';}}
    if(!/^https?:\/\//.test(url))continue;
    const snippet=/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]||'';
    results.push({title:link[2],url,snippet,published:null});
    if(results.length>=count)break;
   }
   return results;
  }
 },
 // Tavily search API (https://docs.tavily.com): POST /search with a Bearer key; basic depth costs one credit per search.
 tavily:{
  label:'Tavily',needsKey:true,scope:'web',
  async search(query,{count,key,signal}){
   if(!key)throw webError('needs-key','Tavily needs an API key. Add it in Settings → Search.');
   const body=Buffer.from(JSON.stringify({query,max_results:count,search_depth:'basic',topic:'general',include_answer:false,include_published_date:true}));
   const response=await guardedFetch('https://api.tavily.com/search',{method:'POST',body,signal,timeoutMs:15000,maxBytes:2*1048576,headers:{accept:'application/json','content-type':'application/json','content-length':String(body.length),authorization:'Bearer '+key}});
   if(response.status===401||response.status===403)throw webError('needs-key','Tavily rejected the API key.');
   if(response.status===432||response.status===433)throw webError('needs-key','Tavily says this key has reached its plan or usage limit.');
   if(response.status===429||response.status===503)throw busy('Tavily',response);
   if(response.status!==200)throw webError('provider','Tavily search is unavailable ('+response.status+').');
   const data=JSON.parse(response.body.toString('utf8'));
   return (data.results||[]).map(r=>({title:r.title,url:r.url,snippet:r.content,published:r.published_date||null,dateKind:'published'}));
  }
 }
};
// One retry for a rate limit or outage when the wait is short (Retry-After up to 8 s, else 2 s); cancellable.
async function withRetry(run,signal){
 try{return await run();}
 catch(error){
  if(!['rate-limit','busy'].includes(error.code)||signal?.aborted)throw error;const wait=error.retryAfter==null?2:error.retryAfter;if(wait>8)throw error;
  await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,wait*1000);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(webError('aborted','Cancelled'));},{once:true});});
  return run();
 }
}

function createWeb({render}={}){
 const searchCache=createCache(60,10*60*1000),pageCache=createCache(40,10*60*1000);
 async function search(query,settings,{signal}={}){
  const q=String(query||'').replace(/\s+/g,' ').trim().slice(0,200);if(q.length<2)throw webError('invalid','The search query is too short.');
  const provider=providers[settings.provider];if(!provider)throw webError('provider','Unknown search provider.');
  const count=Math.max(1,Math.min(8,Number(settings.results)||5)),language=settings.language||'en';
  const key=[settings.provider,language,count,settings.endpoint||'',q.toLowerCase()].join('|');
  const results=await searchCache.get(key,async()=>{const raw=await withRetry(()=>provider.search(q,{count,language,key:settings.key,endpoint:settings.endpoint,signal}),signal);const seen=new Set();return raw.map(cleanResult).filter(r=>r&&!seen.has(r.url)&&seen.add(r.url)).slice(0,count);});
  return {provider:settings.provider,providerLabel:provider.label,scope:provider.scope,query:q,results};
 }
 async function readPage(raw,{signal,allowRender=true,maxChars=20000}={}){
  const url=checkUrl(raw).href;
  return pageCache.get(url+'|'+allowRender,async()=>{
   const response=await guardedFetch(url,{signal,timeoutMs:15000,maxBytes:3*1048576,headers:{accept:'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'}});
   if(response.status===429)throw webError('rate-limit','The site is limiting requests ('+siteOf(url)+').');
   if(response.status>=400)throw webError('http','The page returned an error ('+response.status+').');
   const type=String(response.headers['content-type']||'').toLowerCase();
   let page;
   if(type.includes('html')||type.includes('xml')||!type){const charset=/charset=([\w-]+)/.exec(type)?.[1];let html;try{html=new TextDecoder(charset||'utf-8').decode(response.body);}catch{html=response.body.toString('utf8');}page={...extractReadable(html,response.url),method:'reader'};}
   else if(type.startsWith('text/plain')||type.includes('markdown')){page={title:'',description:'',published:null,text:response.body.toString('utf8'),method:'reader'};}
   else throw webError('unsupported','This kind of file cannot be read ('+type.split(';')[0]+').');
   if(page.text.length<400&&allowRender&&render){try{const rendered=await render(response.url,{signal});if(rendered.text.length>page.text.length)page={...page,title:rendered.title||page.title,text:rendered.text,method:'rendered'};}catch(error){if(error.code==='aborted')throw error;}}
   const text=page.text.slice(0,maxChars);
   return {url:response.url,requestedUrl:url,site:siteOf(response.url),title:page.title||siteOf(response.url),description:page.description,published:page.published,text,chars:page.text.length,truncated:page.text.length>maxChars||response.truncated,method:page.method};
  });
 }
 return {search,readPage,checkUrl,providerLabel:id=>providers[id]?.label||id,clear(){searchCache.clear();pageCache.clear();},providers:Object.fromEntries(Object.entries(providers).map(([id,p])=>[id,{label:p.label,needsKey:p.needsKey,scope:p.scope}]))};
}

module.exports={createWeb,checkUrl,privateAddress,blockedHostname,guardedFetch,extractReadable,siteOf};
