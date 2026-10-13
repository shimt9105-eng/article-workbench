let resolveAuth;
window.authReady=new Promise(resolve=>{resolveAuth=resolve;});
window.completeLogin=resolveAuth;
let currentState=null;
let uploadedDocument=null;
let benchmarkDocument=null;
window.wordUploadBusy=false;
window.wordUploadError='';
const historyReady=fetch(new URL('history.json',location.href),{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('历史文章暂时无法读取，请刷新');return r.json();}).then(s=>s.tasks||[]);

let selections=JSON.parse(sessionStorage.getItem('articleSelections')||'{}');
window.webApi=async function(path,payload={}){
  const token=localStorage.getItem('articleGuestSession')||sessionStorage.getItem('articleSession');
  const response=await fetch(window.WORKBENCH_API+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(570000)});
  let data;try{data=response.headers?.get('Content-Type')?.includes('application/vnd.article-workbench.gzip')?{encoding:'gzip-media',payload:await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()}:await response.json();}catch{throw new Error('连接中断；请查看任务最新状态后再决定是否重试');}
  if(!['/guest/enter','/bootstrap','/quota','/state','/models','/config/status','/task/draft/new','/task/draft/save','/research/select'].includes(path))window.dispatchEvent(new Event('quotaChanged'));
  if(!response.ok){if(response.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('sessionExpired'));throw new Error(data.error||'操作失败');}
  return data;
};
const api=window.webApi;
window.checkTrialCalls=async calls=>{const q=await api('/quota');if(q.remaining!==undefined&&q.remaining<calls)throw new Error(`只剩 ${q.remaining} 次体验额度，本次需要 ${calls} 次，请减少模型数量或查看历史文章`);};
function saveSelection(){sessionStorage.setItem('articleSelections',JSON.stringify(selections));}
function mergeSelection(s){s.activeTaskId=selections.taskId||s.activeTaskId;for(const t of s.tasks)t.activeModelId=selections[t.id]||t.activeModelId;currentState=s;return s;}
let lastSnapshot=null;
function persistCurrentSnapshot(){if(lastSnapshot&&currentState)window.saveWorkbenchSnapshot({...lastSnapshot,state:currentState});}
async function readState(){const [s,history]=await Promise.all([api('/state'),historyReady]);s.tasks=[...s.tasks,...structuredClone(history)];if(!s.activeTaskId)s.activeTaskId=history[0]?.id||null;const merged=mergeSelection(s);persistCurrentSnapshot();return merged;}
function getState(){return readState();}
const cacheIdentity=()=>window.WORKBENCH_API+':'+localStorage.getItem('articleGuestSecret');
const snapshotDb=new Promise(resolve=>{
  try{const open=indexedDB.open('articleWorkbenchSnapshots',1);open.onupgradeneeded=()=>open.result.createObjectStore('snapshots');open.onsuccess=()=>resolve(open.result);open.onerror=()=>resolve(null);}catch{resolve(null);}
});
window.readWorkbenchSnapshot=async()=>{
  const db=await snapshotDb;if(!db)return null;
  return new Promise(resolve=>{try{const request=db.transaction('snapshots').objectStore('snapshots').get(cacheIdentity());request.onsuccess=()=>{const saved=request.result;const boot=saved?.version===1&&Date.now()-saved.savedAt<86400000?saved.boot:null;if(boot)lastSnapshot=boot;resolve(boot);};request.onerror=()=>resolve(null);}catch{resolve(null);}});
};
window.saveWorkbenchSnapshot=async boot=>{
  lastSnapshot=structuredClone(boot);
  const db=await snapshotDb;if(!db)return;
  try{const transaction=db.transaction('snapshots','readwrite');transaction.objectStore('snapshots').put({version:1,savedAt:Date.now(),boot:structuredClone(boot)},cacheIdentity());transaction.onerror=()=>{};}catch{}
};
window.rememberWorkbenchQuota=quota=>{if(lastSnapshot)window.saveWorkbenchSnapshot({...lastSnapshot,quota});};
window.adoptWorkbenchState=s=>mergeSelection(s);
window.bootstrapWorkbench=async()=>{
  const [response,history]=await Promise.all([api('/bootstrap',{packed:typeof DecompressionStream!=='undefined'?'binary':false}),historyReady]);
  let result=response;
  if(response.encoding==='gzip-media'){
    const packed=response.payload;
    result=JSON.parse(packed.json,(_,item)=>typeof item==='string'?item.replace(/workbench-image:(\d+):end/g,(marker,id)=>packed.images[Number(id)]??marker):item);
  }
  if(response.encoding==='gzip-base64-media'){
    const bytes=Uint8Array.from(atob(response.data),c=>c.charCodeAt(0));
    const packed=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    result=JSON.parse(packed.json,(_,item)=>typeof item==='string'?item.replace(/workbench-image:(\d+):end/g,(marker,id)=>packed.images[Number(id)]??marker):item);
  }
  result.state.tasks=[...result.state.tasks,...structuredClone(history)];
  if(!result.state.activeTaskId)result.state.activeTaskId=history[0]?.id||null;
  return result;
};
function writable(taskId){if(currentState?.tasks.find(t=>t.id===taskId)?.readOnly)throw new Error('历史文章为只读展示，请新建自己的任务');}
async function runVariants(taskId,modelIds,instruction,selectedText){
  writable(taskId);
  await window.checkTrialCalls(modelIds.length);
  const results=await Promise.allSettled(modelIds.map(modelId=>api('/variant/generate',{taskId,modelId,instruction,selectedText})));
  const s=await getState();
  if(results.every(r=>r.status==='rejected'))throw new Error(results.map(r=>r.reason.message).join('；'));
  return s;
}
window.clearUploadedDocument=()=>{uploadedDocument=null;window.wordUploadBusy=false;window.wordUploadError='';document.getElementById('sourceFile').value='';document.getElementById('sourceFileStatus').textContent='';document.getElementById('clearUpload').classList.add('hidden');};
window.setUploadedDocument=data=>{uploadedDocument=data;};
window.setBenchmarkDocument=(data,url)=>{benchmarkDocument=data?{...data,url}:null;};
window.restoreUploadedDocument=data=>{
  uploadedDocument=data?.sourceDocContent||data?.sourceImages?.length?data:null;
  window.wordUploadBusy=false;window.wordUploadError='';document.getElementById('sourceFile').value='';
  document.getElementById('sourceFileStatus').textContent=uploadedDocument?`已保存 ${data.sourceDocTitle} · ${data.sourceDocImageCount||0} 张图片`:'';
  document.getElementById('clearUpload').classList.toggle('hidden',!uploadedDocument);
};
window.editor2={
  newDraft:async()=>{const taskId=crypto.randomUUID().replaceAll('-','');const r=await api('/task/draft/new',{taskId});selections.taskId=r.taskId;saveSelection();return getState();},
  saveDraft:async p=>{const input={...p,...(uploadedDocument||{})};const result=await api('/task/draft/save',input);const t=currentState?.tasks.find(t=>t.id===p.taskId);if(t){t.draftInput=structuredClone(input);t.draftRevision=result.revision;t.updatedAt=result.updatedAt;t.title=result.title;persistCurrentSnapshot();}return result;},
  getState,listModels:()=>api('/models'),
  selectTask:async taskId=>{if(!currentState?.tasks.some(t=>t.id===taskId))throw new Error('任务尚未加载，请刷新任务列表');selections.taskId=taskId;saveSelection();return mergeSelection(currentState);},
  selectVariant:async(taskId,modelId)=>{
    const t=currentState?.tasks.find(t=>t.id===taskId);if(!t||!t.variants?.some(v=>v.modelId===modelId))throw new Error('模型版本尚未加载，请重新打开任务');
    selections.taskId=taskId;selections[taskId]=modelId;saveSelection();return mergeSelection(currentState);
  },
  createTask:async p=>{
    if(window.wordUploadBusy)throw new Error('Word 正在读取，请读取完成后再生成');
    if(window.wordUploadError)throw new Error(window.wordUploadError+'；请更换 Word 或移除上传后继续');
    await window.checkTrialCalls(p.modelIds.length);
    const doc=uploadedDocument||{};
    const benchmark=benchmarkDocument?.url===p.benchmarkUrl?benchmarkDocument:{};
    const result=await api('/task/create',{...p,...doc,benchmarkContent:benchmark.benchmarkContent||'',benchmarkTitle:benchmark.benchmarkTitle||''});
    selections.taskId=result.taskId;saveSelection();
    try{return await runVariants(result.taskId,p.modelIds);}catch(e){window.dispatchEvent(new Event('taskCreated'));throw e;}
  },
  addModels:async p=>{writable(p.taskId);await window.checkTrialCalls(p.modelIds.length);await api('/task/add-models',p);return runVariants(p.taskId,p.modelIds);},
  retryVariant:p=>runVariants(p.taskId,[p.modelId]),
  sendComment:p=>runVariants(p.taskId,[p.modelId],p.instruction,p.selectedText),
  updateArticleText:async p=>{
    writable(p.taskId);
    const v=currentState?.tasks.find(t=>t.id===p.taskId)?.variants.find(v=>v.modelId===p.modelId);
    const result=await api('/article/save',{...p,revision:v?.revision});if(v){v.revision=result.revision;v.articleHtml=p.html;persistCurrentSnapshot();}return result;
  },
  publishArticles:async p=>{
    writable(p.taskId);
    await window.checkTrialCalls(p.modelIds.length);
    const results=[];let coverModel='生图模型';
    for(const modelId of p.modelIds){try{const result=await api('/article/publish',{taskId:p.taskId,modelId});coverModel=result.coverModel||coverModel;results.push(result);}catch(e){results.push({status:'failed',model_name:currentState.tasks.find(t=>t.id===p.taskId)?.variants.find(v=>v.modelId===modelId)?.modelName||modelId,error:e.message});}}
    const completed=results.some(r=>['success','duplicate'].includes(r.status)&&r.media_id);if(completed){const task=currentState.tasks.find(t=>t.id===p.taskId);task.deliveryCompleted=true;persistCurrentSnapshot();}
    return {results,coverModel,coverCount:results.filter(r=>r.status==='success').length};
  }
};
