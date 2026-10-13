const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(blocked=false){
 const records=new Map(),local=new Map([['articleGuestSecret','visitor-one']]);
 const c=vm.createContext({window:{WORKBENCH_API:'https://isolated.invalid'},location:{href:'https://isolated.invalid/'},URL,structuredClone,Date,console,
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
