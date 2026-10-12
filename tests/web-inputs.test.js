const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function browserFixture(){
  const calls=[],elements={sourceFile:{value:''},sourceFileStatus:{textContent:''},clearUpload:{classList:{add(){}}}},storage={getItem(){return null;},setItem(){}};
  const window={WORKBENCH_API:'https://isolated.invalid',dispatchEvent(){}};
  const fetch=async(url,options)=>{
    if(String(url).endsWith('history.json'))return {ok:true,json:async()=>({tasks:[]})};
    const route=String(url).replace(window.WORKBENCH_API,'');const payload=JSON.parse(options.body);calls.push({route,payload});
    const data=route==='/quota'?{remaining:10}:route==='/task/create'?{taskId:'isolated-task'}:route==='/state'?{tasks:[{id:'isolated-task',variants:[]}]}:{ok:true};
    return {ok:true,json:async()=>data};
  };
  const context=vm.createContext({window,fetch,location:{href:'https://isolated.invalid/'},URL,AbortSignal,Event,structuredClone,localStorage:storage,sessionStorage:storage,document:{getElementById(id){assert(id in elements,'Removed input must not be accessed: '+id);return elements[id];}}});
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
