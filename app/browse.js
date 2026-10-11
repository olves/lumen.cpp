'use strict';
// Browser commands in chat ("discord'u aç", "open github.com", "youtube'da lofi ara", "go back"). A short message that is
// clearly a browser command is carried out directly in the browser panel (or the default browser when the panel is off),
// without a model call, and saved to the chat as a short note. Everything else goes to the model as before.
// It only acts on a web address, a well-known site, or a message that names the browser/a website, so ordinary requests
// such as "dosyayı aç" are not taken as commands. Lumen still never signs in, fills forms or posts anything.
Object.assign(translations,{
 browseOpened:['Opened {site} in the browser.','{site} tarayıcıda açıldı.'],
 browseOpenedExternal:['Opened {site} in your default browser.','{site} varsayılan tarayıcında açıldı.'],
 browseSearched:['Searched {site} for “{query}”.','{site} üzerinde “{query}” arandı.'],
 browseBack:['Went back a page.','Bir sayfa geri gidildi.'],browseForward:['Went forward a page.','Bir sayfa ileri gidildi.'],
 browseReload:['Reloaded the page.','Sayfa yenilendi.'],browseClosed:['Closed the browser.','Tarayıcı kapatıldı.'],
 browseNoPage:['The browser is not open.','Tarayıcı açık değil.']
});

const browseSites={discord:'discord.com',youtube:'www.youtube.com',google:'www.google.com',github:'github.com',gitlab:'gitlab.com',twitter:'x.com',x:'x.com',instagram:'www.instagram.com',facebook:'www.facebook.com',reddit:'www.reddit.com',
 wikipedia:'www.wikipedia.org',vikipedi:'tr.wikipedia.org',netflix:'www.netflix.com',spotify:'open.spotify.com',twitch:'www.twitch.tv',whatsapp:'web.whatsapp.com',telegram:'web.telegram.org',gmail:'mail.google.com',
 outlook:'outlook.live.com',chatgpt:'chatgpt.com',claude:'claude.ai',steam:'store.steampowered.com',amazon:'www.amazon.com.tr',trendyol:'www.trendyol.com',hepsiburada:'www.hepsiburada.com',sahibinden:'www.sahibinden.com',
 n11:'www.n11.com',ekşisözlük:'eksisozluk.com',eksisozluk:'eksisozluk.com',linkedin:'www.linkedin.com',tiktok:'www.tiktok.com',huggingface:'huggingface.co',stackoverflow:'stackoverflow.com',duckduckgo:'duckduckgo.com',
 bing:'www.bing.com',translate:'translate.google.com',çeviri:'translate.google.com',maps:'maps.google.com',haritalar:'maps.google.com',epicgames:'store.epicgames.com',kick:'kick.com',pinterest:'www.pinterest.com'};
const browseSearch={youtube:['YouTube','https://www.youtube.com/results?search_query='],google:['Google','https://www.google.com/search?q='],wikipedia:['Wikipedia','https://en.wikipedia.org/w/index.php?search='],
 vikipedi:['Vikipedi','https://tr.wikipedia.org/w/index.php?search='],github:['GitHub','https://github.com/search?q='],duckduckgo:['DuckDuckGo','https://duckduckgo.com/?q='],bing:['Bing','https://www.bing.com/search?q='],
 reddit:['Reddit','https://www.reddit.com/search/?q='],amazon:['Amazon','https://www.amazon.com.tr/s?k='],trendyol:['Trendyol','https://www.trendyol.com/sr?q='],spotify:['Spotify','https://open.spotify.com/search/'],
 huggingface:['Hugging Face','https://huggingface.co/search/full-text?q=']};
const browseEngines={duckduckgo:['DuckDuckGo','https://duckduckgo.com/?q='],google:['Google','https://www.google.com/search?q='],bing:['Bing','https://www.bing.com/search?q='],brave:['Brave','https://search.brave.com/search?q='],startpage:['Startpage','https://www.startpage.com/do/search?query=']};

// Turkish case endings after a site name: discord'u, youtube'a, github'ta, discordu, googleda …
function browseStem(word){
 const w=word.replace(/['’]\s*[a-zçğıöşü]{1,4}$/,'');if(browseSites[w])return w;
 for(const end of ['nın','nin','nun','nün','yı','yi','yu','yü','ya','ye','da','de','ta','te','ı','i','u','ü','a','e'])if(w.endsWith(end)&&browseSites[w.slice(0,-end.length)])return w.slice(0,-end.length);
 return w;
}
function browseTarget(raw,explicit){
 let target=raw.trim().replace(/^(?:the|şu|bu)\s+/,'').replace(/\s+(?:web\s*)?(?:sitesi(?:ni|ne)?|sayfası(?:nı|na)?|adresi(?:ni|ne)?|website|site|page)$/,'').trim();
 target=target.replace(/['’](?:[ıiuü]|y[ıiuü]|[ae]|y[ae]|n[ıiuü]n)$/,'');
 if(/^https?:\/\/\S+$/.test(target))return {url:target,site:target.replace(/^https?:\/\/(www\.)?/,'').split('/')[0]};
 // "main.py aç" or "rapor.pdf aç" is about a file, not a website, unless the message names the browser.
 const fileLike=/\.(?:txt|pdf|docx?|xlsx?|pptx?|py|js|ts|jsx|tsx|json|md|csv|exe|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|wav|cs|cpp|c|h|hpp|java|kt|go|rs|rb|php|html?|css|log|ini|ya?ml|toml|bat|cmd|ps1|sh|sql|gguf|bin)$/;
 if(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/.test(target)&&(explicit||!fileLike.test(target)))return {url:'https://'+target,site:target.replace(/^www\./,'').split('/')[0]};
 const key=browseStem(target.replace(/\s+/g,''));if(browseSites[key])return {url:'https://'+browseSites[key],site:browseSites[key].replace(/^www\./,'')};
 // An unknown name only when the message says it is about the browser or a website: search for it there.
 if(explicit&&target.length>=2&&target.split(/\s+/).length<=4&&!/[?!]/.test(target)){const [name,base]=browseEngines[toolsConfig?.browser?.searchEngine]||browseEngines.duckduckgo;return {url:base+encodeURIComponent(target),site:name,query:target,search:true};}
 return null;
}
function browseIntent(text){
 if(!text||text.length>140||text.includes('\n'))return null;
 const s=text.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g,' ').replace(/[.!]+$/,'').replace(/\s*(?:lütfen|please|pls)$/,'').replace(/^(?:lütfen|please)\s+/,'').trim();
 // Navigation in the open panel
 if(/^(?:sayfada |tarayıcıda )?geri (?:git|dön|gel)$|^go back$/.test(s))return {kind:'back'};
 if(/^(?:sayfada |tarayıcıda )?ileri git$|^go forward$/.test(s))return {kind:'forward'};
 if(/^(?:sayfayı )?yenile$|^(?:reload|refresh)(?: the page)?$/.test(s))return {kind:'reload'};
 if(/^(?:tarayıcıyı|browserı|browser'ı|paneli|tarayıcı panelini) kapat$|^close the (?:browser|panel)$/.test(s))return {kind:'close'};
 const cue="(?:tarayıcı(?:da|dan|yı)?|browser(?:['’]?(?:da|dan|de|den|ı))?|panel(?:de|den)?|lumen['’]?(?:de|da|den|dan)?)";
 // Search on a site: "youtube'da lofi ara", "search lofi on youtube"
 let m=new RegExp('^(?:'+cue+' )?([a-zçğıöşü]+)[\'’]?(?:da|de|ta|te) (.+?) (?:ara|arat|aratır mısın|arar mısın|araştır)$').exec(s);
 if(m&&browseSearch[browseStem(m[1])]){const [site,base]=browseSearch[browseStem(m[1])];return {kind:'open',url:base+encodeURIComponent(m[2]),site,query:m[2],search:true};}
 m=/^search (?:for )?(.+?) on ([a-z]+)$/.exec(s);
 if(m&&browseSearch[m[2]]){const [site,base]=browseSearch[m[2]];return {kind:'open',url:base+encodeURIComponent(m[1]),site,query:m[1],search:true};}
 // Open: "discord'u aç", "tarayıcıda discord.com sitesini aç", "open github.com", "go to youtube"
 m=new RegExp('^(?:('+cue+') )?(.+?) (?:aç|açar mısın|açabilir misin|açsana|açıver|git|gir|götür|yönlendir|sayfasına git|sitesine git|sitesine gir)$').exec(s);
 if(m){const explicit=!!m[1]||/ (?:sitesi(?:ni|ne)?|sayfası(?:nı|na)?|adresi(?:ni|ne)?)$/.test(m[2]);const target=browseTarget(m[2],explicit);if(target)return {kind:'open',...target};}
 m=/^(?:open|go to|navigate to|visit|launch|show me)( the website)? (.+?)( (?:in|on) (?:the )?(?:browser|panel|lumen))?$/.exec(s);
 if(m){const target=browseTarget(m[2],!!(m[1]||m[3])||/ (?:website|site)$/.test(m[2]));if(target)return {kind:'open',...target};}
 return null;
}

async function runBrowse(text,intent){
 const chat=state.chat;chat.Model=$('model-picker').value;if(!chat.Messages.length&&!chat.CustomTitle)chat.Title=text.slice(0,56).replace(/\s+/g,' ');
 const panelOpen=!$('browser-panel').hidden,external=intent.kind==='open'&&toolsConfig&&!toolsConfig.browser.panel;
 let note;
 if(intent.kind==='open'){openSource(intent.url);note=intent.search?tf('browseSearched',{site:intent.site,query:intent.query}):tf(external?'browseOpenedExternal':'browseOpened',{site:intent.site});}
 else if(intent.kind==='close'){closeBrowser();note=t(panelOpen?'browseClosed':'browseNoPage');}
 else if(!panelOpen)note=t('browseNoPage');
 else{await api.browser(intent.kind).catch(()=>{});note=t({back:'browseBack',forward:'browseForward',reload:'browseReload'}[intent.kind]);}
 chat.Messages.push({Role:'user',Content:text,Interrupted:false},{Role:'assistant',Content:note,Interrupted:false});
 $('prompt').value='';resizePrompt();upsert(chat);renderMessages();
 try{upsert(await api.request('save',{chat}));}catch(error){toast(cleanError(error));}
 renderMessages();
}

const sendBeforeBrowse=send;
send=async function(...args){
 if(!state.busy&&state.ready){
  const draft=$('prompt').value.trim(),busyAttachments=(typeof draftFiles!=='undefined'&&draftFiles.length)||(typeof draftPhotos!=='undefined'&&draftPhotos.length);
  const intent=!busyAttachments?browseIntent(draft):null;
  if(intent)return runBrowse(draft,intent);
 }
 return sendBeforeBrowse.apply(this,args);
};
