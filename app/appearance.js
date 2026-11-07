'use strict';
// Appearance model: three built-in themes (native, reading, pro) x two modes, user overrides on top, WCAG contrast checks
// and the one-time migration from the old layout/colorMode/accent/text-size preferences.
// Loaded as a classic <script> in the renderer (globals below) and with require() in the core and in node tests.
// Colors are token values only; components (Task 2+) use var(--token) and never raw colors.
(function(root){
const THEME_IDS=['native','reading','pro'];
const MODES=['dark','light'];
const COLOR_TOKENS=['--surface-0','--surface-1','--surface-2','--surface-3','--text','--text-muted','--border','--accent','--accent-text','--danger','--focus'];
const FONT_TOKENS=['--font-ui','--font-reading','--font-mono'];
const TOKEN_NAMES=[...COLOR_TOKENS,...FONT_TOKENS,'--font-size','--radius'];

const UI_FONT='"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const READING_FONT='Charter,"Iowan Old Style",Cambria,Georgia,serif';
const MONO_FONT='"Cascadia Mono",Consolas,monospace';

// surface-0 app/chat background, surface-1 sidebar, surface-2 composer/cards/user bubble, surface-3 chips/hover/active.
// "native" follows direction A (neutral Windows greys, Windows blue accent), "reading" the merged direction (warm neutral,
// serif messages), "pro" direction C (cool near-black, compact). Accent is used only for the send button, selection, focus and the context bar.
const THEMES={
 native:{
  dark:{'--surface-0':'#202020','--surface-1':'#1b1b1b','--surface-2':'#2a2a2a','--surface-3':'#333333','--text':'#e6e6e6','--text-muted':'#a8a8a8','--border':'#3a3a3a','--accent':'#4cc2ff','--accent-text':'#0b1a24','--danger':'#ff8a80','--focus':'#4cc2ff',
   '--font-ui':UI_FONT,'--font-reading':UI_FONT,'--font-mono':MONO_FONT,'--font-size':'14px','--radius':'6px'},
  light:{'--surface-0':'#f9f9f9','--surface-1':'#f3f3f3','--surface-2':'#ffffff','--surface-3':'#e8e8e8','--text':'#1a1a1a','--text-muted':'#5c5c5c','--border':'#d4d4d4','--accent':'#005fb8','--accent-text':'#ffffff','--danger':'#b3261e','--focus':'#005fb8',
   '--font-ui':UI_FONT,'--font-reading':UI_FONT,'--font-mono':MONO_FONT,'--font-size':'14px','--radius':'6px'}
 },
 reading:{
  dark:{'--surface-0':'#1c1b1a','--surface-1':'#171615','--surface-2':'#24221f','--surface-3':'#2e2b28','--text':'#e8e6e3','--text-muted':'#a39f98','--border':'#33302c','--accent':'#d97757','--accent-text':'#1c1b1a','--danger':'#f2877c','--focus':'#d97757',
   '--font-ui':UI_FONT,'--font-reading':READING_FONT,'--font-mono':MONO_FONT,'--font-size':'15px','--radius':'8px'},
  light:{'--surface-0':'#faf9f7','--surface-1':'#f3f1ed','--surface-2':'#ffffff','--surface-3':'#ebe7e0','--text':'#1f1e1c','--text-muted':'#615c55','--border':'#dcd7cf','--accent':'#b5532f','--accent-text':'#ffffff','--danger':'#b3261e','--focus':'#b5532f',
   '--font-ui':UI_FONT,'--font-reading':READING_FONT,'--font-mono':MONO_FONT,'--font-size':'15px','--radius':'8px'}
 },
 pro:{
  dark:{'--surface-0':'#0f1012','--surface-1':'#131518','--surface-2':'#1b1e23','--surface-3':'#262a31','--text':'#d7d9de','--text-muted':'#9aa0ab','--border':'#2a2e34','--accent':'#e8915b','--accent-text':'#0f1012','--danger':'#ff8a80','--focus':'#e8915b',
   '--font-ui':UI_FONT,'--font-reading':UI_FONT,'--font-mono':MONO_FONT,'--font-size':'13px','--radius':'4px'},
  light:{'--surface-0':'#f6f7f9','--surface-1':'#eceef2','--surface-2':'#ffffff','--surface-3':'#dfe3e9','--text':'#15171a','--text-muted':'#52585f','--border':'#cfd4db','--accent':'#a8481d','--accent-text':'#ffffff','--danger':'#b3261e','--focus':'#a8481d',
   '--font-ui':UI_FONT,'--font-reading':UI_FONT,'--font-mono':MONO_FONT,'--font-size':'13px','--radius':'4px'}
 }
};
const EMPTY=()=>({common:{},dark:{},light:{}});
const DEFAULT_APPEARANCE={theme:'native',mode:'dark',overrides:EMPTY(),statusBar:false};

// ---- color math (same WCAG formulas as themes.js) ----
const HEX=/^#[0-9a-f]{6}$/i;
const rgb=hex=>{const v=parseInt(hex.slice(1),16);return [(v>>16)&255,(v>>8)&255,v&255];};
const lum=hex=>rgb(hex).map(x=>x/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[0.2126,0.7152,0.0722][i],0);
function contrast(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
function toHsl(hex){const [r,g,b]=rgb(hex).map(x=>x/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return [0,0,l];const d=max-min,s=l>0.5?d/(2-max-min):d/(max+min);const h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;return [h*60,s,l];}
function fromHsl(h,s,l){const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return '#'+[f(0),f(8),f(4)].map(x=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0')).join('');}
const bestInk=bg=>contrast(bg,'#ffffff')>=contrast(bg,'#111111')?'#ffffff':'#111111';

// ---- contrast pairs every resolved token set must satisfy ----
// Text pairs >= 4.5; accent and focus are non-text colors and must reach 3 against ALL four surfaces.
const MIN_TEXT=4.5,MIN_UI=3;
const SURFACES=['--surface-0','--surface-1','--surface-2','--surface-3'];
const PAIRS=[];
for(const s of SURFACES)PAIRS.push({fg:'--text',bg:s,min:MIN_TEXT},{fg:'--text-muted',bg:s,min:MIN_TEXT},{fg:'--danger',bg:s,min:MIN_TEXT});
PAIRS.push({fg:'--accent-text',bg:'--accent',min:MIN_TEXT});
for(const s of SURFACES)PAIRS.push({fg:'--accent',bg:s,min:MIN_UI},{fg:'--focus',bg:s,min:MIN_UI});
function failingPair(tokens){
 for(const p of PAIRS){const ratio=contrast(tokens[p.fg],tokens[p.bg]);if(ratio<p.min)return {...p,ratio};}
 return null;
}

// ---- value validation ----
const FONT_VALUE=/^[A-Za-z0-9 ,"'._-]{1,160}$/;
const balanced=v=>(v.match(/"/g)||[]).length%2===0&&(v.match(/'/g)||[]).length%2===0;
function checkValue(token,value){
 if(!TOKEN_NAMES.includes(token))return 'unknown-token';
 if(typeof value!=='string')return 'invalid-value';
 if(COLOR_TOKENS.includes(token))return HEX.test(value)?null:'invalid-color';
 if(FONT_TOKENS.includes(token))return FONT_VALUE.test(value)&&value.trim()&&balanced(value)?null:'invalid-font';
 if(token==='--font-size'){const m=/^(\d{2})(\.5)?px$/.exec(value),n=m&&Number(m[1]+(m[2]||''));return m&&n>=12&&n<=20?null:'invalid-size';}
 if(token==='--radius'){const m=/^(\d{1,2})px$/.exec(value);return m&&Number(m[1])<=16?null:'invalid-radius';}
 return 'unknown-token';
}
const norm=(token,value)=>COLOR_TOKENS.includes(token)?value.toLowerCase():value.trim();
// A font choice always falls back to the theme's own stack, so a font that is not installed cannot break the layout.
const fontStack=(value,fallback)=>value.trim()===fallback?fallback:value.trim().replace(/[,\s]+$/,'')+','+fallback;

const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)?o:{};

// ---- overrides: {common:{fonts,size,radius}, dark:{colors}, light:{colors}} ----
// Each mode's colors are validated on their own, so switching mode never drops the other mode's overrides.
// Cumulative and order-independent: take all well-formed values, check every pair, and while one fails drop the overridden
// token responsible (a token of the failing pair, or --accent when accent-text/focus are derived from it), choosing the first
// in TOKEN_NAMES order. The same set of overrides gives the same result whatever the key order. The base theme itself always passes.
function buildColors(base,over){
 const t={...base,...over};
 if(over['--accent']){if(!over['--accent-text'])t['--accent-text']=bestInk(over['--accent']);if(!over['--focus'])t['--focus']=over['--accent'];}
 return t;
}
function cleanColors(themeId,mode,raw){
 const base=THEMES[themeId][mode],over={};
 for(const token of COLOR_TOKENS)if(Object.prototype.hasOwnProperty.call(raw,token)&&!checkValue(token,raw[token]))over[token]=norm(token,raw[token]);
 for(;;){
  const bad=failingPair(buildColors(base,over));if(!bad)break;
  const derived=t=>t==='--accent-text'||t==='--focus'?['--accent']:[];
  const cands=[bad.fg,bad.bg,...derived(bad.fg),...derived(bad.bg)].filter(t=>t in over);
  if(!cands.length)break;
  cands.sort((x,y)=>TOKEN_NAMES.indexOf(x)-TOKEN_NAMES.indexOf(y));
  delete over[cands[0]];
 }
 return over;
}
function cleanCommon(raw){
 const out={};
 for(const token of TOKEN_NAMES)if(!COLOR_TOKENS.includes(token)&&Object.prototype.hasOwnProperty.call(raw,token)&&!checkValue(token,raw[token]))out[token]=norm(token,raw[token]);
 return out;
}
// Always returns a valid {theme,mode,overrides:{common,dark,light},statusBar}; invalid overrides are dropped.
function sanitize(appearance){
 const a=plain(appearance),theme=THEME_IDS.includes(a.theme)?a.theme:'native',mode=MODES.includes(a.mode)?a.mode:'dark',o=plain(a.overrides);
 return {theme,mode,overrides:{common:cleanCommon(plain(o.common)),dark:cleanColors(theme,'dark',plain(o.dark)),light:cleanColors(theme,'light',plain(o.light))},statusBar:a.statusBar===true};
}

// Final token map for the appearance's own mode. Overrides that fail a contrast pair are ignored.
function resolveTokens(appearance){
 const a=sanitize(appearance),base=THEMES[a.theme][a.mode],t=buildColors(base,a.overrides[a.mode]);
 for(const [k,v] of Object.entries(a.overrides.common))t[k]=FONT_TOKENS.includes(k)?fontStack(v,base[k]):v;
 return t;
}

// Validates one override without changing anything: {ok,reason,pair,ratio,min}. Colors are checked for `mode` (default: current).
function validateOverride(appearance,token,value,mode){
 const why=checkValue(token,value);if(why)return {ok:false,reason:why};
 if(!COLOR_TOKENS.includes(token))return {ok:true};
 const a=sanitize(appearance),m=MODES.includes(mode)?mode:a.mode;
 const bad=failingPair(buildColors(THEMES[a.theme][m],{...a.overrides[m],[token]:norm(token,value)}));
 return bad?{ok:false,reason:'low-contrast',pair:[bad.fg,bad.bg],ratio:bad.ratio,min:bad.min}:{ok:true};
}
const copyOver=o=>({common:{...o.common},dark:{...o.dark},light:{...o.light}});
// Applies one override if valid: {ok,appearance,reason}. Colors go to the given mode (default current), others to common.
// A rejected value leaves the appearance unchanged (the UI shows a warning).
function setOverride(appearance,token,value,mode){
 const a=sanitize(appearance),v=validateOverride(a,token,value,mode);
 if(!v.ok)return {...v,appearance:a};
 const o=copyOver(a.overrides);
 if(COLOR_TOKENS.includes(token))o[MODES.includes(mode)?mode:a.mode][token]=norm(token,value);else o.common[token]=norm(token,value);
 return {ok:true,appearance:{...a,overrides:o}};
}
function clearOverride(appearance,token,mode){
 const a=sanitize(appearance),o=copyOver(a.overrides);
 if(COLOR_TOKENS.includes(token))delete o[MODES.includes(mode)?mode:a.mode][token];else delete o.common[token];
 return {...a,overrides:o};
}
function resetOverrides(appearance){return {...sanitize(appearance),overrides:EMPTY()};}

// A partial appearance (e.g. only statusBar or only mode) merges over the previous one. A given overrides section
// (common/dark/light) replaces that section only. The result is sanitized.
function mergeAppearance(previous,patch){
 const prev=sanitize(previous),p=plain(patch),po=plain(p.overrides),overrides=copyOver(prev.overrides);
 for(const sec of ['common','dark','light'])if(po[sec]!==undefined)overrides[sec]=plain(po[sec]);
 return sanitize({theme:p.theme!==undefined?p.theme:prev.theme,mode:p.mode!==undefined?p.mode:prev.mode,statusBar:p.statusBar!==undefined?p.statusBar:prev.statusBar,overrides});
}

// ---- migration from the old preferences ----
// Old accent presets (themes.css) per mode; 'warm' was the default and maps to the new theme's own accent (no override).
const OLD_PRESET_ACCENT={
 graphite:{dark:'#c1c2b8',light:'#414f48'},ocean:{dark:'#8fb4d9',light:'#2f5f8a'},forest:{dark:'#9cc49a',light:'#3d6a3c'},plum:{dark:'#c3a6d9',light:'#6a4a85'},
 rose:{dark:'#e0a3b0',light:'#984358'},teal:{dark:'#86c7c0',light:'#2a6c66'},gold:{dark:'#d9bf7a',light:'#765e1d'}
};
// Per mode: the color as is if it passes, else moved lighter (dark) / darker (light) until it does; null if nothing works.
function fitAccent(theme,mode,hex){
 const probe={theme,mode,overrides:EMPTY()},ok=c=>validateOverride(probe,'--accent',c,mode).ok;
 if(ok(hex))return hex.toLowerCase();
 const [h,s,l0]=toHsl(hex),step=mode==='light'?-0.01:0.01;
 for(let l=l0+step;l>0.05&&l<0.95;l+=step){const c=fromHsl(h,s,l);if(ok(c))return c;}
 return null;
}
// Runs where prefs are loaded (core). Old fields stay. An existing appearance is only sanitized, never rebuilt (idempotent).
function migrate(prefs){
 if(!prefs||typeof prefs!=='object')return prefs;
 if(prefs.appearance&&typeof prefs.appearance==='object')return {...prefs,appearance:sanitize(prefs.appearance)};
 const theme=prefs.layout==='studio'?'pro':'native',mode=prefs.colorMode==='light'?'light':'dark',o=EMPTY();
 for(const m of MODES){
  let want=null;
  if(prefs.theme==='custom'&&HEX.test(prefs.accentColor||''))want=prefs.accentColor;
  else if(OLD_PRESET_ACCENT[prefs.theme])want=OLD_PRESET_ACCENT[prefs.theme][m];
  const fitted=want&&fitAccent(theme,m,want);
  if(fitted)o[m]['--accent']=fitted;
 }
 if([13,15,16].includes(prefs.textSize))o.common['--font-size']=prefs.textSize+'px'; // 14 was the old default: no override
 return {...prefs,appearance:sanitize({theme,mode,overrides:o,statusBar:false})};
}

const api={THEME_IDS,MODES,THEMES,TOKEN_NAMES,COLOR_TOKENS,FONT_TOKENS,PAIRS,DEFAULT_APPEARANCE,contrast,resolveTokens,validateOverride,setOverride,clearOverride,resetOverrides,mergeAppearance,sanitizeAppearance:sanitize,migrateAppearance:migrate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else{Object.assign(root,api);root.LumenAppearance=api;}
})(typeof globalThis!=='undefined'?globalThis:this);
