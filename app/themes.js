'use strict';
// Accent themes: eight presets (themes.css) and a custom color. Settings → Appearance shows swatches instead of the
// select, which stays hidden and keeps the existing save path (persistWorkspacePreferences). For a custom color the accent
// tokens are computed here for the current display mode, so text on the accent stays readable (WCAG 4.5:1 or better).
const accentPresets=['warm','graphite','ocean','forest','plum','rose','teal','gold'];
Object.assign(translations,{
 theme_warm:['Warm charcoal','Sıcak antrasit'],theme_graphite:['Graphite','Grafit'],theme_ocean:['Ocean','Okyanus'],theme_forest:['Forest','Orman'],
 theme_plum:['Plum','Mürdüm'],theme_rose:['Rose','Gül'],theme_teal:['Teal','Turkuaz'],theme_gold:['Gold','Altın'],theme_custom:['Custom color','Özel renk'],
 themeHint:['Choose the accent for this workspace, or pick your own color.','Çalışma alanının vurgu rengini seç ya da kendi rengini belirle.'],
 accentColors:['Accent colors','Vurgu renkleri']
});

const accentTokens=['--button-bg','--button-ink','--accent-ink','--selection','--selection-line','--accent'];
function accentRgb(hex){const v=parseInt(hex.slice(1),16);return [(v>>16)&255,(v>>8)&255,v&255];}
function accentLum(hex){return accentRgb(hex).map(x=>x/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[0.2126,0.7152,0.0722][i],0);}
function accentContrast(a,b){const [x,y]=[accentLum(a),accentLum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
function accentHsl(hex){const [r,g,b]=accentRgb(hex).map(x=>x/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return [0,0,l];const d=max-min,s=l>0.5?d/(2-max-min):d/(max+min);const h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;return [h*60,s,l];}
function accentHex(h,s,l){const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return '#'+[f(0),f(8),f(4)].map(x=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0')).join('');}
// Tokens for one color: lighten (dark mode) or darken (light mode) until text contrast is comfortable.
function customAccent(hex,mode){
 const [h,s0]=accentHsl(hex),s=Math.min(s0,0.7);
 if(mode==='light'){
  let l=0.5,button=accentHex(h,s,l);while(accentContrast(button,'#ffffff')<5.5&&l>0.08){l-=0.01;button=accentHex(h,s,l);}
  let li=l,ink=button;while(accentContrast(ink,'#faf8f4')<6&&li>0.06){li-=0.01;ink=accentHex(h,s,li);}
  return {'--button-bg':button,'--button-ink':'#ffffff','--accent-ink':ink,'--selection':accentHex(h,s*0.45,0.92),'--selection-line':accentHex(h,s*0.4,0.62),'--accent':button};
 }
 let l=0.6,button=accentHex(h,s,l);while(accentContrast(button,'#242423')<7&&l<0.92){l+=0.01;button=accentHex(h,s,l);}
 let buttonInk=accentHex(h,Math.min(s,0.3),0.12);if(accentContrast(button,buttonInk)<4.5)buttonInk='#111111';
 return {'--button-bg':button,'--button-ink':buttonInk,'--accent-ink':accentHex(h,s,Math.min(0.9,l+0.06)),'--selection':accentHex(h,s*0.3,0.19),'--selection-line':accentHex(h,s*0.4,0.45),'--accent':button};
}
function applyCustomAccent(){
 const body=document.body;
 if(body.dataset.theme!=='custom'){for(const t of accentTokens)body.style.removeProperty(t);return;}
 const tokens=customAccent(/^#[0-9a-f]{6}$/i.test(state.prefs.accentColor||'')?state.prefs.accentColor:'#d08a5c',body.dataset.mode==='light'?'light':'dark');
 for(const [k,v] of Object.entries(tokens))body.style.setProperty(k,v);
}

function buildSwatches(){
 const select=$('color-theme');if(!select||$('theme-swatches'))return;
 for(const id of [...accentPresets,'custom'])if(![...select.options].some(o=>o.value===id))select.add(new Option(id,id));
 select.hidden=true;
 const holder=document.createElement('div'),group=document.createElement('div'),name=document.createElement('span');
 group.id='theme-swatches';group.className='theme-swatches';group.setAttribute('role','radiogroup');name.className='theme-name';name.id='theme-name';
 for(const id of [...accentPresets,'custom']){
  const b=document.createElement('button');b.type='button';b.className='theme-swatch theme-swatch-'+id+(id==='custom'?' custom':'');b.dataset.theme=id;b.setAttribute('role','radio');
  if(id==='custom'){const input=document.createElement('input');input.type='color';input.id='custom-accent';input.tabIndex=-1;input.setAttribute('aria-hidden','true');b.append(input);
   input.oninput=()=>{state.prefs.accentColor=input.value;document.body.dataset.theme='custom';applyCustomAccent();paintSwatches();};
   input.onchange=()=>{state.prefs.accentColor=input.value;select.value='custom';select.dispatchEvent(new Event('change'));};
   b.onclick=e=>{if(e.target!==input)input.click();};}
  else b.onclick=()=>{select.value=id;document.body.dataset.theme=id;select.dispatchEvent(new Event('change'));paintSwatches();};
  b.onkeydown=e=>{const keys={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1};if(!(e.key in keys))return;e.preventDefault();const all=[...group.children],next=all[(all.indexOf(b)+keys[e.key]+all.length)%all.length];next.focus();if(next.dataset.theme!=='custom')next.click();};
  group.append(b);
 }
 holder.append(group,name);select.after(holder);paintSwatches();
}
function paintSwatches(){
 const group=$('theme-swatches');if(!group)return;const current=document.body.dataset.theme||'warm';
 for(const b of group.children){const id=b.dataset.theme,on=id===current;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;b.setAttribute('aria-label',t('theme_'+id));b.title=t('theme_'+id);}
 group.setAttribute('aria-label',t('accentColors'));
 const custom=group.querySelector('.custom'),color=/^#[0-9a-f]{6}$/i.test(state.prefs.accentColor||'')?state.prefs.accentColor:null;
 if(color){custom.style.setProperty('--swatch',color);custom.dataset.set='true';$('custom-accent').value=color;}
 $('theme-name').textContent=t('theme_'+current);
}

// Theme or display mode changes from anywhere (Settings, onboarding, preference load) recompute the custom tokens.
new MutationObserver(()=>{applyCustomAccent();paintSwatches();}).observe(document.body,{attributes:true,attributeFilter:['data-theme','data-mode']});
const localizeBeforeThemes=localize;
localize=function(...args){const result=localizeBeforeThemes.apply(this,args);buildSwatches();paintSwatches();applyCustomAccent();return result;};
buildSwatches();applyCustomAccent();
