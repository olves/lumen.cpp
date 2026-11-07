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
// "native" follows direction A (neutral Windows greys), "reading" the merged direction (warm neutral, serif messages),
// "pro" direction C (cool near-black, compact). Accent is used only for the send button, selection, focus and the context bar.
const THEMES={
 native:{
  dark:{'--surface-0':'#202020','--surface-1':'#1b1b1b','--surface-2':'#2a2a2a','--surface-3':'#333333','--text':'#e6e6e6','--text-muted':'#a8a8a8','--border':'#3a3a3a','--accent':'#d97757','--accent-text':'#1c1b1a','--danger':'#ff8a80','--focus':'#d97757',
   '--font-ui':UI_FONT,'--font-reading':UI_FONT,'--font-mono':MONO_FONT,'--font-size':'14px','--radius':'6px'},
  light:{'--surface-0':'#f9f9f9','--surface-1':'#f3f3f3','--surface-2':'#ffffff','--surface-3':'#e8e8e8','--text':'#1a1a1a','--text-muted':'#5c5c5c','--border':'#d4d4d4','--accent':'#b5532f','--accent-text':'#ffffff','--danger':'#b3261e','--focus':'#b5532f',
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
const DEFAULT_APPEARANCE={theme:'native',mode:'dark',overrides:{},statusBar:false};

// ---- color math (same WCAG formulas as themes.js) ----
const HEX=/^#[0-9a-f]{6}$/i;
const rgb=hex=>{const v=parseInt(hex.slice(1),16);return [(v>>16)&255,(v>>8)&255,v&255];};
const lum=hex=>rgb(hex).map(x=>x/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[0.2126,0.7152,0.0722][i],0);
function contrast(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
function toHsl(hex){const [r,g,b]=rgb(hex).map(x=>x/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return [0,0,l];const d=max-min,s=l>0.5?d/(2-max-min):d/(max+min);const h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;return [h*60,s,l];}
function fromHsl(h,s,l){const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return '#'+[f(0),f(8),f(4)].map(x=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0')).join('');}
const bestInk=bg=>contrast(bg,'#ffffff')>=contrast(bg,'#111111')?'#ffffff':'#111111';

// ---- contrast pairs every resolved token set must satisfy ----
const MIN_TEXT=4.5,MIN_UI=3;
const SURFACES=['--surface-0','--surface-1','--surface-2','--surface-3'];
function pairs(){
 const list=[];
 for(const s of SURFACES){list.push({fg:'--text',bg:s,min:MIN_TEXT},{fg:'--text-muted',bg:s,min:MIN_TEXT},{fg:'--danger',bg:s,min:MIN_TEXT});}
 list.push({fg:'--accent-text',bg:'--accent',min:MIN_TEXT},{fg:'--accent',bg:'--surface-0',min:MIN_UI},{fg:'--focus',bg:'--surface-0',min:MIN_UI});
 return list;
}
const PAIRS=pairs();
function failingPair(tokens){
 for(const p of PAIRS){const ratio=contrast(tokens[p.fg],tokens[p.bg]);if(ratio<p.min)return {...p,ratio};}
 return null;
}

// ---- override validation ----
const FONT_VALUE=/^[A-Za-z0-9 ,"'._-]{1,160}$/;
function checkValue(token,value){
 if(!TOKEN_NAMES.includes(token))return 'unknown-token';
 if(typeof value!=='string')return 'invalid-value';
 if(COLOR_TOKENS.includes(token))return HEX.test(value)?null:'invalid-color';
 if(FONT_TOKENS.includes(token))return FONT_VALUE.test(value)&&value.trim()?null:'invalid-font';
 if(token==='--font-size'){const m=/^(\d{2})(\.5)?px$/.exec(value);return m&&Number(m[1])>=12&&Number(m[1])<=20?null:'invalid-size';}
 if(token==='--radius'){const m=/^(\d{1,2})px$/.exec(value);return m&&Number(m[1])<=16?null:'invalid-radius';}
 return 'unknown-token';
}
const norm=(token,value)=>COLOR_TOKENS.includes(token)?value.toLowerCase():value.trim();
// A font choice always falls back to the theme's own stack, so a font that is not installed cannot break the layout.
const fontStack=(value,fallback)=>value.trim()===fallback?fallback:value.trim().replace(/[,\s]+$/,'')+','+fallback;

function themeOf(a){const id=THEME_IDS.includes(a?.theme)?a.theme:'native',mode=MODES.includes(a?.mode)?a.mode:'dark';return {id,mode,base:THEMES[id][mode]};}

// Resolves theme + overrides to the final token map. Overrides that are invalid or would drop any contrast pair below the
// minimum are ignored (stored values stay in prefs: they can become valid again in the other mode).
function resolveTokens(appearance){return resolveTokensStrict(appearance,sanitizeOverrides(appearance),themeOf(appearance).base);}

// Validates one override on top of the current appearance. Returns {ok,reason,ratio?,pair?}; nothing is changed.
function validateOverride(appearance,token,value){
 const why=checkValue(token,value);if(why)return {ok:false,reason:why};
 const {base}=themeOf(appearance),current=sanitizeOverrides(appearance);
 const trial={...current,[token]:norm(token,value)};
 const t=resolveTokensStrict(appearance,trial,base);
 const bad=failingPair(t);
 return bad?{ok:false,reason:'low-contrast',pair:[bad.fg,bad.bg],ratio:bad.ratio,min:bad.min}:{ok:true};
}
function resolveTokensStrict(appearance,over,base){
 const t={...base};
 for(const [k,v] of Object.entries(over))t[k]=FONT_TOKENS.includes(k)?fontStack(v,base[k]):v;
 if(over['--accent']){if(!over['--accent-text'])t['--accent-text']=bestInk(over['--accent']);if(!over['--focus'])t['--focus']=over['--accent'];}
 return t;
}
function sanitizeOverrides(appearance){
 const {base}=themeOf(appearance),raw=appearance&&typeof appearance.overrides==='object'&&appearance.overrides||{},kept={};
 for(const token of TOKEN_NAMES){
  if(!Object.prototype.hasOwnProperty.call(raw,token)||checkValue(token,raw[token]))continue;
  const trial={...kept,[token]:norm(token,raw[token])};
  if(!failingPair(resolveTokensStrict(appearance,trial,base)))kept[token]=trial[token];
 }
 return kept;
}
// Applies one override if valid: {ok,appearance,reason}. A rejected value leaves the appearance unchanged (UI shows a warning).
function setOverride(appearance,token,value){
 const a=sanitize(appearance),v=validateOverride(a,token,value);
 if(!v.ok)return {...v,appearance:a};
 return {ok:true,appearance:{...a,overrides:{...a.overrides,[token]:norm(token,value)}}};
}
function clearOverride(appearance,token){const a=sanitize(appearance),o={...a.overrides};delete o[token];return {...a,overrides:o};}
function resetOverrides(appearance){return {...sanitize(appearance),overrides:{}};}

// Always returns a valid {theme,mode,overrides,statusBar}. Invalid overrides are dropped (kept ones are validated for this theme+mode).
function sanitize(appearance){
 const a=appearance&&typeof appearance==='object'?appearance:{};
 const theme=THEME_IDS.includes(a.theme)?a.theme:'native',mode=MODES.includes(a.mode)?a.mode:'dark';
 const out={theme,mode,overrides:{},statusBar:a.statusBar===true};
 out.overrides=sanitizeOverrides({theme,mode,overrides:a.overrides});
 return out;
}

// ---- migration from the old preferences ----
// Old accent presets (themes.css) per mode; 'warm' was the default and maps to the new theme's own accent (no override).
const OLD_PRESET_ACCENT={
 graphite:{dark:'#c1c2b8',light:'#414f48'},ocean:{dark:'#8fb4d9',light:'#2f5f8a'},forest:{dark:'#9cc49a',light:'#3d6a3c'},plum:{dark:'#c3a6d9',light:'#6a4a85'},
 rose:{dark:'#e0a3b0',light:'#984358'},teal:{dark:'#86c7c0',light:'#2a6c66'},gold:{dark:'#d9bf7a',light:'#765e1d'}
};
// A custom color the user picked that fails the contrast rule for this theme/mode is moved (lighter in dark, darker in light) until it passes.
function fitAccent(appearance,hex){
 if(validateOverride(appearance,'--accent',hex).ok)return hex.toLowerCase();
 const [h,s,l0]=toHsl(hex),mode=appearance.mode,step=mode==='light'?-0.01:0.01;
 for(let l=l0+step;l>0.05&&l<0.95;l+=step){const c=fromHsl(h,s,l);if(validateOverride(appearance,'--accent',c).ok)return c;}
 return null;
}
function migrate(prefs){
 if(!prefs||typeof prefs!=='object')return prefs;
 if(prefs.appearance&&typeof prefs.appearance==='object')return prefs; // already migrated: untouched (idempotent)
 const base={theme:prefs.layout==='studio'?'pro':'native',mode:prefs.colorMode==='light'?'light':'dark',overrides:{},statusBar:false};
 const over={};
 let accent=null;
 if(prefs.theme==='custom'&&HEX.test(prefs.accentColor||''))accent=prefs.accentColor.toLowerCase();
 else if(OLD_PRESET_ACCENT[prefs.theme])accent=OLD_PRESET_ACCENT[prefs.theme][base.mode];
 if(accent){const fitted=fitAccent(base,accent);if(fitted)over['--accent']=fitted;}
 if([13,14,15,16].includes(prefs.textSize))over['--font-size']=prefs.textSize+'px';
 base.overrides=over;
 return {...prefs,appearance:sanitize(base)};
}

const api={THEME_IDS,MODES,THEMES,TOKEN_NAMES,COLOR_TOKENS,FONT_TOKENS,PAIRS,DEFAULT_APPEARANCE,contrast,resolveTokens,validateOverride,setOverride,clearOverride,resetOverrides,sanitizeAppearance:sanitize,migrateAppearance:migrate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else{Object.assign(root,api);root.LumenAppearance=api;}
})(typeof globalThis!=='undefined'?globalThis:this);
