'use strict';
// Seeing photos: shows whether the selected model can see attached photos and offers the model's own vision projector
// (mmproj, from its Hugging Face repository) when the user asks. Nothing is checked online until the user clicks.
Object.assign(translations,{
 photoVisionHint:['The model sees these photos. Text in them is also read locally.','Model bu fotoğrafları görür. İçlerindeki metin de yerelde okunur.'],
 visionOffer:['Let this model see photos','Bu model fotoğrafları görsün'],
 visionChecking:['Checking the model’s repository…','Modelin deposu kontrol ediliyor…'],
 visionDownload:['Download vision support · {size}','Görme desteğini indir · {size}'],
 visionDownloadNote:['A one-time download from the model’s Hugging Face repository. Your photos stay on this computer.','Modelin Hugging Face deposundan tek seferlik indirme. Fotoğrafların bu bilgisayarda kalır.'],
 visionNone:['This model has no vision support. Pick a model that can see images, for example Gemma 4, Gemma 3 or Qwen2.5-VL.','Bu modelin görme desteği yok. Görüntü görebilen bir model seç; örneğin Gemma 4, Gemma 3 veya Qwen2.5-VL.'],
 visionDownloading:['Downloading vision support. Progress is shown at the top.','Görme desteği indiriliyor. İlerleme üstte görünür.'],
 visionNoHost:['Seeing photos needs the engine host (backend/lumen-host.exe).','Fotoğrafları görmek için motor host’u gerekir (backend/lumen-host.exe).'],
 visionTitle:['Vision','Görme'],visionReadyDetail:['This model can see attached photos.','Bu model eklenen fotoğrafları görebilir.'],visionMissingDetail:['Photos are read as text only. Vision support can be added if the repository has a projector.','Fotoğraflar yalnızca metin olarak okunur. Depoda projektör varsa görme desteği eklenebilir.'],
 visionRemove:['Remove','Kaldır'],visionRemoved:['Vision support removed','Görme desteği kaldırıldı'],visionCheck:['Check for vision support','Görme desteğini kontrol et'],
 photoSeenNote:['Sent to the model as an image.','Modele görüntü olarak gönderildi.'],visionHonest:['Recognition depends on the model. Small models may name the wrong person or character.','Tanıma modele bağlıdır. Küçük modeller kişi veya karakteri yanlış adlandırabilir.']
});
const visionState=new Map();let visionBusy=false;
const visionModel=()=>$('model-picker').value||state.chat?.Model||'';
async function loadVision(model,action='status'){
 if(!model||!api.vision)return null;
 try{const status=await api.vision(action,{model});visionState.set(model,{...(visionState.get(model)||{}),...status,downloading:action==='enable'?!status.ready:(visionState.get(model)?.downloading&&!status.ready)});}
 catch(e){if(action!=='status')toast(cleanError(e));visionState.set(model,{...(visionState.get(model)||{}),error:true});}
 return visionState.get(model);
}
const visionOffer=el('div','vision-offer');visionOffer.hidden=true;$('photo-mode-hint').after(visionOffer);
function sizeLabel(bytes){return bytes?modelSize(bytes):'';}
function paintVisionOffer(){
 const hint=$('photo-mode-hint'),model=visionModel();
 if(hint.hidden||!model){visionOffer.hidden=true;return;}
 const s=visionState.get(model);if(!s){loadVision(model).then(paintVisionOffer);return;}
 hint.textContent=t(s.ready?'photoVisionHint':'photoModelHint');visionOffer.replaceChildren();visionOffer.hidden=false;
 if(s.ready){visionOffer.append(el('small','quiet',t('visionHonest')));return;}
 if(s.host===false){visionOffer.append(el('small','quiet',t('visionNoHost')));return;}
 if(s.downloading){visionOffer.append(el('small','quiet',t('visionDownloading')));return;}
 if(s.checked===false){visionOffer.append(el('small','quiet',t('visionNone')));return;}
 const button=el('button','text-button',s.checked?tf('visionDownload',{size:sizeLabel(s.bytes)}):t(visionBusy?'visionChecking':'visionOffer'));button.type='button';button.disabled=visionBusy||state.busy;
 button.onclick=async()=>{visionBusy=true;paintVisionOffer();await loadVision(model,s.checked?'enable':'check');visionBusy=false;paintVisionOffer();};
 visionOffer.append(button);if(s.checked)visionOffer.append(el('small','quiet',t('visionDownloadNote')));
}
const visionRenderPhotos=renderPhotos;renderPhotos=function(){visionRenderPhotos();paintVisionOffer();};
$('model-picker').addEventListener('change',paintVisionOffer);
const visionLocalize=localize;localize=function(){visionLocalize();paintVisionOffer();};
// A finished or failed projector download updates the offer and the model details.
listen('download-event',event=>{
 if(!/ · vision$/.test(event.name||'')||!['completed','failed','cancelled','paused'].includes(event.phase))return;
 const model=event.name.slice(0,-' · vision'.length);loadVision(model).then(()=>{paintVisionOffer();if(state.page==='settings')renderModelDetails();});
});
// Sent messages: say when the photos reached the model as images.
const visionMessageNode=messageNode;messageNode=function(m,index,stream=false){const result=visionMessageNode(m,index,stream);if(m.ImagesSeen){const note=result.node.querySelector('.photo-note');if(note)note.textContent=t('photoSeenNote');}return result;};
// Settings → model details: vision status for an installed model of the selected repository.
const visionRenderDetails=renderModelDetails;renderModelDetails=function(){
 visionRenderDetails();
 const panel=$('model-details'),model=state.models.find(m=>m.Repo===selectedRepo&&m.Installed);if(!model||!panel)return;
 const s=visionState.get(model.Name);if(!s){loadVision(model.Name).then(s=>{if(s&&selectedRepo===model.Repo)renderModelDetails();});return;}
 const row=el('div','vision-detail'),text=el('div');text.append(el('strong','',t('visionTitle')),el('p','quiet',t(s.ready?'visionReadyDetail':s.checked===false?'visionNone':s.downloading?'visionDownloading':'visionMissingDetail')));row.append(text);
 const action=el('button','secondary');action.type='button';action.disabled=state.busy||visionBusy||s.downloading||s.checked===false||s.host===false;
 action.textContent=s.ready?t('visionRemove'):s.checked?tf('visionDownload',{size:sizeLabel(s.bytes)}):t('visionCheck');
 action.onclick=async()=>{visionBusy=true;await loadVision(model.Name,s.ready?'remove':s.checked?'enable':'check');visionBusy=false;if(s.ready)toast(t('visionRemoved'));renderModelDetails();paintVisionOffer();};
 if(s.checked!==false||s.ready)row.append(action);
 // Right under the download options, above the long model card.
 const anchor=panel.querySelector('.options-note');if(anchor)anchor.after(row);else panel.append(row);
};
