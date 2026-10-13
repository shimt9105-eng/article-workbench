const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('unchanged drafts switch without saving, while edits arriving during a save remain dirty',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../web/experience.js'),'utf8');
  const calls=[];let release;const task={id:'draft',systemLocked:false,draftRevision:0};let input={originalEssay:'初稿'};
  const c=vm.createContext({window:{wordUploadBusy:false},draftTimer:null,draftRestoring:false,draftGenerationBusy:false,draftSaveChain:Promise.resolve(),draftChangeVersion:0,draftSavedVersion:0,clearTimeout(){},setTimeout(){return 1;},currentDraftInput:()=>({...input}),activeTask:()=>task,editor2:{async saveDraft(p){calls.push(p);if(calls.length===1)await new Promise(r=>{release=r;});task.draftRevision++;return {title:'草稿'};}},renderTasks(){},el:()=>({textContent:''}),toast(){}});
  vm.runInContext(source.slice(source.indexOf('window.flushDraft='),source.indexOf('window.restoreTaskInputs=')),c);
  await c.window.flushDraft();assert.equal(calls.length,0);
  c.window.queueDraftSave();const first=c.window.flushDraft();await Promise.resolve();assert.equal(calls.length,1);
  input={originalEssay:'更新的随笔'};c.window.queueDraftSave();release();await first;
  await c.window.flushDraft();assert.equal(calls.length,2);assert.equal(calls[1].originalEssay,'更新的随笔');assert.equal(calls[1].revision,1);
  await c.window.flushDraft();assert.equal(calls.length,2);
});
