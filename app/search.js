'use strict';
// Conversation search over the saved history (titles and message text), entirely local. Matching ignores case and Turkish /
// accent differences (İ/I/ı/i, ç/c, ğ/g, ö/o, ş/s, ü/u, é/e). The index is built in small slices and only for chats that
// changed, so typing never blocks the window; deleted chats drop out and renamed or new messages are picked up.
Object.assign(translations,{
 searchConversations:['Search conversations','Sohbetlerde ara'],searchNoMatch:['No conversations match.','Eşleşen sohbet yok.'],searching:['Searching…','Aranıyor…'],
 searchTitleMatch:['Title','Başlık'],searchYou:['You','Sen'],searchResultsCount:['{n} results','{n} sonuç'],clearSearch:['Clear search','Aramayı temizle']
});
function foldChar(ch){let n=ch.toLocaleLowerCase('tr');if(n==='ı')return 'i';n=n.normalize('NFD').replace(/[̀-ͯ]/g,'');return n.length===1?n:(n[0]||' ');}
// Same length as the input, so a match position in the folded text is also its position in the original.
function foldText(text){let out='';for(let i=0;i<text.length;i++)out+=foldChar(text[i]);return out;}
const searchIndex=new Map();let searchTicket=0,searchTimer=0,searchQuery='';
const INDEX_LIMIT=20000;
function chatStamp(c){return [c.Title,c.Messages?.length||0,c.Updated||'',c.Messages?.at(-1)?.Content?.length||0].join('|');}
function indexChat(c){
 const stamp=chatStamp(c),current=searchIndex.get(c.Id);if(current&&current.stamp===stamp)return current;
 const parts=(c.Messages||[]).map((m,index)=>{const raw=String(m.DisplayText||m.Content||'').slice(0,INDEX_LIMIT);return {index,role:m.Role,raw,folded:foldText(raw)};});
 const entry={stamp,title:c.Title||'',foldedTitle:foldText(c.Title||''),parts};searchIndex.set(c.Id,entry);return entry;
}
// Indexes chats in slices of a few milliseconds and yields between them.
function indexAll(ticket){
 return new Promise(resolve=>{let i=0;const chats=state.chats;const live=new Set(chats.map(c=>c.Id));for(const id of searchIndex.keys())if(!live.has(id))searchIndex.delete(id);
  const slice=()=>{if(ticket!==searchTicket)return resolve(false);const end=performance.now()+8;while(i<chats.length&&performance.now()<end)indexChat(chats[i++]);if(i<chats.length)setTimeout(slice,0);else resolve(true);};slice();});
}
function snippet(raw,at,length){const start=Math.max(0,at-60),end=Math.min(raw.length,at+length+80);return {before:(start>0?'…':'')+raw.slice(start,at).replace(/\s+/g,' '),match:raw.slice(at,at+length),after:raw.slice(at+length,end).replace(/\s+/g,' ')+(end<raw.length?'…':'')};}
function searchChats(query){
 const q=foldText(query.trim());const results=[];if(q.length<2)return results;
 for(const c of state.chats){
  const entry=searchIndex.get(c.Id);if(!entry)continue;let hits=0;
  const titleAt=entry.foldedTitle.indexOf(q);if(titleAt>=0){results.push({chat:c,title:true,score:0,text:snippet(entry.title,titleAt,q.length)});hits++;}
  for(const part of entry.parts){if(hits>=3)break;const at=part.folded.indexOf(q);if(at<0)continue;results.push({chat:c,index:part.index,role:part.role,score:1,text:snippet(part.raw,at,q.length)});hits++;}
  if(results.length>=60)break;
 }
 return results.sort((a,b)=>a.score-b.score).slice(0,50);
}
function chatDate(c){const value=c.Updated||c.Created;if(!value)return '';const d=new Date(value);return isNaN(d)?'':d.toLocaleDateString(state.prefs.language==='tr'?'tr-TR':'en-US',{day:'numeric',month:'short',year:'numeric'});}
function openChatAt(c,index){
 if(state.busy)return;clearDraftFiles();upsert(c);$('model-picker').value=c.Model;setPage('chat');renderPickers();renderMessages();renderContext();
 if(Number.isInteger(index)){const node=$('messages').children[index];if(node){node.scrollIntoView({block:'center'});node.classList.add('search-hit');setTimeout(()=>node.classList.remove('search-hit'),1600);}}
}
function renderSearchResults(results){
 const list=$('history');list.replaceChildren();
 if(!results.length){list.append(el('p','history-empty',t('searchNoMatch')));return;}
 const fragment=document.createDocumentFragment();
 for(const r of results){
  const item=el('button','search-result');item.type='button';item.disabled=state.busy;
  const head=el('span','search-result-head');head.append(el('strong','',r.chat.Title||t('newChat')),el('small','',[r.title?t('searchTitleMatch'):r.role==='user'?t('searchYou'):displayName(r.chat.Model),chatDate(r.chat)].filter(Boolean).join(' · ')));
  const text=el('span','search-result-text');text.append(document.createTextNode(r.text.before),el('mark','',r.text.match),document.createTextNode(r.text.after));
  item.append(head,text);item.onclick=()=>openChatAt(r.chat,r.index);fragment.append(item);
 }
 list.append(fragment);
}
async function runSearch(){
 const ticket=++searchTicket,query=searchQuery;
 if(foldText(query.trim()).length<2){searchRenderHistory();return;}
 const list=$('history');if(!searchIndex.size)list.replaceChildren(el('p','history-empty',t('searching')));
 if(!await indexAll(ticket))return;if(ticket!==searchTicket)return;
 renderSearchResults(searchChats(query));
}
(function addSearchBox(){
 const box=el('div','history-search'),input=el('input');input.id='history-search';input.type='search';input.autocomplete='off';input.spellcheck=false;
 input.placeholder=t('searchConversations');input.setAttribute('aria-label',t('searchConversations'));box.append(input);
 document.querySelector('.sidebar .rail-label').before(box);
 input.addEventListener('input',()=>{searchQuery=input.value;clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,180);});
 input.addEventListener('keydown',e=>{if(e.key==='Escape'&&input.value){e.preventDefault();e.stopPropagation();input.value='';searchQuery='';runSearch();}});
})();
// While a search is active, history updates (new message, rename, delete) refresh the results instead of the plain list.
const searchRenderHistory=renderHistory;renderHistory=function(){if(foldText(searchQuery.trim()).length>=2){clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,120);return;}searchRenderHistory();};
const searchLocalize=localize;localize=function(){searchLocalize();const input=$('history-search');if(input){input.placeholder=t('searchConversations');input.setAttribute('aria-label',t('searchConversations'));}};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.shiftKey&&!e.altKey){e.preventDefault();const input=$('history-search');input.focus();input.select();}});
