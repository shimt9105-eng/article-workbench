const el=id=>document.getElementById(id);
let search=null,recommendations=[],researchBusy=false,sourceUploadAttempt=0;
function message(id,value){el(id).textContent=value;}
function buttonBusy(id,busy,label){el(id).disabled=busy;if(label)el(id).textContent=label;}
function fillRecommendModels(){const select=el('recommendModel'),value=select.value;select.replaceChildren(new Option('请选择来源 / 模型',''));for(const m of availableModels)select.add(new Option(`${m.source} / ${m.name}`,m.id));select.value=value;}
async function connection(){const c=await webApi('/config/status');message('connectionStatus',`${c.shared?'默认使用共享 API 配置':'使用自己的 API 配置'} · ${c.quota?`总体验额度 ${c.quota.remaining} / 10 次剩余`:`每日额度 ${c.dailyLimit} 次`} · 搜索${c.hasSearch?'已配置':'未配置'} · ${c.wechat?`已绑定 ${c.wechat.name}（AppID 尾号 ${c.wechat.appSuffix}）`:'尚未绑定公众号'}`);el('unbindButton').classList.toggle('hidden',!c.wechat);return c;}
window.openSettings=async()=>{el('settingsDialog').classList.remove('hidden');try{await connection();}catch(e){message('connectionStatus',e.message);}el('wxName').focus();};
el('settingsButton').onclick=window.openSettings;
el('closeSettings').onclick=()=>{el('settingsDialog').classList.add('hidden');window.pendingPublish=false;};
let startupTouched=false;
for(const event of ['pointerdown','keydown','input'])el('workspace').addEventListener(event,()=>{startupTouched=true;},{capture:true});
async function displayWorkbench(boot,source){
  appState=window.adoptWorkbenchState(boot.state);availableModels=boot.models;
  el('authPanel').classList.add('hidden');el('workspace').classList.remove('hidden');el('workflowNav').classList.remove('hidden');message('accountLabel','免登录体验 · 本浏览器独立保存');
  renderModels();creating=!appState.tasks.length;render();fillRecommendModels();await window.restoreTaskInputs?.(activeTask());
  showQuota(boot.quota);window.completeLogin();
  requestAnimationFrame(()=>{if(!el('workspace').dataset.readyMs){el('workspace').dataset.readyMs=String(Math.round(performance.now()));el('workspace').dataset.loadSource=source;}});
}
async function entered(){
  const fresh=window.bootstrapWorkbench();
  const cached=await window.readWorkbenchSnapshot();
  if(cached)await displayWorkbench(cached,'browser-cache');
  try{
    const boot=await fresh;
    window.saveWorkbenchSnapshot(boot);
    if(!cached||!startupTouched)await displayWorkbench(boot,'network');
    else{availableModels=boot.models;showQuota(boot.quota);}
  }catch(error){if(!cached)throw error;toast('已显示本机缓存，最新状态暂未同步；'+error.message,12000);}
}
function validGuestSession(){
  try{const token=localStorage.getItem('articleGuestSession');const session=JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));return session.kind==='guest'&&session.exp>Date.now()+60000;}catch{return false;}
}
let entering=null;
async function enterGuest(){
  if(entering)return entering;
  entering=(async()=>{
    el('guestRetry').classList.add('hidden');message('authError','正在进入免登录体验…');
    try{
      if(!validGuestSession()){
        let deviceSecret=localStorage.getItem('articleGuestSecret');if(!deviceSecret){deviceSecret=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');localStorage.setItem('articleGuestSecret',deviceSecret);}
        const r=await webApi('/guest/enter',{deviceSecret});localStorage.setItem('articleGuestSession',r.token);
      }
      await entered();
    }catch(e){el('authPanel').classList.remove('hidden');el('workspace').classList.add('hidden');el('workflowNav').classList.add('hidden');message('authError',e.message);el('guestRetry').classList.remove('hidden');}
  })().finally(()=>{entering=null;});return entering;
}
el('guestRetry').onclick=enterGuest;
window.addEventListener('sessionExpired',()=>{localStorage.removeItem('articleGuestSession');setTimeout(enterGuest,0);});
function showQuota(q){window.trialRemaining=q.remaining;message('quotaStatus',`${q.scope==='site'?'全站合计':'访客'}体验 ${q.remaining} / ${q.limit} 次剩余${q.remaining===0?' · 已用完':''}`);applyTrialQuota();}
async function refreshQuota(){try{showQuota(await webApi('/quota'));}catch{}}
function applyTrialQuota(){const exhausted=window.trialRemaining===0,history=!creating&&!!activeTask()?.readOnly;el('newTaskButton').disabled=false;el('newTaskForm').querySelector('button[type=submit]').disabled=exhausted;const researchLocked=!!activeTask()&&activeTask().systemLocked!==false;el('researchSubmit').disabled=exhausted||researchBusy||researchLocked;el('recommendRetry').disabled=exhausted||researchBusy||researchLocked;if(exhausted||history){el('publishButton').disabled=true;el('addModelButton').disabled=true;el('sendCommentButton').disabled=true;}}
window.addEventListener('quotaChanged',refreshQuota);
function articleCard(a,index,reason,selected=false){
  const readOnly=!!activeTask()?.readOnly||activeTask()?.systemLocked!==false;
  return `<article class="research-card"><div class="research-card-head"><span class="badge">${selected?'已选对标':reason?'推荐 '+(index+1):'搜索结果'}</span><span>${escapeHtml(a.readCountText||'阅读量未提供')}</span></div><h3>${escapeHtml(a.title)}</h3><p class="meta">${escapeHtml(a.account)} · ${escapeHtml(a.publishedText||'日期未提供')}</p><p>${escapeHtml(reason||a.summary||'未提供摘要')}</p><div class="research-card-actions"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">打开原文 ↗</a><button class="secondary" data-article-id="${escapeHtml(a.id)}" ${selected||readOnly?'disabled':''}>${selected?'已选为对标':'选为对标'}</button></div></article>`;
}
function renderResearch(t=activeTask()){
  const r=t?.research||{},url=t?.systemLocked===false?el('benchmarkInput').value:t?.benchmarkUrl||r.selectedUrl;
  const selected=url?([... (search?.articles||[]),r.selectedArticle||{}].find(a=>a.url===url)||{id:'saved-benchmark',url,title:t?.benchmarkTitle||'已保存的对标文章',account:'',summary:''}):null;
  el('recommendations').innerHTML=(selected?articleCard(selected,0,recommendations.find(a=>a.url===url)?.reason||'',true):'')+recommendations.filter(a=>a.url!==url).map((a,n)=>articleCard(a,n,a.reason)).join('');
  el('searchResults').innerHTML=(search?.articles||[]).map((a,n)=>articleCard(a,n,'',a.url===url)).join('');
  el('allResults').classList.toggle('hidden',!search?.articles?.length);
  const locked=t?.systemLocked!==false;
  for(const id of ['keywordInput','researchGoal','recommendModel'])el(id).disabled=locked;
  el('recommendRetry').classList.toggle('hidden',locked||!search?.articles?.length);
  applyTrialQuota();
}
async function recommendSearch(){
  const modelId=el('recommendModel').value;if(!modelId)throw new Error('请明确选择来源 / 推荐模型');
  message('researchStatus','AI 正在从真实搜索结果中筛选对标文章…');
  const taskId=activeTask().id;const r=await webApi('/research/recommend',{searchId:search.id,modelId,goal:el('researchGoal').value});appState=await editor2.getState();if(activeTask()?.id!==taskId)return;recommendations=r.recommendations;
  renderResearch();
  message('researchStatus',recommendations.length===3?`从 ${search.articles.length} 篇结果中推荐 3 篇。推荐依据为标题、摘要及搜索指标，选入后将读取全文。`:`仅找到 ${search.articles.length} 篇，按真实结果推荐 ${recommendations.length} 篇；可尝试更换关键词。`);
  el('recommendRetry').classList.remove('hidden');
}
el('researchForm').onsubmit=async e=>{
  e.preventDefault();if(researchBusy)return;if(!el('recommendModel').value){toast('请先选择推荐模型');return;}
  researchBusy=true;buttonBusy('researchSubmit',true,'正在搜索…');el('recommendRetry').disabled=true;el('recommendations').replaceChildren();el('allResults').classList.add('hidden');search=null;
  try{
    await window.ensureDraftTask();await window.flushDraft();await window.checkTrialCalls(2);message('researchStatus','正在搜索微信公众号文章…');const taskId=activeTask().id;search=await webApi('/research/search',{taskId,keyword:el('keywordInput').value,goal:el('researchGoal').value,modelId:el('recommendModel').value});
    appState=await editor2.getState();if(activeTask()?.id!==taskId)return;
    el('searchResults').innerHTML=search.articles.map((a,n)=>articleCard(a,n)).join('');el('allResults').classList.toggle('hidden',!search.articles.length);
    if(!search.articles.length){message('researchStatus','搜索服务本次返回 0 篇文章，尚未调用 AI 推荐。可尝试减少关键词或稍后重试。');el('recommendRetry').classList.add('hidden');return;}
    await recommendSearch();
  }catch(error){message('researchStatus',error.message);if(search?.articles.length)el('recommendRetry').classList.remove('hidden');}
  finally{researchBusy=false;buttonBusy('researchSubmit',false,'搜索并推荐 3 篇');el('recommendRetry').disabled=false;}
};
el('recommendRetry').onclick=async()=>{if(!search||researchBusy)return;researchBusy=true;buttonBusy('recommendRetry',true);try{await recommendSearch();}catch(e){message('researchStatus',e.message);}finally{researchBusy=false;buttonBusy('recommendRetry',false);}};
el('researchPanel').addEventListener('click',async e=>{
  const button=e.target.closest('[data-article-id]');if(!button||button.disabled||!search||researchBusy)return;
  const a=search.articles.find(a=>a.id===button.dataset.articleId);if(!a)return;
  researchBusy=true;button.disabled=true;
  try{
    await window.flushDraft();await webApi('/research/select',{taskId:activeTask().id,searchId:search.id,articleId:a.id});
    appState=await editor2.getState();creating=false;render();await window.setWorkflowStep('write');el('benchmarkInput').value=a.url;renderResearch();window.setBenchmarkDocument(null);
    message('benchmarkStatus',`已选入《${a.title}》，正在读取全文…`);
    const r=await webApi('/benchmark/read',{benchmarkUrl:a.url});window.setBenchmarkDocument(r,a.url);message('benchmarkStatus',`已读取 ${r.benchmarkContent.length} 字`);
  }catch(error){message('benchmarkStatus',error.message);toast(error.message,12000);}
  finally{researchBusy=false;applyTrialQuota();el('benchmarkInput').scrollIntoView({behavior:'smooth',block:'center'});}
});
el('benchmarkInput').addEventListener('input',()=>{window.setBenchmarkDocument(null);window.queueDraftSave?.();message('benchmarkStatus','');});
el('sourceFile').onchange=async()=>{
  const f=el('sourceFile').files?.[0];if(!f)return;const attempt=++sourceUploadAttempt;window.setUploadedDocument(null);window.wordUploadError='';el('clearUpload').classList.remove('hidden');
  if(f.size>8*1024*1024){window.wordUploadBusy=false;window.wordUploadError='文件超过 8MB，请缩减后重试';message('sourceFileStatus',window.wordUploadError);return;}
  window.wordUploadBusy=true;
  message('sourceFileStatus','正在读取 Word 正文和全部内嵌图片…');
  try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});
    const parsed=await webApi('/document/read',{docxBase64:data,docxName:f.name});if(attempt!==sourceUploadAttempt)return;window.setUploadedDocument(parsed);window.queueDraftSave?.();message('sourceFileStatus','');el('clearUpload').classList.remove('hidden');
  }catch(e){if(attempt===sourceUploadAttempt){window.wordUploadError=e.message;message('sourceFileStatus',e.message);}}
  finally{if(attempt===sourceUploadAttempt)window.wordUploadBusy=false;}
};
el('clearUpload').onclick=()=>{sourceUploadAttempt++;window.clearUploadedDocument();};
el('bindForm').onsubmit=async e=>{
  e.preventDefault();buttonBusy('bindSubmit',true,'正在验证…');message('bindStatus','验证公众号接口及 IP 白名单…');
  try{const r=await webApi('/wechat/bind',{name:el('wxName').value,appId:el('wxAppId').value.trim(),appSecret:el('wxSecret').value.trim(),author:el('wxAuthor').value});el('wxSecret').value='';message('bindStatus',`已验证并绑定 ${r.name}。可以发送草稿了。`);await connection();
    if(window.pendingPublish){window.pendingPublish=false;el('settingsDialog').classList.add('hidden');await openPublishDialog();}
  }catch(error){message('bindStatus',error.message);}finally{buttonBusy('bindSubmit',false,'验证并绑定');}
};
el('unbindButton').onclick=async()=>{if(!confirm('解除当前公众号绑定？已生成文章与已发送草稿会保留。'))return;try{await webApi('/wechat/unbind');message('bindStatus','已解除绑定');await connection();}catch(e){message('bindStatus',e.message);}};
el('apiConfigForm').onsubmit=async e=>{
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{const p={};if(el('tikhubKey').value.trim())p.tikhub=el('tikhubKey').value.trim();
    if(el('modelName').value.trim()){
      if(!el('modelSource').value||!el('modelUrl').value||!el('modelKey').value)throw new Error('请填写完整的模型来源、Base URL 和 API Key');
      p.appendModel={name:el('modelName').value.trim(),source:el('modelSource').value.trim(),baseUrl:el('modelUrl').value.trim(),apiKey:el('modelKey').value.trim(),protocol:el('modelProtocol').value,type:el('modelType').value};
    }
    if(!Object.keys(p).length)throw new Error('请填写需要保存的配置');await webApi('/config/save',p);e.target.reset();await refreshModels();fillRecommendModels();await connection();toast('配置已保存');
  }catch(error){toast(error.message,10000);}finally{button.disabled=false;}
};
el('draftRecordsButton').onclick=async()=>{el('recordsDialog').classList.remove('hidden');message('draftRecords','正在读取…');try{
  const {items}=await webApi('/drafts');el('draftRecords').innerHTML=items.length?items.map(d=>`<article class="research-card"><h3>${escapeHtml(d.title||d.model_name)}</h3><p>${escapeHtml({success:'已进入草稿箱',running:'正在发送',unknown:'结果待确认，请检查微信草稿箱',failed:'发送失败'}[d.status]||d.status)} · ${timeLabel(d.createdAt)}</p>${d.media_id?`<p class="draft-id">草稿 ID：${escapeHtml(d.media_id)}</p>`:''}${d.error?`<p class="error">${escapeHtml(d.error)}</p>`:''}</article>`).join(''):'<p class="helper">还没有发送记录。生成文章后，点击“发送到公众号草稿箱”。</p>';
}catch(e){message('draftRecords',e.message);}};
el('closeRecords').onclick=()=>el('recordsDialog').classList.add('hidden');
for(const id of ['settingsDialog','recordsDialog'])el(id).addEventListener('click',e=>{if(e.target===el(id))el(id).classList.add('hidden');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){el('settingsDialog').classList.add('hidden');el('recordsDialog').classList.add('hidden');window.pendingPublish=false;}});
window.addEventListener('taskCreated',async()=>{appState=await editor2.getState();creating=false;render();});
el('newTaskButton').addEventListener('click',fillRecommendModels);
const previousRender=renderActive;
renderActive=function(){previousRender();applyTrialQuota();el('researchPanel').classList.remove('hidden');el('feedbackEmpty').classList.toggle('hidden',!creating&&!!activeTask()&&activeTask().systemLocked!==false);};
window.addEventListener('online',()=>toast('网络已恢复，可查看任务最新状态'));
window.addEventListener('offline',()=>toast('网络已断开，未保存内容请保留；恢复后核对任务状态',12000));
setInterval(async()=>{
  if(!localStorage.getItem('articleGuestSession')||pendingTextEdit||document.activeElement===el('commentInput'))return;
  const t=activeTask();if(!t?.variants.some(v=>v.status==='processing'))return;
  try{const next=await editor2.getState();if(JSON.stringify(next)!==JSON.stringify(appState)){appState=next;render();}}catch{}
},6000);
enterGuest();

window.setWorkflowStep=async step=>{
  if(!['research','write','feedback'].includes(step))return;
  await commitTextSave();if(pendingTextEdit){toast('正文保存失败，请核对后再切换');return;}
  el('workspace').dataset.step=step;sessionStorage.setItem('articleStep',step);
  for(const b of el('workflowNav').querySelectorAll('[data-step]')){const active=b.dataset.step===step;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  if(step==='feedback'&&!creating&&activeTask()&&!activeTask().readOnly)el('commentInput').focus();
  if(step==='research'){fillRecommendModels();if(activeTask()?.systemLocked!==false)await window.restoreTaskInputs(activeTask());}
};
el('workflowNav').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b)window.setWorkflowStep(b.dataset.step);});
el('workflowNav').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...el('workflowNav').querySelectorAll('[data-step]')],n=tabs.indexOf(document.activeElement),next=tabs[(n+(e.key==='ArrowRight'?1:2))%3];next.focus();window.setWorkflowStep(next.dataset.step);});


window.setWorkflowStep(sessionStorage.getItem('articleStep')||'write');

let draftTimer=null,draftRestoring=false,draftSaveChain=Promise.resolve(),draftCreation=null,namedTaskBusy=false,draftChangeVersion=0,draftSavedVersion=0;
function currentDraftInput(){return {modelIds:selectedModelIds(),benchmarkUrl:el('benchmarkInput').value,originalEssay:el('essayInput').value,researchKeyword:el('keywordInput').value,researchGoal:el('researchGoal').value,recommendModel:el('recommendModel').value};}
window.ensureDraftTask=async()=>{
  if(activeTask()?.systemLocked===false)return;
  if(!draftCreation)draftCreation=editor2.newDraft();
  try{appState=await draftCreation;creating=false;render();}finally{draftCreation=null;}
};
window.flushDraft=async()=>{
  clearTimeout(draftTimer);draftTimer=null;
  if(window.wordUploadBusy)throw new Error('Word 正在读取，请读取完成后再切换任务');
  if(draftRestoring||window.draftGenerationBusy)return;
  if(draftChangeVersion===draftSavedVersion)return draftSaveChain;
  // Serialize saves so a later edit cannot be overwritten by an earlier response.
  const p=currentDraftInput(),changeVersion=draftChangeVersion;
  const saving=draftSaveChain.catch(()=>{}).then(async()=>{
    if(activeTask()?.systemLocked!==false||draftSavedVersion>=changeVersion)return;
    const t=activeTask();const result=await editor2.saveDraft({...p,taskId:t.id,revision:t.draftRevision});
    draftSavedVersion=changeVersion;renderTasks();el('articleTitle').textContent=result.title;el('saveStatus').textContent='草稿已保存';
  });draftSaveChain=saving;return saving;
};
window.queueDraftSave=()=>{
  if(draftRestoring||window.draftGenerationBusy)return;
  draftChangeVersion++;
  clearTimeout(draftTimer);draftTimer=setTimeout(async()=>{
    try{if(window.wordUploadBusy)return;if(creating||activeTask()?.systemLocked===false){await window.ensureDraftTask();await window.flushDraft();}}
    catch(e){el('saveStatus').textContent='草稿保存失败';toast(e.message,12000);}
  },900);
};
window.restoreTaskInputs=async t=>{
  draftRestoring=true;sourceUploadAttempt++;
  try{
    const p=t?.draftInput||{};const r=t?.research||{};
    search=r.search||null;recommendations=search?.recommendations||[];el('benchmarkInput').value=p.benchmarkUrl||'';el('essayInput').value=p.originalEssay||'';
    el('keywordInput').value=t?.systemLocked===false?p.researchKeyword||r.keyword||'':r.keyword||'';el('researchGoal').value=t?.systemLocked===false?p.researchGoal||r.goal||'':r.goal||'';
    fillRecommendModels();el('recommendModel').value=t?.systemLocked===false?p.recommendModel||r.modelId||'':r.modelId||'';
    for(const box of el('modelOptions').querySelectorAll('input'))box.checked=(p.modelIds||[]).includes(box.value);
    window.restoreUploadedDocument(p);window.setBenchmarkDocument(null);
    message('benchmarkStatus','');renderResearch(t);message('researchStatus',search?`已保存 ${search.articles.length} 篇搜索结果、${recommendations.length} 篇 AI 推荐${t?.systemLocked!==false?' · 此任务的对标已锁定':''}`:t?.benchmarkUrl?'已恢复本任务的对标文章；没有保存搜索结果。':'');
    if(t?.systemLocked===false)el('saveStatus').textContent='草稿已保存';
  }finally{draftRestoring=false;draftChangeVersion=0;draftSavedVersion=0;}
};
window.startNamedTask=async()=>{
  if(researchBusy){toast('搜索或推荐正在进行，请完成后再新建任务');return;}
  if(namedTaskBusy)return;namedTaskBusy=true;
  try{
  await commitTextSave();if(pendingTextEdit)throw new Error('正文尚未保存，请稍后重试');
  if(creating&&Object.values(currentDraftInput()).some(v=>Array.isArray(v)?v.length:String(v).trim()))await window.ensureDraftTask();
  await window.flushDraft();
  appState=await editor2.newDraft();creating=false;selectedText='';render();await refreshModels();await window.restoreTaskInputs(activeTask());await window.setWorkflowStep('research');el('keywordInput').focus();
  }finally{namedTaskBusy=false;}
};
for(const id of ['newTaskForm','researchForm']){
  el(id).addEventListener('input',window.queueDraftSave);el(id).addEventListener('change',window.queueDraftSave);
}
el('clearUpload').addEventListener('click',window.queueDraftSave);
