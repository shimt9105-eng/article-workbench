const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(updateArticleText){
  const s=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
  const c=vm.createContext({pendingTextEdit:null,textSavePromise:null,editSaveTimer:null,clearTimeout(){},window:{editor2:{updateArticleText}},ui:{saveStatus:{textContent:''}},toast(){}});
  vm.runInContext(s.slice(s.indexOf('async function commitTextSave() {'),s.indexOf('\nfunction attachPreviewEditing')),c);return c;
}
test('switch save waits for an in-flight edit and serializes the newer edit',async()=>{
  const calls=[];let release;
  const c=fixture(async p=>{calls.push(p);if(calls.length===1)await new Promise(r=>{release=r;});});
  c.pendingTextEdit={taskId:'task',modelId:'first',html:'旧编辑'};const first=c.commitTextSave();
  c.pendingTextEdit={taskId:'task',modelId:'first',html:'新编辑'};const switching=c.commitTextSave();assert.equal(calls.length,1);
  release();await Promise.all([first,switching]);assert.deepEqual(calls.map(p=>p.html),['旧编辑','新编辑']);assert.equal(c.pendingTextEdit,null);assert.equal(c.textSavePromise,null);
});
test('failed save retains the pending article so model switching can refuse to discard it',async()=>{
  const c=fixture(async()=>{throw new Error('隔离保存失败');});const edit={taskId:'task',modelId:'first',html:'仍需保存的正文'};c.pendingTextEdit=edit;
  await c.commitTextSave();assert.equal(c.pendingTextEdit,edit);assert.match(c.ui.saveStatus.textContent,/保存失败/);assert.equal(c.textSavePromise,null);
});
