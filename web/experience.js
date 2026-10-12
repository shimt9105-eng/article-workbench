const el=id=>document.getElementById(id);
let signup=false,search=null,recommendations=[],researchBusy=false;
function message(id,value){el(id).textContent=value;}
function buttonBusy(id,busy,label){el(id).disabled=busy;if(label)el(id).textContent=label;}
function fillRecommendModels(){const select=el('recommendModel'),value=select.value;select.replaceChildren(new Option('请选择来源 / 模型',''));for(const m of availableModels)select.add(new Option(`${m.source} / ${m.name}`,m.id));select.value=value;}
async function connection(){const c=await webApi('/config/status');message('connectionStatus',`${c.shared?'默认使用共享 API 配置':'使用自己的 API 配置'} · 每日额度 ${c.dailyLimit} 次 · 搜索${c.hasSearch?'已配置':'未配置'} · ${c.wechat?`已绑定 ${c.wechat.name}（AppID 尾号 ${c.wechat.appSuffix}）`:'尚未绑定公众号'}`);el('unbindButton').classList.toggle('hidden',!c.wechat);return c;}
window.openSettings=async()=>{el('settingsDialog').classList.remove('hidden');try{await connection();}catch(e){message('connectionStatus',e.message);}el('wxName').focus();};
el('settingsButton').onclick=window.openSettings;
el('closeSettings').onclick=()=>{el('settingsDialog').classList.add('hidden');window.pendingPublish=false;};
el('authToggle').onclick=()=>{signup=!signup;message('authSubmit',signup?'注册并开始':'登录');message('authToggle',signup?'已有账号？登录':'第一次使用？注册账号');el('password').autocomplete=signup?'new-password':'current-password';message('authError','');};
async function entered(){
  el('authPanel').classList.add('hidden');el('workspace').classList.remove('hidden');el('workflowNav').classList.remove('hidden');message('accountLabel',sessionStorage.getItem('articleUsername')||'我的工作台');window.completeLogin();
  await authReady;appState=await editor2.getState();creating=!appState.tasks.length;render();await refreshModels();fillRecommendModels();
  try{const c=await connection();if(!c.models.length)toast('请先配置写作模型');}catch(e){toast(e.message);}
}
el('authForm').onsubmit=async e=>{e.preventDefault();buttonBusy('authSubmit',true);message('authError','');try{
  const r=await webApi(signup?'/auth/register':'/auth/login',{username:el('username').value,password:el('password').value});sessionStorage.setItem('articleSession',r.token);sessionStorage.setItem('articleUsername',r.username);el('password').value='';await entered();
}catch(error){message('authError',error.message);}finally{buttonBusy('authSubmit',false);}};
el('logoutButton').onclick=async()=>{try{await webApi('/auth/logout');}finally{sessionStorage.removeItem('articleSession');sessionStorage.removeItem('articleUsername');sessionStorage.removeItem('articleSelections');location.reload();}};
window.addEventListener('sessionExpired',()=>{sessionStorage.removeItem('articleSession');el('authPanel').classList.remove('hidden');el('workspace').classList.add('hidden');el('workflowNav').classList.add('hidden');message('authError','登录已过期，请重新登录');});
function articleCard(a,index,reason){
  return `<article class="research-card"><div class="research-card-head"><span class="badge">${reason?'推荐 '+(index+1):'搜索结果'}</span><span>${escapeHtml(a.readCountText||'阅读量未提供')}</span></div><h3>${escapeHtml(a.title)}</h3><p class="meta">${escapeHtml(a.account)} · ${escapeHtml(a.publishedText||'日期未提供')}</p><p>${escapeHtml(reason||a.summary||'未提供摘要')}</p><div class="research-card-actions"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">打开原文 ↗</a><button class="secondary" data-article-id="${escapeHtml(a.id)}">选为对标</button></div></article>`;
}
async function recommendSearch(){
  const modelId=el('recommendModel').value;if(!modelId)throw new Error('请明确选择来源 / 推荐模型');
  message('researchStatus','AI 正在从真实搜索结果中筛选对标文章…');
  const r=await webApi('/research/recommend',{searchId:search.id,modelId,goal:el('researchGoal').value});recommendations=r.recommendations;
  el('recommendations').innerHTML=recommendations.map((a,n)=>articleCard(a,n,a.reason)).join('');
  message('researchStatus',recommendations.length===3?`从 ${search.articles.length} 篇结果中推荐 3 篇。推荐依据为标题、摘要及搜索指标，选入后将读取全文。`:`仅找到 ${search.articles.length} 篇，按真实结果推荐 ${recommendations.length} 篇；可尝试更换关键词。`);
  el('recommendRetry').classList.remove('hidden');
}
el('researchForm').onsubmit=async e=>{
  e.preventDefault();if(researchBusy)return;if(!el('recommendModel').value){toast('请先选择推荐模型');return;}
  researchBusy=true;buttonBusy('researchSubmit',true,'正在搜索…');el('recommendRetry').disabled=true;el('recommendations').replaceChildren();el('allResults').classList.add('hidden');search=null;
  try{
    message('researchStatus','正在搜索微信公众号文章…');search=await webApi('/research/search',{keyword:el('keywordInput').value});
    el('searchResults').innerHTML=search.articles.map((a,n)=>articleCard(a,n)).join('');el('allResults').classList.toggle('hidden',!search.articles.length);
    if(!search.articles.length){message('researchStatus','没有找到文章。换一个更具体的关键词试试。');el('recommendRetry').classList.add('hidden');return;}
    await recommendSearch();
  }catch(error){message('researchStatus',error.message);if(search?.articles.length)el('recommendRetry').classList.remove('hidden');}
  finally{researchBusy=false;buttonBusy('researchSubmit',false,'搜索并推荐 3 篇');el('recommendRetry').disabled=false;}
};
el('recommendRetry').onclick=async()=>{if(!search||researchBusy)return;researchBusy=true;buttonBusy('recommendRetry',true);try{await recommendSearch();}catch(e){message('researchStatus',e.message);}finally{researchBusy=false;buttonBusy('recommendRetry',false);}};
el('researchPanel').addEventListener('click',async e=>{
  const button=e.target.closest('[data-article-id]');if(!button||!search)return;const a=search.articles.find(a=>a.id===button.dataset.articleId);if(!a)return;
  creating=true;render();window.setWorkflowStep('write');el('benchmarkInput').value=a.url;el('benchmarkContent').value='';message('benchmarkStatus',`已选入《${a.title}》，正在读取全文…`);button.disabled=true;
  try{const r=await webApi('/benchmark/read',{benchmarkUrl:a.url});el('benchmarkContent').value=r.benchmarkContent;message('benchmarkStatus',`已读取全文 ${r.benchmarkContent.length} 字，生成前可以核对。`);}catch(error){message('benchmarkStatus',error.message);}finally{button.disabled=false;el('benchmarkInput').scrollIntoView({behavior:'smooth',block:'center'});}
});
el('sourceFile').onchange=async()=>{
  const f=el('sourceFile').files?.[0];if(!f)return;if(f.size>8*1024*1024){message('sourceFileStatus','文件超过 8MB，请缩减后重试');return;}
  message('sourceFileStatus','正在读取 Word 正文和全部内嵌图片…');
  try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});
    const parsed=await webApi('/document/read',{docxBase64:data,docxName:f.name});window.setUploadedDocument(parsed);el('sourceContent').value=parsed.sourceDocContent;el('sourceContent').readOnly=true;message('sourceFileStatus',`${f.name} · ${parsed.sourceDocContent.length} 字 · ${parsed.sourceDocImageCount} 张图片。清除上传可改为粘贴资料。`);el('clearUpload').classList.remove('hidden');
  }catch(e){message('sourceFileStatus',e.message);}
};
el('clearUpload').onclick=()=>{window.clearUploadedDocument();el('sourceFile').value='';el('sourceContent').readOnly=false;el('sourceContent').value='';el('clearUpload').classList.add('hidden');};
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
renderActive=function(){previousRender();el('researchPanel').classList.remove('hidden');el('feedbackEmpty').classList.toggle('hidden',!!activeTask());};
window.addEventListener('online',()=>toast('网络已恢复，可查看任务最新状态'));
window.addEventListener('offline',()=>toast('网络已断开，未保存内容请保留；恢复后核对任务状态',12000));
setInterval(async()=>{
  if(!sessionStorage.getItem('articleSession')||pendingTextEdit||document.activeElement===el('commentInput'))return;
  const t=activeTask();if(!t?.variants.some(v=>v.status==='processing'))return;
  try{const next=await editor2.getState();if(JSON.stringify(next)!==JSON.stringify(appState)){appState=next;render();}}catch{}
},6000);
(async()=>{if(sessionStorage.getItem('articleSession')){try{await webApi('/config/status');await entered();}catch{sessionStorage.removeItem('articleSession');message('authError','请重新登录');}}})();

window.setWorkflowStep=async step=>{
  if(!['research','write','feedback'].includes(step))return;
  await commitTextSave();if(pendingTextEdit){toast('正文保存失败，请核对后再切换');return;}
  el('workspace').dataset.step=step;sessionStorage.setItem('articleStep',step);
  for(const b of el('workflowNav').querySelectorAll('[data-step]')){const active=b.dataset.step===step;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  if(step==='feedback'&&activeTask())el('commentInput').focus();
  if(step==='research')fillRecommendModels();
};
el('workflowNav').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b)window.setWorkflowStep(b.dataset.step);});
el('workflowNav').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...el('workflowNav').querySelectorAll('[data-step]')],n=tabs.indexOf(document.activeElement),next=tabs[(n+(e.key==='ArrowRight'?1:2))%3];next.focus();window.setWorkflowStep(next.dataset.step);});
el('newTaskButton').addEventListener('click',()=>window.setWorkflowStep('write'));
el('taskList').addEventListener('click',e=>{if(e.target.closest('[data-task-id]'))window.setWorkflowStep('write');});
window.setWorkflowStep(sessionStorage.getItem('articleStep')||'write');
