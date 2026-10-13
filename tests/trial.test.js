const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {digest,passwordHash,encrypt,decrypt,privateAddress}=require('../backend/security');
const {normalize,validateRecommendations,recommend}=require('../backend/research');
const tables=new Map();
function collection(name){
  if(!tables.has(name))tables.set(name,new Map());const table=tables.get(name);
  function query(where={}){
    const matches=v=>Object.entries(where).every(([k,x])=>x?.op==='lt'?v[k]<x.value:v[k]===x);
    return {field(){return this;},limit(){return this;},orderBy(){return this;},async get(){return {data:[...table.values()].filter(matches).map(v=>structuredClone(v))};},async update(data){let updated=0;for(const v of table.values())if(matches(v)){for(const [k,x]of Object.entries(data))v[k]=x?.op==='inc'?(v[k]||0)+x.value:structuredClone(x);updated++;}return {updated};}};
  }
  return {...query(),where:query,async add(data){if(table.has(data._id))throw new Error('duplicate');table.set(data._id,structuredClone(data));return {id:data._id};},doc(id){return {...query({_id:id}),async remove(){table.delete(id);return {deleted:1};}};}};
}
async function runTransaction(callback){
  const snapshot=new Map([...tables].map(([name,records])=>[name,new Map([...records].map(([id,v])=>[id,structuredClone(v)]))]));
  try{return await callback({collection(name){const collectionRef=collection(name);return {...collectionRef,doc(id){const ref=collectionRef.doc(id);return {...ref,async get(){return {data:(await ref.get()).data[0]||null};},async set(value){tables.get(name).set(id,{_id:id,...value});return {};}};}};}});}
  catch(error){tables.clear();for(const [name,records]of snapshot)tables.set(name,records);throw error;}
}
const original=Module._load;
Module._load=function(name,...args){if(name==='@cloudbase/node-sdk')return {SYMBOL_CURRENT_ENV:'isolated-test',init:()=>({database:()=>({collection,runTransaction,command:{lt:value=>({op:'lt',value}),inc:value=>({op:'inc',value})}})})};return original.call(this,name,...args);};
process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.SESSION_SECRET='b'.repeat(64);process.env.USE_SHARED_CONFIG='false';process.env.TRIAL_ENABLED='enabled';process.env.TRIAL_SCOPE='visitor';process.env.GLOBAL_DAILY_LIMIT='quota:30';
const {route,safeHtml,benchmarkInput,documentInput}=require('../backend/server');Module._load=original;

const req=token=>({headers:{authorization:'Bearer '+token,'x-forwarded-for':'isolated-trial'},socket:{remoteAddress:'test'}});
let a,b;
before(async()=>{a=(await route(req(''),{deviceSecret:'1'.repeat(64)},'/guest/enter')).token;b=(await route(req(''),{deviceSecret:'2'.repeat(64)},'/guest/enter')).token;});
test('guest sessions persist browser identity and cannot bypass through registration or forged tokens',async()=>{
  const next=(await route(req(''),{deviceSecret:'1'.repeat(64)},'/guest/enter')).token;
  const decode=t=>JSON.parse(Buffer.from(t.split('.')[0],'base64url'));
  assert.equal(decode(next).user,decode(a).user);
  assert.notEqual(decode(a).user,decode(b).user);
  assert.equal((await route(req(a),{},'/state')).tasks.length,0);
  await assert.rejects(()=>route(req(''),{deviceSecret:'bad'},'/guest/enter'),/访客凭据/);
  await assert.rejects(()=>route(req(''),{username:'bypass',password:'test-password-123'},'/auth/register'),/免登录/);
  await assert.rejects(()=>route(req(a.slice(0,-8)+'forged'),{},'/state'),/登录/);
});
test('each guest gets ten lifetime calls independently, including concurrent requests',async()=>{
  for(const token of [a,b]){const {user}=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));await collection('article_web_credentials').add({_id:user,encrypted:encrypt({tikhub:'test-only'},process.env.ENCRYPTION_KEY)});}
  const originalFetch=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({code:200,data:{items:[]}})};};
  try{
    const first=await Promise.allSettled(Array.from({length:16},()=>route(req(a),{keyword:'isolated'},'/research/search')));
    assert.equal(first.filter(r=>r.status==='fulfilled').length,10);assert.equal(calls,10);
    assert(first.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
    assert.deepEqual(await route(req(a),{},'/quota'),{limit:10,used:10,remaining:0,scope:'visitor'});
    assert.equal((await route(req(b),{},'/quota')).remaining,10);
    const second=await Promise.allSettled(Array.from({length:16},()=>route(req(b),{keyword:'isolated'},'/research/search')));
    assert.equal(second.filter(r=>r.status==='fulfilled').length,10);assert.equal(calls,20);
    const refreshed=(await route(req(''),{deviceSecret:'1'.repeat(64)},'/guest/enter')).token;assert.equal((await route(req(refreshed),{},'/quota')).remaining,0);
    assert.equal((await route(req(a),{},'/state')).tasks.length,0);
  }finally{global.fetch=originalFetch;}
});
test('daily site protection stops at thirty without charging the next visitor',async()=>{
  const c=(await route(req(''),{deviceSecret:'3'.repeat(64)},'/guest/enter')).token,d=(await route(req(''),{deviceSecret:'4'.repeat(64)},'/guest/enter')).token;
  for(const token of [c,d]){const {user}=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));await collection('article_web_credentials').add({_id:user,encrypted:encrypt({tikhub:'test-only'},process.env.ENCRYPTION_KEY)});}
  const originalFetch=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({code:200,data:{items:[]}})};};
  try{
    const results=await Promise.allSettled(Array.from({length:10},()=>route(req(c),{keyword:'isolated'},'/research/search')));assert(results.every(r=>r.status==='fulfilled'));assert.equal(calls,10);
    await assert.rejects(()=>route(req(d),{keyword:'isolated'},'/research/search'),e=>e.status===429);
    assert.equal(calls,10);assert.equal((await route(req(d),{},'/quota')).remaining,10);
  }finally{global.fetch=originalFetch;}
});
test('a new site day retains each visitor lifetime count',async()=>{
  const RealDate=Date,day=new RealDate(Date.now()+86400000);
  global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[day]));}static now(){return day.getTime();}};
  try{assert.equal((await route(req(a),{},'/quota')).remaining,0);}finally{global.Date=RealDate;}
});


test('a provider failure restores visitor quota once, retains prior HTML and still counts toward the daily site cap',async()=>{
 const RealDate=Date,day=new RealDate(Date.now()+2*86400000);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[day]));}static now(){return day.getTime();}};
 const previous=global.fetch;
 try{
  const token=(await route(req(''),{deviceSecret:'5'.repeat(64)},'/guest/enter')).token,{user}=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));
  await collection('article_web_credentials').add({_id:user,encrypted:encrypt({models:[{id:'refund-model',name:'claude-opus-5',source:'isolated',apiKey:'isolated',protocol:'Anthropic Messages',baseUrl:'https://isolated.invalid/v1',type:'文字模型'}]},process.env.ENCRYPTION_KEY)});
  const created=await route(req(token),{modelIds:['refund-model'],originalEssay:'退款隔离测试',benchmarkUrl:'https://mp.weixin.qq.com/s?isolated=refund',benchmarkContent:'这是足够长度的隔离对标正文，不涉及真实用户文章。'.repeat(10)},'/task/create');
  const id=digest(created.taskId+':refund-model');await collection('article_web_variants').doc(id).update({articleHtml:'<p>之前的成功正文</p>'});
  global.fetch=async()=>({ok:false,status:400,text:async()=>JSON.stringify({error:{message:'Too many invalid requests from this session. request id: trace-reference'}})});
  await assert.rejects(route(req(token),{taskId:created.taskId,modelId:'refund-model',instruction:'优化排版'},'/variant/generate'),/体验额度已退回/);
  assert.equal((await route(req(token),{},'/quota')).remaining,10);
  const v=(await collection('article_web_variants').doc(id).get()).data[0];assert.equal(v.articleHtml,'<p>之前的成功正文</p>');assert.equal(v.lastFailure.quotaRefunded,true);assert.equal(v.lastFailure.providerRequestId,'trace-reference');assert.equal(v.activeAttemptId,null);
  const globalId=digest('trial-global:'+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));assert.equal((await collection('article_web_limits').doc(globalId).get()).data[0].count,1);
 }finally{global.fetch=previous;global.Date=RealDate;}
});

test('bootstrap returns only visitor-owned tasks and enabled public model fields without spending trial quota',async()=>{
 const token=(await route(req(''),{deviceSecret:'6'.repeat(64)},'/guest/enter')).token,{user}=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));
 await collection('article_web_credentials').add({_id:user,encrypted:encrypt({models:[{id:'boot-enabled',name:'enabled',source:'isolated',apiKey:'private-api-key',protocol:'OpenAI Chat',baseUrl:'https://isolated.invalid/v1'},{id:'boot-disabled',name:'disabled',enabled:false,source:'isolated',apiKey:'private-api-key',protocol:'OpenAI Chat',baseUrl:'https://isolated.invalid/v1'}]},process.env.ENCRYPTION_KEY)});
 await collection('article_web_tasks').add({_id:'boot-task',user,createdAt:new Date().toISOString(),research:{searchId:'boot-search'}});
 await collection('article_web_variants').add({_id:'boot-variant',user,taskId:'boot-task',modelId:'boot-enabled',articleHtml:'<p>已保存正文</p>',revision:7});
 await collection('article_web_searches').add({_id:'boot-search',user,keyword:'自己的搜索',articles:[],recommendations:[]});
 await collection('article_web_tasks').add({_id:'other-private-task',user:'another-user'});
 const boot=await route(req(token),{},'/bootstrap');
 assert.deepEqual(boot.models,[{id:'boot-enabled',name:'enabled',source:'isolated'}]);
 assert.equal(boot.state.tasks.length,1);assert.equal(boot.state.tasks[0].variants[0].revision,7);assert.equal(boot.state.tasks[0].research.search.keyword,'自己的搜索');
 assert.equal(boot.quota.remaining,10);assert.equal(JSON.stringify(boot).includes('private-api-key'),false);
 const http=require('node:http'),{gunzipSync}=require('node:zlib'),{handle}=require('../backend/server');
 await collection('article_web_variants').doc('boot-variant').update({articleHtml:'<p>已保存正文与图片数据</p>'.repeat(500)});
 const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const response=await new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/bootstrap',method:'POST',headers:{Authorization:'Bearer '+token,'Accept-Encoding':'gzip'}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({headers:res.headers,body:Buffer.concat(chunks)}));});request.on('error',reject);request.end('{}');});
  assert.equal(response.headers['content-encoding'],'gzip');
  const restored=JSON.parse(gunzipSync(response.body));assert.equal(restored.state.tasks[0].variants[0].articleHtml,'<p>已保存正文与图片数据</p>'.repeat(500));assert.equal(restored.quota.remaining,10);
 }finally{await new Promise(r=>server.close(r));}
});

test('fast existing rate buckets still enforce the 120-request cap without resetting it',async()=>{
 const token=(await route(req(''),{deviceSecret:'7'.repeat(64)},'/guest/enter')).token;
 for(let i=0;i<120;i++)await route(req(token),{},'/models');
 await assert.rejects(route(req(token),{},'/models'),e=>e.status===429);
 const {user}=JSON.parse(Buffer.from(token.split('.')[0],'base64url')),id=digest(user+':'+Math.floor(Date.now()/300000));
 assert.equal((await collection('article_web_limits').doc(id).get()).data[0].count,120);
 assert.equal((await collection('article_web_limits').doc(digest('trial:v1:'+user)).get()).data.length,0);
});
