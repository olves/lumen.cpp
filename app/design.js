'use strict';
// One design for the whole app. prefs.appearance ({theme, mode, overrides, statusBar}; see appearance.js) is resolved into tokens
// that are set on :root one by one (CSSOM, so the page's CSP stays strict); <html> and <body> carry data-theme and data-mode.
// Until Settings → Appearance is rebuilt, the existing controls write prefs.appearance: Theme (the old design select),
// Display mode, text size and the accent swatches (themes.js). Old preference fields are kept as they were.
Object.assign(translations,{interfaceDesign:['Theme','Tema'],interfaceHint:['Colors, fonts and spacing for the whole app.','Uygulamanın tamamı için renkler, yazı tipleri ve aralıklar.'],
 themeNative:['Native','Yerli Windows'],themeReading:['Reading','Okuma'],themePro:['Pro','Profesyonel'],
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
// Saves a change to the appearance (merged by the core) together with any old fields that mirror it.
let appearanceSaving=Promise.resolve();
function saveAppearance(patch,legacy={}){
 appearanceSaving=appearanceSaving.then(async()=>{const previous=state.prefs;try{state.prefs=await api.preferences({...state.prefs,...legacy,appearance:{...currentAppearance(),...patch}});applyAppearance();if(motionAllowed())$('chat-page').animate([{opacity:.75},{opacity:1}],{duration:120,easing:'ease-out'});}catch(e){state.prefs=previous;applyAppearance();toast(e.message);}});
 return appearanceSaving;
}
$('interface-design').onchange=()=>saveAppearance({theme:$('interface-design').value});
$('display-mode').onchange=()=>{const mode=$('display-mode').value;saveAppearance({mode},{colorMode:mode});};
window.addEventListener('lumen-ready',()=>applyAppearance(),{once:true});if(state.ready)applyAppearance();
