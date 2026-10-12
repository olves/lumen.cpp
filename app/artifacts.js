'use strict';
// Artifact preview: HTML and SVG code blocks in replies get a "Preview" button. The page opens in its own window
// (artifacts.cjs): sandboxed, offline (no network requests at all), nothing saved.
Object.assign(translations,{
 previewCode:['Preview','Önizle'],previewTitle:['Open in a separate, offline window. Scripts run, but the page cannot reach the internet or your files.','Ayrı, çevrimdışı bir pencerede aç. Betikler çalışır ama sayfa internete veya dosyalarına erişemez.'],
});
function artifactKind(lang,code){
 const l=String(lang||'').trim().toLowerCase(),head=code.trimStart().slice(0,200).toLowerCase();
 if(l==='svg'||(['xml','image/svg+xml'].includes(l)&&head.startsWith('<svg'))||(!l&&head.startsWith('<svg')))return 'svg';
 if(['html','htm','xhtml'].includes(l)||head.startsWith('<!doctype html')||head.startsWith('<html'))return 'html';
 return null;
}
const artifactsMarkdown=markdown;markdown=function(body,text){
 artifactsMarkdown(body,text);
 body.querySelectorAll('.code-block').forEach(block=>{
  const head=block.querySelector('.code-heading'),code=block.querySelector('code')?.textContent||'';if(!head||head.querySelector('.code-preview'))return;
  const kind=artifactKind(head.querySelector('.code-lang')?.textContent,code);if(!kind||code.length<20)return;
  const button=el('button','code-preview',t('previewCode'));button.type='button';button.title=t('previewTitle');
  button.onclick=async()=>{try{await api.artifact('open',{code,kind,title:state.chat?.Title||''});}catch(e){toast(cleanError(e));}};
  head.querySelector('.code-copy').before(button);
 });
};
const artifactsLocalize=localize;localize=function(){artifactsLocalize();document.querySelectorAll('.code-preview').forEach(b=>{b.textContent=t('previewCode');b.title=t('previewTitle');});};
