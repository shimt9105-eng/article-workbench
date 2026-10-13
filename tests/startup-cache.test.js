const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(blocked=false){
 const records=new Map(),local=new Map([['articleGuestSecret','visitor-one']]);
 const c=vm.createContext({window:{WORKBENCH_API:'https://isolated.invalid'},Response,Blob,DecompressionStream,atob,Uint8Array,AbortSignal,location:{href:'https://isolated.invalid/'},URL,structuredClone,Date,console,
  localStorage:{getItem:k=>local.get(k)||null},sessionStorage:{getItem:()=>null},fetch:async()=>({ok:true,json:async()=>({tasks:[]})}),
  indexedDB:{open(){if(blocked)throw new Error('disabled');const request={};queueMicrotask(()=>{request.result={transaction(){return {objectStore(){return {put(value,key){records.set(key,structuredClone(value));},get(key){const read={};queueMicrotask(()=>{read.result=records.get(key);read.onsuccess();});return read;}};}};}};request.onsuccess();});return request;}}
 });vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/web-api.js'),'utf8'),c);return {c,local,records};
}
test('browser snapshot belongs to API and visitor identity and cannot leak to another guest',async()=>{
 const {c,local}=fixture();const boot={state:{tasks:[{id:'own',variants:[{articleHtml:'<p>正文与原图</p>',revision:7}]}]},models:[],quota:{remaining:1}};
 await c.window.saveWorkbenchSnapshot(boot);assert.deepEqual(await c.window.readWorkbenchSnapshot(),boot);
 local.set('articleGuestSecret','visitor-two');assert.equal(await c.window.readWorkbenchSnapshot(),null);
 local.set('articleGuestSecret','visitor-one');c.window.WORKBENCH_API='https://different.invalid';assert.equal(await c.window.readWorkbenchSnapshot(),null);
});
test('unavailable browser storage does not prevent network-only startup',async()=>{
 const {c}=fixture(true);await c.window.saveWorkbenchSnapshot({state:{tasks:[]}});assert.equal(await c.window.readWorkbenchSnapshot(),null);
});

test('binary gzip bootstrap restores the full article and original media before adopting state',async()=>{
 const {c}=fixture();const image='data:image/png;base64,QUJD';
 const boot={state:{tasks:[{id:'own',variants:[{articleHtml:'<p>保留正文</p><img src="'+image+'">',revision:7}],sourceImages:[{src:image}]}]},models:[{id:'enabled'}],quota:{remaining:1}};
 const packed=require('../backend/startup-pack').packStartup(boot),bytes=require('node:zlib').gzipSync(packed);
 c.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'application/vnd.article-workbench.gzip'}});
 const result=await c.window.bootstrapWorkbench();
 assert.equal(result.state.tasks[0].variants[0].articleHtml,boot.state.tasks[0].variants[0].articleHtml);assert.equal(result.state.tasks[0].sourceImages[0].src,image);assert.equal(result.quota.remaining,1);assert.equal(result.models[0].id,'enabled');
});
