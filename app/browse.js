'use strict';
// Browser commands in chat ("discord'u aç", "open github.com", "youtube'da lofi ara", "go back"). A short message that is
// clearly a browser command is carried out directly in the browser panel (or the default browser when the panel is off),
// without a model call, and saved to the chat as a short note. Everything else goes to the model as before.
// It only acts on a web address, a well-known site, or a message that names the browser/a website, so ordinary requests
// such as "dosyayı aç" are not taken as commands. Commands can be chained ("discord'u aç ve giriş yap'a bas"). Lumen can
// click a named link or button, but never types into pages, never enters passwords, and asks before buttons that look like
// paying, sending, deleting or confirming.
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
Object.assign(translations,{
 browseClicked:['Clicked “{label}”.','“{label}” düğmesine tıklandı.'],
 browseMissing:['I could not find “{label}” on this page.','Bu sayfada “{label}” bulamadım.'],
 browseSeen:[' Visible links and buttons: {list}.',' Görünen bağlantı ve düğmeler: {list}.'],
 browseConfirm:['“{label}” may pay, send, delete or confirm something, so I did not click it. Reply “yes” to click it.','“{label}” ödeme, gönderme, silme veya onaylama yapabilir; bu yüzden tıklamadım. Tıklamamı istiyorsan “evet” yaz.'],
 browseConfirmGone:['There is nothing waiting for confirmation.','Onay bekleyen bir işlem yok.'],
 browseNoScript:['JavaScript is off for pages (Settings → Browser), so I cannot click on pages.','Sayfalarda JavaScript kapalı (Ayarlar → Tarayıcı), bu yüzden sayfalarda tıklayamıyorum.'],
 browseClickFailed:['I could not click on this page.','Bu sayfada tıklayamadım.'],
 browseExternalOnly:['Pages open in your default browser (Settings → Browser), so I cannot click on them.','Sayfalar varsayılan tarayıcında açılıyor (Ayarlar → Tarayıcı), bu yüzden üzerlerinde tıklayamıyorum.'],
 browseScrolled:['Scrolled {where}.','Sayfa {where} kaydırıldı.'],
 browse_down:['down','aşağı'],browse_up:['up','yukarı'],browse_top:['to the top','en üste'],browse_bottom:['to the bottom','en alta'],
 browseNoTyping:['I do not type into pages or fill in forms, and never enter passwords. Click into the browser panel and type it yourself.','Sayfalara yazı yazmam ve form doldurmam; şifre ise hiç girmem. Tarayıcı paneline tıklayıp kendin yazabilirsin.']
});

// One command, already lower-cased and trimmed.
function browseStep(s){
 if(/^(?:sayfada |tarayıcıda )?geri (?:git|dön|gel)$|^go back$/.test(s))return {kind:'back'};
 if(/^(?:sayfada |tarayıcıda )?ileri git$|^go forward$/.test(s))return {kind:'forward'};
 if(/^(?:sayfayı )?yenile$|^(?:reload|refresh)(?: the page)?$/.test(s))return {kind:'reload'};
 if(/^(?:tarayıcıyı|browserı|browser'ı|paneli|tarayıcı panelini) kapat$|^close the (?:browser|panel)$/.test(s))return {kind:'close'};
 // Scrolling
 let m=/^(?:sayfayı |sayfada )?(aşağı|yukarı)(?: doğru)? (?:kaydır|in|çık|git)$|^scroll (down|up)$/.exec(s);
 if(m)return {kind:'scroll',direction:{aşağı:'down',yukarı:'up',down:'down',up:'up'}[m[1]||m[2]]};
 m=/^(?:sayfanın )?(?:en )?(alta|üste|başa|sona|aşağıya|yukarıya) (?:git|in|çık|kaydır|dön)$|^scroll to (?:the )?(top|bottom)$/.exec(s);
 if(m)return {kind:'scroll',direction:{alta:'bottom',sona:'bottom',aşağıya:'bottom',üste:'top',başa:'top',yukarıya:'top',top:'top',bottom:'bottom'}[m[1]||m[2]]};
 // Typing or form filling is not done; answer clearly instead of passing it to the model.
 if(/(?:şifre|parola|e-?posta|mail|kullanıcı ?adı|telefon|kart|form)\S* .*(?:yaz|gir|doldur)$|^(?:type|fill in|fill out|enter) .*(?:password|email|e-mail|username|form|field)/.test(s))return {kind:'type'};
 if(/^(?:evet|evet bas|evet tıkla|onaylıyorum|tamam bas|yes|yes,? click(?: it)?|confirm)$/.test(s))return {kind:'confirm'};
 const cue="(?:tarayıcı(?:da|dan|yı)?|browser(?:['’]?(?:da|dan|de|den|ı))?|panel(?:de|den)?|lumen['’]?(?:de|da|den|dan)?)";
 // Search on a site: "youtube'da lofi ara", "search lofi on youtube"
 m=new RegExp('^(?:'+cue+' )?([a-zçğıöşü]+)[\'’]?(?:da|de|ta|te) (.+?) (?:ara|arat|aratır mısın|arar mısın|araştır)$').exec(s);
 if(m&&browseSearch[browseStem(m[1])]){const [site,base]=browseSearch[browseStem(m[1])];return {kind:'open',url:base+encodeURIComponent(m[2]),site,query:m[2],search:true};}
 m=/^search (?:for )?(.+?) on ([a-z]+)$/.exec(s);
 if(m&&browseSearch[m[2]]){const [site,base]=browseSearch[m[2]];return {kind:'open',url:base+encodeURIComponent(m[1]),site,query:m[1],search:true};}
 // Click: "giriş yap'a bas", "giriş yapa bas", "kayıt ol butonuna tıkla", "click log in"
 m=/^(.+?) (?:bas|tıkla|basar mısın|tıklar mısın|basın|tıklayın|basabilir misin|tıklayabilir misin|basıver|tıklayıver)$/.exec(s);
 if(m){const labels=browseLabels(m[1].replace(/^(?:sayfada|sayfadaki|tarayıcıda|orada|oradaki|şu|şuradaki) /,'').replace(/ (?:yazan )?(?:butonuna|düğmesine|tuşuna|linkine|bağlantısına|sekmesine|yazısına|yere|butona|düğmeye|kısmına|seçeneğine)$/,'').replace(/ yazan$/,''));if(labels)return {kind:'click',labels};}
 m=/^(?:click|press|tap)(?: on)?(?: the)? (.+?)(?: button| link| tab)?$/.exec(s);
 if(m){const labels=browseLabels(m[1]);if(labels)return {kind:'click',labels};}
 // Open: "discord'u aç", "tarayıcıda discord.com sitesini aç", "open github.com", "go to youtube"
 m=new RegExp('^(?:('+cue+') )?(.+?) (?:aç|açar mısın|açabilir misin|açsana|açıver|git|gir|götür|yönlendir|sayfasına git|sitesine git|sitesine gir)$').exec(s);
 if(m){const explicit=!!m[1]||/ (?:sitesi(?:ni|ne)?|sayfası(?:nı|na)?|adresi(?:ni|ne)?)$/.test(m[2]);const target=browseTarget(m[2],explicit);if(target)return {kind:'open',...target};}
 m=/^(?:open|go to|navigate to|visit|launch|show me)( the website)? (.+?)( (?:in|on) (?:the )?(?:browser|panel|lumen))?$/.exec(s);
 if(m){const target=browseTarget(m[2],!!(m[1]||m[3])||/ (?:website|site)$/.test(m[2]));if(target)return {kind:'open',...target};}
 return null;
}
const browseSynonyms=[['giriş yap','log in','login','sign in','oturum aç'],['kayıt ol','sign up','register','üye ol'],['çıkış yap','log out','sign out','oturumu kapat'],['indir','download'],['ara','search'],['devam','continue','devam et'],['kabul et','accept','tümünü kabul et','accept all'],['reddet','reject','tümünü reddet','reject all']];
// What a click names: the text itself plus forms without a Turkish dative ending ("giriş yapa" → "giriş yap").
function browseLabels(raw){
 const text=raw.replace(/["“”«»]/g,'').trim();if(!text||text.length>60||text.split(/\s+/).length>6)return null;
 const labels=[text],bare=text.replace(/['’](?:y?[ae]|n[ae])$/,'');if(bare!==text)labels.unshift(bare);
 else for(const end of ['ya','ye','a','e'])if(text.endsWith(end)&&text.length-end.length>=2){labels.push(text.slice(0,-end.length));break;}
 // Sites show these in either language; the user's own words come first.
 for(const group of browseSynonyms)if(labels.some(l=>group.includes(l))){for(const word of group)if(!labels.includes(word))labels.push(word);break;}
 return labels.slice(0,4);
}
function browseNormalize(text){return text.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g,' ').replace(/[.!]+$/,'').replace(/\s*(?:lütfen|please|pls)$/,'').replace(/^(?:lütfen|please)\s+/,'').trim();}
// A whole message: one command, or several joined with "ve / sonra / ardından / and / then / ,". Every part must be a
// browser command (and at least one must open, click or scroll); otherwise the message goes to the model.
function browsePlan(text){
 if(!text||text.length>200||text.includes('\n'))return null;
 const s=browseNormalize(text);
 // Chained commands first, so "X'i aç ve Y'ye bas" is not read as one click on "X'i aç ve Y".
 const parts=s.split(/\s*,\s*(?:ve |sonra |ardından |and |then )?|\s+(?:ve sonra|ve ardından|sonra|ardından|ve|and then|then|and)\s+/).map(p=>p.trim()).filter(Boolean);
 if(parts.length>=2&&parts.length<=4){const steps=parts.map(browseStep);if(steps.every(Boolean)&&steps.some(st=>['open','click','scroll'].includes(st.kind)))return steps;}
 const single=browseStep(s);return single?[single]:null;
}
function browseIntent(text){const plan=browsePlan(text);return plan&&plan.length===1?plan[0]:plan?{kind:'plan',steps:plan}:null;}

let browsePending=null,browseRunning=false;
async function browseDo(step){
 const panelOpen=!$('browser-panel').hidden,external=toolsConfig&&!toolsConfig.browser.panel;
 if(step.kind==='open'){openSource(step.url);if(!external){await new Promise(r=>setTimeout(r,400));await api.browser('settle',{ms:15000}).catch(()=>{});}
  return {ok:true,note:step.search?tf('browseSearched',{site:step.site,query:step.query}):tf(external?'browseOpenedExternal':'browseOpened',{site:step.site})};}
 if(step.kind==='close'){closeBrowser();return {ok:true,note:t(panelOpen?'browseClosed':'browseNoPage')};}
 if(step.kind==='type')return {ok:false,note:t('browseNoTyping')};
 if(['click','scroll','confirm'].includes(step.kind)&&external&&!panelOpen)return {ok:false,note:t('browseExternalOnly')};
 if(!panelOpen&&step.kind!=='confirm')return {ok:false,note:t('browseNoPage')};
 if(step.kind==='scroll'){const r=await api.browser('scroll',{direction:step.direction}).catch(()=>({status:'unavailable'}));return r.status==='scrolled'?{ok:true,note:tf('browseScrolled',{where:t('browse_'+step.direction)})}:{ok:false,note:t(r.status==='closed'?'browseNoPage':'browseClickFailed')};}
 if(step.kind==='click'||step.kind==='confirm'){
  let labels=step.labels,force=false;
  if(step.kind==='confirm'){const state=await api.browser('state').catch(()=>null);if(!browsePending||browsePending.expires<Date.now()||state?.url!==browsePending.url){browsePending=null;return {ok:false,note:t('browseConfirmGone')};}labels=[browsePending.label];force=true;browsePending=null;}
  const r=await api.browser('click',{labels,force}).catch(()=>({status:'unavailable'}));
  if(r.status==='clicked'){await new Promise(res=>setTimeout(res,300));await api.browser('settle',{ms:15000}).catch(()=>{});return {ok:true,note:tf('browseClicked',{label:r.text||labels[0]})};}
  if(r.status==='confirm'){browsePending={label:r.text,url:r.url,expires:Date.now()+120000};return {ok:false,note:tf('browseConfirm',{label:r.text})};}
  if(r.status==='missing')return {ok:false,note:tf('browseMissing',{label:labels[labels.length-1]})+(r.seen?.length?tf('browseSeen',{list:r.seen.slice(0,8).map(x=>'“'+x+'”').join(', ')}):'')};
  return {ok:false,note:t(r.status==='closed'?'browseNoPage':r.status==='no-script'?'browseNoScript':'browseClickFailed')};
 }
 await api.browser(step.kind).catch(()=>{});return {ok:true,note:t({back:'browseBack',forward:'browseForward',reload:'browseReload'}[step.kind])};
}
async function runBrowse(text,steps){
 const chat=state.chat;chat.Model=$('model-picker').value;if(!chat.Messages.length&&!chat.CustomTitle)chat.Title=text.slice(0,56).replace(/\s+/g,' ');
 chat.Messages.push({Role:'user',Content:text,Interrupted:false});$('prompt').value='';resizePrompt();upsert(chat);renderMessages();
 browseRunning=true;const notes=[];
 try{for(const step of steps){const r=await browseDo(step);notes.push(r.note);if(!r.ok)break;}}
 finally{browseRunning=false;}
 chat.Messages.push({Role:'assistant',Content:notes.join(' '),Interrupted:false});upsert(chat);renderMessages();
 try{upsert(await api.request('save',{chat}));}catch(error){toast(cleanError(error));}
 renderMessages();
}

const sendBeforeBrowse=send;
send=async function(...args){
 if(browseRunning)return;
 if(!state.busy&&state.ready){
  const draft=$('prompt').value.trim(),busyAttachments=(typeof draftFiles!=='undefined'&&draftFiles.length)||(typeof draftPhotos!=='undefined'&&draftPhotos.length);
  let plan=!busyAttachments?browsePlan(draft):null;
  // "evet" only means "click it" while a click is waiting for confirmation.
  if(plan&&plan.length===1&&plan[0].kind==='confirm'&&!browsePending)plan=null;
  if(plan)return runBrowse(draft,plan);
 }
 return sendBeforeBrowse.apply(this,args);
};
