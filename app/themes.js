'use strict';
// Accent swatches: eight presets and a custom color. Settings → Appearance shows swatches instead of the select, which stays
// hidden and keeps the existing save path (persistWorkspacePreferences), which writes the accent into prefs.appearance.
const accentPresets=['warm','graphite','ocean','forest','plum','rose','teal','gold'];
Object.assign(translations,{
 theme_warm:['Warm charcoal','Sıcak antrasit'],theme_graphite:['Graphite','Grafit'],theme_ocean:['Ocean','Okyanus'],theme_forest:['Forest','Orman'],
 theme_plum:['Plum','Mürdüm'],theme_rose:['Rose','Gül'],theme_teal:['Teal','Turkuaz'],theme_gold:['Gold','Altın'],theme_custom:['Custom color','Özel renk'],
 themeHint:['Choose the accent for this workspace, or pick your own color.','Çalışma alanının vurgu rengini seç ya da kendi rengini belirle.'],
 accentColors:['Accent colors','Vurgu renkleri']
});

// Accent of a preset or a custom color for both modes, as prefs.appearance --accent overrides. 'warm' (the old default) means the
// theme's own accent. Each mode gets the color moved just far enough to stay readable (appearance.js fitAccent); a mode where
// no shade works keeps the theme's accent.
function withAccent(appearance,id,color){
 const A=LumenAppearance;let a=A.sanitizeAppearance(appearance);
 for(const mode of A.MODES){
  a=A.clearOverride(a,'--accent',mode);
  const want=id==='custom'?(/^#[0-9a-f]{6}$/i.test(color||'')?color:null):A.ACCENT_PRESETS[id]?.[mode];
  const fitted=want&&A.fitAccent(a.theme,mode,want);
  if(fitted)a=A.setOverride(a,'--accent',fitted,mode).appearance;
 }
 return a;
}
// The color picker previews while it moves; the value is saved on change (persistWorkspacePreferences).
let accentDraft=null;
function pendingAccentColor(){return accentDraft;}
function clearPendingAccent(){accentDraft=null;}
function currentAccentChoice(){return $('color-theme')?.value||state.prefs.theme||'warm';}

function buildSwatches(){
 const select=$('color-theme');if(!select||$('theme-swatches'))return;
 for(const id of [...accentPresets,'custom'])if(![...select.options].some(o=>o.value===id))select.add(new Option(id,id));
 select.hidden=true;
 const holder=document.createElement('div'),group=document.createElement('div'),name=document.createElement('span');
 group.id='theme-swatches';group.className='theme-swatches';group.setAttribute('role','radiogroup');name.className='theme-name';name.id='theme-name';
 for(const id of [...accentPresets,'custom']){
  const b=document.createElement('button');b.type='button';b.className='theme-swatch theme-swatch-'+id+(id==='custom'?' custom':'');b.dataset.theme=id;b.setAttribute('role','radio');
  if(id==='custom'){const input=document.createElement('input');input.type='color';input.id='custom-accent';input.tabIndex=-1;input.setAttribute('aria-hidden','true');b.append(input);
   input.oninput=()=>{accentDraft=input.value;applyAppearance(withAccent(state.prefs.appearance,'custom',input.value));paintSwatches('custom');};
   input.onchange=()=>{if(!acceptCustomAccent(input.value)){accentDraft=null;applyAppearance();paintSwatches();return;}accentDraft=input.value;select.value='custom';select.dispatchEvent(new Event('change'));};
   b.onclick=e=>{if(e.target!==input)input.click();};}
  else b.onclick=()=>{select.value=id;select.dispatchEvent(new Event('change'));paintSwatches();};
  b.onkeydown=e=>{const keys={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1};if(!(e.key in keys))return;e.preventDefault();const all=[...group.children],next=all[(all.indexOf(b)+keys[e.key]+all.length)%all.length];next.focus();if(next.dataset.theme!=='custom')next.click();};
  group.append(b);
 }
 holder.append(group,name);select.after(holder);paintSwatches();
}
// A custom color is checked as chosen, in the current theme and mode: one that fails a contrast pair is not saved (inline warning).
function acceptCustomAccent(color){
 const v=LumenAppearance.validateOverride(state.prefs.appearance,'--accent',color),note=$('accent-warning');
 if(note){note.hidden=v.ok;note.textContent=v.ok?'':t('contrastLow');note.dataset.key=v.ok?'':'contrastLow';}
 return v.ok;
}
// What each swatch looks like in the current theme and mode: the shade that would actually be applied (fitAccent), never the raw
// preset value. 'warm' is the theme's own accent; a preset with no readable shade shows the theme accent too, since that is what applies.
function swatchColor(id){
 const A=LumenAppearance,a=A.sanitizeAppearance(state.prefs.appearance),own=A.THEMES[a.theme][a.mode]['--accent'];
 if(id==='warm')return own;
 const want=A.ACCENT_PRESETS[id]?.[a.mode];
 return (want&&A.fitAccent(a.theme,a.mode,want))||own;
}
function paintSwatches(choice){
 const group=$('theme-swatches');if(!group)return;const current=choice||currentAccentChoice();
 for(const b of group.children){const id=b.dataset.theme,on=id===current;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;b.setAttribute('aria-label',t('theme_'+id));b.title=t('theme_'+id);if(id!=='custom')b.style.setProperty('--swatch',swatchColor(id));}
 group.setAttribute('aria-label',t('accentColors'));
 const custom=group.querySelector('.custom'),saved=accentDraft||(state.prefs.theme==='custom'?LumenAppearance.resolveTokens(state.prefs.appearance)['--accent']:state.prefs.accentColor),color=/^#[0-9a-f]{6}$/i.test(saved||'')?saved:null;
 if(color){custom.style.setProperty('--swatch',color);custom.dataset.set='true';$('custom-accent').value=color;}
 $('theme-name').textContent=t('theme_'+current);
}

const localizeBeforeThemes=localize;
localize=function(...args){const result=localizeBeforeThemes.apply(this,args);buildSwatches();paintSwatches();return result;};
buildSwatches();
