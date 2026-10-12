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
    return {limit(){return this;},orderBy(){return this;},async get(){return {data:[...table.values()].filter(matches).map(v=>structuredClone(v))};},async update(data){let updated=0;for(const v of table.values())if(matches(v)){for(const [k,x]of Object.entries(data))v[k]=x?.op==='inc'?(v[k]||0)+x.value:structuredClone(x);updated++;}return {updated};}};
  }
  return {...query(),where:query,async add(data){if(table.has(data._id))throw new Error('duplicate');table.set(data._id,structuredClone(data));return {id:data._id};},doc(id){return {...query({_id:id}),async remove(){table.delete(id);return {deleted:1};}};}};
}
const original=Module._load;
Module._load=function(name,...args){if(name==='@cloudbase/node-sdk')return {SYMBOL_CURRENT_ENV:'isolated-test',init:()=>({database:()=>({collection,command:{lt:value=>({op:'lt',value}),inc:value=>({op:'inc',value})}})})};return original.call(this,name,...args);};
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
