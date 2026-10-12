let resolveAuth;
window.authReady=new Promise(resolve=>{resolveAuth=resolve;});
window.completeLogin=resolveAuth;
let currentState=null;
let uploadedDocument=null;
const historyReady=fetch(new URL('history.json',location.href),{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('历史文章暂时无法读取，请刷新');return r.json();}).then(s=>s.tasks||[]);

let selections=JSON.parse(sessionStorage.getItem('articleSelections')||'{}');
window.webApi=async function(path,payload={}){
  const token=localStorage.getItem('articleGuestSession')||sessionStorage.getItem('articleSession');
  const response=await fetch(window.WORKBENCH_API+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(570000)});
  let data;try{data=await response.json();}catch{throw new Error('连接中断；请查看任务最新状态后再决定是否重试');}
  if(!['/guest/enter','/quota','/state','/models','/config/status'].includes(path))window.dispatchEvent(new Event('quotaChanged'));
  if(!response.ok){if(response.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('sessionExpired'));throw new Error(data.error||'操作失败');}
  return data;
};
const api=window.webApi;
function saveSelection(){sessionStorage.setItem('articleSelections',JSON.stringify(selections));}
function mergeSelection(s){s.activeTaskId=selections.taskId||s.activeTaskId;for(const t of s.tasks)t.activeModelId=selections[t.id]||t.activeModelId;currentState=s;return s;}
async function getState(){const [s,history]=await Promise.all([api('/state'),historyReady]);s.tasks=[...s.tasks,...structuredClone(history)];if(!s.activeTaskId)s.activeTaskId=history[0]?.id||null;return mergeSelection(s);}
function writable(taskId){if(currentState?.tasks.find(t=>t.id===taskId)?.readOnly)throw new Error('历史文章为只读展示，请新建自己的任务');}
async function runVariants(taskId,modelIds,instruction,selectedText){
  writable(taskId);
  const results=await Promise.allSettled(modelIds.map(modelId=>api('/variant/generate',{taskId,modelId,instruction,selectedText})));
  const s=await getState();
  if(results.every(r=>r.status==='rejected'))throw new Error(results.map(r=>r.reason.message).join('；'));
  return s;
}
window.clearUploadedDocument=()=>{uploadedDocument=null;document.getElementById('sourceFileStatus').textContent='';document.getElementById('sourceContent').readOnly=false;document.getElementById('clearUpload').classList.add('hidden');document.getElementById('benchmarkStatus').textContent='';};
window.setUploadedDocument=data=>{uploadedDocument=data;};
window.editor2={
  getState,listModels:()=>api('/models'),
  selectTask:async taskId=>{selections.taskId=taskId;saveSelection();return getState();},
  selectVariant:async(taskId,modelId)=>{selections.taskId=taskId;selections[taskId]=modelId;saveSelection();return getState();},
  createTask:async p=>{
    const doc=uploadedDocument||{sourceDocContent:document.getElementById('sourceContent').value};
    const result=await api('/task/create',{...p,...doc,benchmarkContent:document.getElementById('benchmarkContent').value});
    selections.taskId=result.taskId;saveSelection();
    try{return await runVariants(result.taskId,p.modelIds);}catch(e){window.dispatchEvent(new Event('taskCreated'));throw e;}
  },
  addModels:async p=>{writable(p.taskId);await api('/task/add-models',p);return runVariants(p.taskId,p.modelIds);},
  retryVariant:p=>runVariants(p.taskId,[p.modelId]),
  sendComment:p=>runVariants(p.taskId,[p.modelId],p.instruction,p.selectedText),
  updateArticleText:async p=>{
    writable(p.taskId);
    const v=currentState?.tasks.find(t=>t.id===p.taskId)?.variants.find(v=>v.modelId===p.modelId);
    const result=await api('/article/save',{...p,revision:v?.revision});if(v)v.revision=result.revision;return result;
  },
  publishArticles:async p=>{
    writable(p.taskId);
    const results=[];let coverModel='生图模型';
    for(const modelId of p.modelIds){try{const result=await api('/article/publish',{taskId:p.taskId,modelId});coverModel=result.coverModel||coverModel;results.push(result);}catch(e){results.push({status:'failed',model_name:currentState.tasks.find(t=>t.id===p.taskId)?.variants.find(v=>v.modelId===modelId)?.modelName||modelId,error:e.message});}}
    return {results,coverModel,coverCount:results.filter(r=>r.status==='success').length};
  }
};
