const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function browserFixture(historyTasks=[]){
  const calls=[],elements={sourceFile:{value:''},sourceFileStatus:{textContent:''},clearUpload:{classList:{add(){}}}},storage={getItem(){return null;},setItem(){}};
  const window={WORKBENCH_API:'https://isolated.invalid',dispatchEvent(){}};
  let fixtureTask={id:'isolated-task',variants:[{modelId:'first',articleHtml:'<h1>模型一原稿</h1>'},{modelId:'second',articleHtml:'<h1>模型二原稿</h1>'}]};
  const fetch=async(url,options)=>{
    if(String(url).endsWith('history.json'))return {ok:true,json:async()=>({tasks:historyTasks})};
    const route=String(url).replace(window.WORKBENCH_API,'');const payload=JSON.parse(options.body);calls.push({route,payload});
    if(route==='/task/draft/new')fixtureTask={id:payload.taskId,systemLocked:false,draftRevision:0,draftInput:{},variants:[]};
    const data=route==='/task/draft/new'?{taskId:payload.taskId}:route==='/task/draft/save'?{revision:payload.revision+1,title:'真实主题 · 任务',updatedAt:'2026-10-12'}:route==='/quota'?{remaining:10}:route==='/task/create'?{taskId:'isolated-task'}:route==='/state'?{tasks:[fixtureTask]}:{ok:true};
    return {ok:true,json:async()=>data};
  };
  const context=vm.createContext({window,fetch,crypto:require('node:crypto'),location:{href:'https://isolated.invalid/'},URL,AbortSignal,Event,structuredClone,localStorage:storage,sessionStorage:storage,document:{getElementById(id){assert(id in elements,'Removed input must not be accessed: '+id);return elements[id];}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/web-api.js'),'utf8'),context);
  return {window,calls,elements};
}
test('web creation works without the removed text inputs or a Word upload',async()=>{
  const {window,calls}=browserFixture();
  await window.editor2.createTask({modelIds:['isolated-model'],benchmarkUrl:'https://mp.weixin.qq.com/s?test=1',originalEssay:'我的真实观点'});
  const create=calls.find(c=>c.route==='/task/create').payload;
  assert.equal(create.originalEssay,'我的真实观点');assert.equal(create.benchmarkContent,'');assert.equal(create.sourceDocContent,undefined);assert.equal(create.docxBase64,undefined);assert(calls.some(c=>c.route==='/variant/generate'));
});
test('Word text and images are included together; removal stops both from entering the next article',async()=>{
  const {window,calls,elements}=browserFixture();
  window.setUploadedDocument({sourceDocContent:'真实资料 [资料图片 1]',sourceDocHtml:'<p>真实资料</p><img src="data:image/png;base64,aGVsbG8=">',sourceImages:[{id:'资料图片 1',src:'data:image/png;base64,aGVsbG8='}],sourceDocImageCount:1});
  const p={modelIds:['isolated-model'],benchmarkUrl:'https://mp.weixin.qq.com/s?test=1',originalEssay:'我的真实观点'};
  await window.editor2.createTask(p);
  const uploaded=calls.find(c=>c.route==='/task/create').payload;assert.equal(uploaded.sourceImages.length,1);assert(uploaded.sourceDocHtml.includes('<img'));
  window.clearUploadedDocument();assert.equal(elements.sourceFile.value,'');await window.editor2.createTask(p);
  const cleared=calls.filter(c=>c.route==='/task/create').at(-1).payload;assert.equal(cleared.sourceImages,undefined);assert.equal(cleared.sourceDocContent,undefined);
});
test('automatically read benchmark text is used only for the matching article URL',async()=>{
  const {window,calls}=browserFixture();
  const url='https://mp.weixin.qq.com/s?test=1';window.setBenchmarkDocument({benchmarkContent:'自动读取的真实全文',benchmarkTitle:'真实标题'},url);
  await window.editor2.createTask({modelIds:['isolated-model'],benchmarkUrl:url,originalEssay:'我的观点'});
  assert.equal(calls.find(c=>c.route==='/task/create').payload.benchmarkContent,'自动读取的真实全文');
  await window.editor2.createTask({modelIds:['isolated-model'],benchmarkUrl:'https://mp.weixin.qq.com/s?test=2',originalEssay:'新的观点'});
  assert.equal(calls.filter(c=>c.route==='/task/create').at(-1).payload.benchmarkContent,'');
});
test('an uploading or rejected Word cannot silently become a no-upload article',async()=>{
  const {window,calls}=browserFixture();const p={modelIds:['isolated-model'],benchmarkUrl:'https://mp.weixin.qq.com/s?test=1',originalEssay:'我的观点'};
  window.wordUploadBusy=true;await assert.rejects(()=>window.editor2.createTask(p),/Word 正在读取/);assert.equal(calls.length,0);
  window.wordUploadBusy=false;window.wordUploadError='无法读取 Word';await assert.rejects(()=>window.editor2.createTask(p),/更换 Word 或移除上传/);assert.equal(calls.length,0);
  window.clearUploadedDocument();await window.editor2.createTask(p);assert(calls.some(c=>c.route==='/task/create'));
});

test('new named task and saving edits are separate from paid generation',async()=>{
  const {window,calls}=browserFixture();const s=await window.editor2.newDraft(),t=s.tasks[0];assert.equal(t.systemLocked,false);
  window.setUploadedDocument({sourceDocTitle:'保存的资料.docx',sourceDocContent:'资料正文'});
  await window.editor2.saveDraft({taskId:t.id,revision:0,originalEssay:'已编辑随笔',researchKeyword:'亚马逊 AI'});
  assert.equal(t.draftRevision,1);assert.equal(t.title,'真实主题 · 任务');
  assert.equal(calls.find(c=>c.route==='/task/draft/save').payload.sourceDocTitle,'保存的资料.docx');
  assert(!calls.some(c=>c.route==='/variant/generate'||c.route==='/task/create'||c.route==='/quota'));
});

test('switching loaded model versions needs no API calls and preserves independent article content',async()=>{
  const {window,calls}=browserFixture();const s=await window.editor2.getState();calls.length=0;
  const firstHtml=s.tasks[0].variants[0].articleHtml;
  for(const modelId of ['second','first','second']){const next=await window.editor2.selectVariant('isolated-task',modelId);assert.equal(next.tasks[0].activeModelId,modelId);assert.equal(next.tasks[0].variants[0].articleHtml,firstHtml);}
  assert.equal(calls.length,0);
  await assert.rejects(()=>window.editor2.selectVariant('isolated-task','missing'),/尚未加载/);assert.equal(calls.length,0);
});

test('task switching uses loaded state and restores saved draft edits without loading tasks again',async()=>{
  const {window,calls}=browserFixture([{id:'history-task',readOnly:true,variants:[{modelId:'history-model',articleHtml:'历史文章'}]}]);
  const s=await window.editor2.newDraft(),id=s.activeTaskId;window.setUploadedDocument({sourceDocTitle:'保存的 Word.docx',sourceDocContent:'已保存的资料'});
  await window.editor2.saveDraft({taskId:id,revision:0,originalEssay:'最新随笔',researchKeyword:'新关键词'});calls.length=0;
  const history=await window.editor2.selectTask('history-task');assert.equal(history.activeTaskId,'history-task');assert.equal(history.tasks.find(t=>t.id==='history-task').variants[0].articleHtml,'历史文章');
  const draft=await window.editor2.selectTask(id);assert.equal(draft.activeTaskId,id);assert.equal(draft.tasks.find(t=>t.id===id).draftInput.originalEssay,'最新随笔');assert.equal(draft.tasks.find(t=>t.id===id).draftInput.sourceDocContent,'已保存的资料');
  await assert.rejects(()=>window.editor2.selectTask('missing'),/尚未加载/);assert.equal(calls.length,0);
});

test('shared snapshots do not duplicate their owner task or replace private live edits',async()=>{
  const examples=[{id:'history-isolated-task',originalTaskId:'isolated-task',readOnly:true,variants:[{modelId:'first',articleHtml:'公开快照'}]}];
  const {window}=browserFixture(examples);
  let s=await window.editor2.getState();assert.equal(s.tasks.length,1);assert.equal(s.tasks[0].id,'isolated-task');assert.equal(s.tasks[0].variants[0].articleHtml,'<h1>模型一原稿</h1>');assert.notEqual(s.tasks[0].readOnly,true);
  s=await window.editor2.newDraft();assert.equal(s.tasks.length,2);assert.equal(s.tasks.find(t=>t.id==='history-isolated-task').readOnly,true);assert.equal(s.tasks.find(t=>t.id==='history-isolated-task').variants[0].articleHtml,'公开快照');
});
