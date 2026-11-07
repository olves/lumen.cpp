'use strict';
// One design for the whole app. prefs.appearance ({theme, mode, overrides, statusBar}; see appearance.js) is resolved into tokens
// that are set on :root one by one (CSSOM, so the page's CSP stays strict); <html> and <body> carry data-theme and data-mode.
// Settings → Appearance (appearanceui.js: theme cards, fonts, radius, status bar, reset) and the older controls write prefs.appearance: Theme (hidden select),
// Display mode, text size and the accent swatches (themes.js). Old preference fields are kept as they were.
Object.assign(translations,{interfaceDesign:['Theme','Tema'],interfaceHint:['Colors, fonts and spacing for the whole app.','Uygulamanın tamamı için renkler, yazı tipleri ve aralıklar.'],
 themeNative:['Windows','Windows'],themeReading:['Reading','Okuma'],themePro:['Pro','Profesyonel'],
 displayMode:['Display mode','Görünüm modu'],displayModeHint:['Light or dark, with any theme.','Her temada açık veya koyu.'],darkMode:['Dark','Koyu'],lightMode:['Light','Açık']});
const appearanceModel=globalThis.LumenAppearance;
function currentAppearance(){return appearanceModel.sanitizeAppearance(state.prefs.appearance);}
// Applies an appearance (default: the saved one). A preview can pass an unsaved one; the next refresh puts the saved one back.
function applyAppearance(appearance=currentAppearance()){
 const root=document.documentElement,tokens=appearanceModel.resolveTokens(appearance);
 for(const [name,value] of Object.entries(tokens))root.style.setProperty(name,value);
 for(const node of [root,document.body]){node.dataset.theme=appearance.theme;node.dataset.mode=appearance.mode;}
 delete document.body.dataset.layout;root.style.colorScheme=appearance.mode;
 $('interface-design').value=appearance.theme;$('display-mode').value=appearance.mode;
 return tokens;
}
const refreshWorkspaceBeforeAppearance=refreshWorkspace;refreshWorkspace=function(){refreshWorkspaceBeforeAppearance();applyAppearance();};
// The core merges appearance overrides per entry (a missing token stays), so a full appearance is sent as a patch from the saved
// one: every token that disappeared becomes null (= back to the theme value).
function appearancePatch(next,from=currentAppearance()){
 const a=appearanceModel.sanitizeAppearance(next),overrides={};
 for(const sec of ['common','dark','light']){
  const section={...a.overrides[sec]};
  for(const token of Object.keys(from.overrides[sec]))if(!(token in section))section[token]=null;
  overrides[sec]=section;
 }
 return {theme:a.theme,mode:a.mode,statusBar:a.statusBar,overrides};
}
// Saves a change to the appearance (merged by the core) together with any old fields that mirror it.
let appearanceSaving=Promise.resolve();
function saveAppearance(patch,legacy={}){
 appearanceSaving=appearanceSaving.then(async()=>{const previous=state.prefs;try{state.prefs=await api.preferences({...state.prefs,...legacy,appearance:{...currentAppearance(),...patch}});applyAppearance();if(motionAllowed())$('chat-page').animate([{opacity:.75},{opacity:1}],{duration:120,easing:'ease-out'});}catch(e){state.prefs=previous;applyAppearance();toast(e.message);}});
 return appearanceSaving;
}
$('interface-design').onchange=()=>saveAppearance({theme:$('interface-design').value});
$('display-mode').onchange=()=>{const mode=$('display-mode').value;saveAppearance({mode},{colorMode:mode});};
window.addEventListener('lumen-ready',()=>applyAppearance(),{once:true});if(state.ready)applyAppearance();
