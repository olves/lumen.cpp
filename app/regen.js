'use strict';
// Regenerate. The last reply gets a new version from the same user message (the message is not added again); versions are
// kept and can be switched with ‹ n/m ›. An earlier reply is regenerated in a new branch that ends at it, so later messages
// never enter the new request. A researched reply runs the research again (new web queries; identical ones within 10
// minutes may come from the cache). If nothing is produced (error, or stopped before any text) the previous reply returns.
Object.assign(translations,{
 regenerate:['Regenerate','Yeniden üret'],regenerateBranch:['Regenerate in a new branch','Yeni dalda yeniden üret'],
 regenerateHint:['Writes a new reply to the same message. Earlier versions stay available.','Aynı mesaja yeni bir yanıt yazar. Önceki sürümler korunur.'],
 regenerateResearchHint:['Runs the web research again; identical searches from the last 10 minutes may come from the cache.','Web araştırmasını yeniden çalıştırır; son 10 dakikadaki aynı aramalar önbellekten gelebilir.'],
 regenerateBranchHint:['Opens a new branch that ends with this reply, then regenerates it. This conversation stays as it is.','Bu yanıtla biten yeni bir dal açar ve yanıtı orada yeniden üretir. Bu sohbet olduğu gibi kalır.'],
 versionOf:['Version {n} of {count}','Sürüm {n}/{count}'],previousVersion:['Previous version','Önceki sürüm'],nextVersion:['Next version','Sonraki sürüm'],
 regenerateRestored:['No new reply was produced, so the previous one is back.','Yeni yanıt üretilmedi; önceki yanıt geri getirildi.']
});
let regenerating=false;
const regenMessageNode=messageNode;messageNode=function(m,index,stream=false){
 const result=regenMessageNode(m,index,stream);
 if(stream||m.Role!=='assistant'||!state.chat)return result;
 const last=index===state.chat.Messages.length-1,actions=result.node.querySelector('.message-actions');if(!actions)return result;
 const research=m.Activity?.route==='research';
 const button=el('button','',t(last?'regenerate':'regenerateBranch'));button.type='button';button.disabled=state.busy;button.title=t(last?(research?'regenerateResearchHint':'regenerateHint'):'regenerateBranchHint');button.onclick=()=>regenerate(index);actions.append(button);
 if(last&&m.Variants&&m.Variants.count>1){
  const pager=el('span','variant-pager'),previous=el('button','variant-step','‹'),label=el('span','variant-label',`${m.Variants.active+1}/${m.Variants.count}`),next=el('button','variant-step','›');
  previous.type=next.type='button';previous.setAttribute('aria-label',t('previousVersion'));next.setAttribute('aria-label',t('nextVersion'));label.title=tf('versionOf',{n:m.Variants.active+1,count:m.Variants.count});
  previous.disabled=state.busy||m.Variants.active===0;next.disabled=state.busy||m.Variants.active>=m.Variants.count-1;
  previous.onclick=()=>switchVersion(index,m.Variants.active-1);next.onclick=()=>switchVersion(index,m.Variants.active+1);
  pager.append(previous,label,next);actions.prepend(pager);result.node.classList.add('has-versions');
 }
 return result;
};
async function switchVersion(index,version){
 if(state.busy||regenerating)return;
 try{const chat=await api.variants('select',{chat:state.chat,index,version});upsert(chat);state.chat=chat;renderMessages();}catch(e){toast(cleanError(e));}
}
// Streams a reply for a chat that already ends with the user's message (same display as a normal send).
async function streamReply(){
 setBusy(true,'send');renderMessages();
 const streaming=messageNode({Role:'assistant',Content:''},state.chat.Messages.length,true);streamBody=streaming.body;streamNode=document.createTextNode('');streamBody.append(streamNode);$('messages').append(streaming.node);
 streamText='';pendingChunk='';$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;
 try{const chat=await api.request('send',{chat:state.chat,contextSize:state.prefs.contextSize});upsert(chat);}
 catch(e){if(!e.message.includes('Cancelled'))toast(e.message.includes('context window')?t('capacityError'):cleanError(e));}
 finally{if(flushId)cancelAnimationFrame(flushId);flushStream();streamBody=null;streamNode=null;setBusy(false);renderMessages();}
}
async function regenerate(index){
 if(state.busy||regenerating||!state.chat)return;
 if(index!==state.chat.Messages.length-1){
  // Earlier reply: branch so that it is the last message, then regenerate there.
  regenerating=true;try{await branchAt(index,false);}finally{regenerating=false;}
  if(state.chat.Messages.length-1!==index||state.chat.Messages[index]?.Role!=='assistant')return;
 }
 const chat=state.chat,message=chat.Messages[index],user=chat.Messages[index-1];if(!message||message.Role!=='assistant'||user?.Role!=='user')return;
 regenerating=true;
 try{
  await api.variants('begin',{chat,index});
  chat.Messages.pop();upsert(chat);
  const route=message.Activity?.route;
  if(route==='research'&&typeof sendWithAgent==='function')await sendWithAgent(user.Content,{regenerate:true,mode:'research'});
  else if(route==='project'&&typeof sendWithProject==='function')await sendWithProject(user.Content,{regenerate:true});
  else await streamReply();
  const current=state.chat?.Id===chat.Id?state.chat:state.chats?.find(c=>c.Id===chat.Id)||chat;
  const produced=current.Messages.length===index+1&&current.Messages[index]?.Role==='assistant';
  const updated=await api.variants(produced?'commit':'abandon',{chat:current,index});
  upsert(updated);if(state.chat?.Id===updated.Id){state.chat=updated;renderMessages();}
  if(!produced)toast(t('regenerateRestored'));
 }catch(e){toast(cleanError(e));}
 finally{regenerating=false;}
}
