'use strict';
// Settings → Appearance (new UI, Task 4): theme cards with a small live preview, the three font pickers, corner radius, the status
// bar switch and "Reset to defaults". Mode, accent swatches (themes.js) and text size keep their existing controls and save paths.
// Everything is saved through api.preferences as a prefs.appearance patch (design.js saveAppearance/appearancePatch); the core
// merges it (appearance.js mergeAppearance), so a value the model rejects is never stored. Old preference fields are only written
// where they mirror a choice (theme = accent preset, textSize), never deleted. Wrapped in a function scope: no new globals.
(()=>{
Object.assign(translations,{
 themeNativeDesc:['Quiet, native Windows look.','Sade, Windows\'a özgü görünüm.'],
 themeReadingDesc:['Warm tones, serif text for answers.','Sıcak tonlar, yanıtlarda serif yazı.'],
 themeProDesc:['Compact and cool, for long sessions.','Sıkı ve serin tonlu; uzun çalışmalar için.'],
 fontUiLabel:['Interface font','Arayüz yazı tipi'],
 fontReadingLabel:['Reading font','Okuma yazı tipi'],
 fontMonoLabel:['Code font','Kod yazı tipi'],
 fontHint:['Pick a font installed on this PC or type its name. If it is not installed, Lumen falls back to the theme font.','Bu bilgisayarda kurulu bir yazı tipi seç ya da adını yaz. Kurulu değilse Lumen temanın yazı tipine döner.'],
 fontThemeDefault:['Theme default: {font}','Tema varsayılanı: {font}'],
 fontMissing:['This font is not installed. Lumen is using the theme font instead.','Bu yazı tipi kurulu değil. Lumen yerine temanın yazı tipini kullanıyor.'],
 fontInvalid:['This font name cannot be used. Use letters, numbers and spaces.','Bu yazı tipi adı kullanılamaz. Harf, rakam ve boşluk kullan.'],
 radiusLabel:['Corner radius','Köşe yuvarlaklığı'],
 radiusHint:['Rounding of buttons, fields and cards.','Düğme, alan ve kartların köşe yuvarlaklığı.'],
 resetDefaults:['Reset to defaults','Varsayılana dön'],
 resetHint:['Removes your color, font, size and corner changes. Theme, mode and status bar stay.','Renk, yazı tipi, boyut ve köşe değişikliklerini kaldırır. Tema, mod ve durum çubuğu kalır.'],
 resetDone:['Appearance is back to the theme defaults.','Görünüm temanın varsayılanlarına döndü.'],
 contrastLow:['This color is hard to read here, so it was not saved.','Bu renk burada zor okunuyor, bu yüzden kaydedilmedi.'],
 accentReset:['Your accent color is not readable in this theme, so the theme\'s own accent is used.','Vurgu rengin bu temada okunaklı olmadığı için temanın kendi vurgu rengi kullanılıyor.']
});
const A=LumenAppearance;
const FONT_ROWS=[['--font-ui','font-ui','fontUiLabel'],['--font-reading','font-reading','fontReadingLabel'],['--font-mono','font-mono','fontMonoLabel']];
// Fallback list when the system font list is not available (no download: these ship with Windows or common apps).
const SAFE_FONTS={
 '--font-ui':['Segoe UI Variable Text','Segoe UI','Aptos','Arial','Bahnschrift','Calibri','Candara','Corbel','Tahoma','Trebuchet MS','Verdana'],
 '--font-reading':['Charter','Iowan Old Style','Cambria','Georgia','Constantia','Palatino Linotype','Book Antiqua','Sitka Text','Times New Roman','Segoe UI'],
 '--font-mono':['Cascadia Mono','Cascadia Code','Consolas','Lucida Console','Courier New','JetBrains Mono','Fira Code']
};
const RADII=[0,2,4,6,8,12];
let built=false,systemFonts=[];

// Installed check without loading anything: a font that exists changes the measured width against at least one generic family.
const probe=document.createElement('canvas').getContext('2d');
function fontInstalled(name){
 if(!probe)return true;
 const sample='mmmmmmmmmmlliWQ@#0Ğış',quoted='"'+name.replace(/"/g,'')+'"';
 for(const generic of ['monospace','serif','sans-serif']){
  probe.font='40px '+generic;const base=probe.measureText(sample).width;
  probe.font='40px '+quoted+','+generic;if(probe.measureText(sample).width!==base)return true;
 }
 return false;
}
const firstFamily=value=>String(value||'').split(',')[0].trim().replace(/^["']|["']$/g,'');
// The system list only when permission was already granted; Lumen never prompts for it.
async function loadSystemFonts(){
 try{
  if(typeof queryLocalFonts!=='function'||!navigator.permissions)return;
  const p=await navigator.permissions.query({name:'local-fonts'});if(p.state!=='granted')return;
  systemFonts=[...new Set((await queryLocalFonts()).map(f=>f.family))].sort().slice(0,400);
  fillFontLists();
 }catch{}
}
function fillFontLists(){
 for(const [token,id] of FONT_ROWS){
  const list=$(id+'-list');if(!list)continue;
  const names=[...new Set([...SAFE_FONTS[token].filter(fontInstalled),...systemFonts])];
  list.replaceChildren(...names.map(n=>{const o=document.createElement('option');o.value=n;return o;}));
 }
}

function note(id,key){const n=$(id);if(!n)return;n.hidden=!key;n.textContent=key?t(key):'';n.dataset.key=key||'';}
function save(next,legacy){return saveAppearance(appearancePatch(next),legacy);}

// ---- theme cards ----
function chooseTheme(id){
 const cur=currentAppearance();
 if(!A.THEME_IDS.includes(id)||id===cur.theme){$('interface-design').value=cur.theme;return;}
 let next=A.mergeAppearance(cur,{theme:id});
 const preset=state.prefs.theme;
 // An accent preset is re-fitted to the new theme (as choosing it would); a custom color that the new theme makes unreadable is dropped.
 if(A.ACCENT_PRESETS[preset])next=withAccent(next,preset);
 const lost=A.MODES.filter(m=>cur.overrides[m]['--accent']&&!next.overrides[m]['--accent']);
 const legacy={};
 if(lost.length&&!A.MODES.some(m=>next.overrides[m]['--accent']))legacy.theme='warm';
 note('appearance-theme-notice',lost.length?'accentReset':null);
 $('interface-design').value=id;
 return save(next,legacy);
}
function buildThemeCards(){
 const select=$('interface-design'),group=el('div','theme-cards');
 group.id='theme-cards';group.setAttribute('role','radiogroup');
 for(const id of A.THEME_IDS){
  const card=el('button','theme-card');card.type='button';card.setAttribute('role','radio');card.dataset.themeCard=id;
  const preview=el('span','theme-preview');preview.setAttribute('aria-hidden','true');
  const side=el('span','theme-preview-side'),main=el('span','theme-preview-main');
  main.append(el('span','theme-preview-text','Aa'),el('span','theme-preview-line'),el('span','theme-preview-line short'),el('span','theme-preview-send'));
  preview.append(side,main);
  card.append(preview,el('span','theme-card-name'),el('span','theme-card-desc'));
  card.onclick=()=>chooseTheme(id);
  card.onkeydown=e=>{const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];if(!step)return;e.preventDefault();const all=[...group.children],next=all[(all.indexOf(card)+step+all.length)%all.length];next.focus();next.click();};
  group.append(card);
 }
 select.after(group);
 select.onchange=()=>chooseTheme(select.value);
}
function paintThemeCards(){
 const cur=currentAppearance();
 for(const card of document.querySelectorAll('#theme-cards .theme-card')){
  const id=card.dataset.themeCard,on=id===cur.theme,tokens=A.resolveTokens({...cur,theme:id});
  for(const [v,token] of [['--pv-s0','--surface-0'],['--pv-s1','--surface-1'],['--pv-s2','--surface-2'],['--pv-text','--text'],['--pv-muted','--text-muted'],['--pv-border','--border'],['--pv-accent','--accent'],['--pv-radius','--radius'],['--pv-font','--font-reading']])card.style.setProperty(v,tokens[token]);
  card.setAttribute('aria-checked',String(on));card.tabIndex=on?0:-1;
  const name=t({native:'themeNative',reading:'themeReading',pro:'themePro'}[id]),desc=t({native:'themeNativeDesc',reading:'themeReadingDesc',pro:'themeProDesc'}[id]);
  card.querySelector('.theme-card-name').textContent=name;card.querySelector('.theme-card-desc').textContent=desc;card.setAttribute('aria-label',name+'. '+desc);
 }
 $('theme-cards').setAttribute('aria-label',t('interfaceDesign'));
}

// ---- rows: fonts, radius, status bar, reset ----
function row(titleKey,hintKey,control){
 const r=el('div','setting-row'),text=el('div'),h=el('h3','',t(titleKey));h.dataset.i18n=titleKey;h.id='appearance-h-'+titleKey;text.append(h);
 if(hintKey){const p=el('p','',t(hintKey));p.dataset.i18n=hintKey;text.append(p);}
 r.append(text,control);return r;
}
function applyFont(token,id){
 const input=$(id),raw=input.value.trim(),cur=currentAppearance();
 if(!raw){note(id+'-note',null);return cur.overrides.common[token]?save(A.clearOverride(cur,token)):undefined;}
 const value=/[,"']/.test(raw)?raw:'"'+raw+'"';
 const r=A.setOverride(cur,token,value);
 if(!r.ok){note(id+'-note','fontInvalid');return;}
 note(id+'-note',fontInstalled(firstFamily(value))?null:'fontMissing');
 if(cur.overrides.common[token]===r.appearance.overrides.common[token])return;
 return save(r.appearance);
}
function buildRows(){
 const motionRow=$('motion').closest('.setting-row'),rows=[];
 for(const [token,id,label] of FONT_ROWS){
  const box=el('div','font-field'),input=el('input'),list=el('datalist'),n=el('p','appearance-note');
  input.id=id;input.type='text';input.autocomplete='off';input.spellcheck=false;input.maxLength=120;input.setAttribute('list',id+'-list');input.setAttribute('aria-labelledby','appearance-h-'+label);input.setAttribute('aria-describedby',id+'-note');
  list.id=id+'-list';n.id=id+'-note';n.setAttribute('role','status');n.hidden=true;
  input.onchange=()=>applyFont(token,id);
  input.onkeydown=e=>{if(e.key==='Escape'&&input.value){e.stopPropagation();input.value='';applyFont(token,id);}};
  box.append(input,list,n);
  rows.push(row(label,token==='--font-ui'?'fontHint':null,box));
 }
 const radius=el('select');radius.id='appearance-radius';
 for(const px of RADII){const o=document.createElement('option');o.value=String(px);o.textContent=px+' px';radius.append(o);}
 radius.onchange=()=>{const cur=currentAppearance(),px=radius.value+'px';save(px===A.THEMES[cur.theme][cur.mode]['--radius']?A.clearOverride(cur,'--radius'):A.setOverride(cur,'--radius',px).appearance);};
 rows.push(row('radiusLabel','radiusHint',radius));
 const sw=el('label','switch'),box=el('input');box.id='status-bar-toggle';box.type='checkbox';box.setAttribute('aria-labelledby','appearance-h-statusBarLabel');sw.append(box,el('span'));
 box.onchange=()=>saveAppearance({statusBar:box.checked});
 rows.push(row('statusBarLabel','statusBarHint',sw));
 const reset=el('button','secondary',t('resetDefaults'));reset.id='appearance-reset';reset.type='button';reset.dataset.i18n='resetDefaults';
 reset.onclick=()=>{
  const cur=currentAppearance(),size=parseFloat(A.THEMES[cur.theme][cur.mode]['--font-size']);
  clearPendingAccent();for(const id of ['accent-warning','appearance-theme-notice','font-ui-note','font-reading-note','font-mono-note'])note(id,null);
  for(const [,id] of FONT_ROWS)$(id).value='';
  note('appearance-reset-note','resetDone');
  return save(A.resetOverrides(cur),{theme:'warm',...([13,14,15,16].includes(size)?{textSize:size}:{})});
 };
 const resetBox=el('div','reset-field'),done=el('p','appearance-note');done.id='appearance-reset-note';done.setAttribute('role','status');done.hidden=true;resetBox.append(reset,done);
 rows.push(row('resetDefaults','resetHint',resetBox));
 motionRow.before(...rows.slice(0,-1));motionRow.after(rows[rows.length-1]);
 if(!segmentedIds.includes('appearance-radius'))segmentedIds.push('appearance-radius');
}
function paintRows(){
 const cur=currentAppearance(),base=A.THEMES[cur.theme][cur.mode],tokens=A.resolveTokens(cur);
 for(const [token,id] of FONT_ROWS){
  const input=$(id),over=cur.overrides.common[token];
  if(document.activeElement!==input)input.value=over?firstFamily(over):'';
  input.placeholder=tf('fontThemeDefault',{font:firstFamily(base[token])});
  const n=$(id+'-note');if(n.dataset.key!=='fontInvalid')note(id+'-note',over&&!fontInstalled(firstFamily(over))?'fontMissing':null);
 }
 const radius=$('appearance-radius'),px=String(parseFloat(tokens['--radius']));
 if(![...radius.options].some(o=>o.value===px)){const o=document.createElement('option');o.value=px;o.textContent=px+' px';radius.append(o);}
 radius.value=px;
 $('status-bar-toggle').checked=cur.statusBar;
 const size=String(parseFloat(tokens['--font-size']));if([...$('text-size').options].some(o=>o.value===size))$('text-size').value=size;
 for(const node of document.querySelectorAll('#appearance-panel [data-i18n]'))node.textContent=t(node.dataset.i18n);
 for(const n of document.querySelectorAll('#appearance-panel .appearance-note'))if(n.dataset.key)n.textContent=t(n.dataset.key);
}
function paint(){if(!built)return;paintThemeCards();paintRows();if(typeof paintSwatches==='function')paintSwatches();syncSegmented();}
function build(){
 if(built||!$('appearance-panel'))return;built=true;
 buildThemeCards();buildRows();fillFontLists();paint();loadSystemFonts();
}
const beforeUiApply=applyAppearance;applyAppearance=function(){const result=beforeUiApply.apply(this,arguments);paint();return result;};
const beforeUiLocalize=localize;localize=function(){const result=beforeUiLocalize.apply(this,arguments);paint();return result;};
window.addEventListener('lumen-ready',build,{once:true});if(state.ready)build();
})();
