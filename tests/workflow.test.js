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
process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.SESSION_SECRET='b'.repeat(64);process.env.USE_SHARED_CONFIG='false';
const {route,safeHtml,benchmarkInput,documentInput}=require('../backend/server');Module._load=original;
let alice,bob;
const req=token=>({headers:{authorization:'Bearer '+token,'x-forwarded-for':'test-isolated'},socket:{remoteAddress:'test'}});
before(async()=>{alice=(await route(req(''),{username:'qa_alice',password:'test-password-123'},'/auth/register')).token;bob=(await route(req(''),{username:'qa_bob',password:'test-password-456'},'/auth/register')).token;});
test('password hashing is salted and secrets authenticated at rest',async()=>{
  const a=await passwordHash('test-password-123'),b=await passwordHash('test-password-123');assert.notEqual(a.hash,b.hash);
  assert.equal((await passwordHash('test-password-123',a.salt)).hash,a.hash);
  const secret={appSecret:'never-public'},key='c'.repeat(64),cipher=encrypt(secret,key);assert(!cipher.includes(secret.appSecret));assert.deepEqual(decrypt(cipher,key),secret);assert.throws(()=>decrypt(cipher,'d'.repeat(64)));
});
test('internal address variants are rejected',()=>{for(const a of ['127.0.0.1','10.1.2.3','172.16.0.2','192.168.1.1','169.254.1.2','100.64.0.1','::1','fc00::1','::ffff:127.0.0.1'])assert(privateAddress(a),a);assert(!privateAddress('8.8.8.8'));});
test('search normalization deduplicates and never invents unknown readership',()=>{
  const input=[{doc_url:'https://mp.weixin.qq.com/s?a=1',title:'<b>AI</b>',source:{tag:[{title:'阅读 1.2万'}]}},{doc_url:'https://mp.weixin.qq.com/s?a=1',title:'duplicate'},{doc_url:'https://mp.weixin.qq.com/s?a=2',title:'Another'},{doc_url:'http://internal.test',title:'evil'}];
  const out=normalize(input);assert.equal(out.length,2);assert.equal(out[0].readCount,12000);assert.equal(out[1].readCountText,'未提供');
});
test('AI recommendations must have unique real IDs and use fewer results honestly',()=>{
  const candidates=[1,2,3,4].map(id=>({id:String(id),title:'title'+id}));
  assert.equal(validateRecommendations({recommendations:[1,3,4].map(id=>({id,reason:'主题匹配'}))},candidates).length,3);
  assert.throws(()=>validateRecommendations({recommendations:[1,1,9].map(id=>({id,reason:'fake'}))},candidates));
  assert.equal(validateRecommendations({recommendations:[{id:1,reason:'相关'}]},candidates.slice(0,1)).length,1);
  assert.throws(()=>validateRecommendations({recommendations:[{id:1,reason:'相关'}]},candidates));
});
test('missing benchmark body fails; pasted full text succeeds',async()=>{
  await assert.rejects(()=>benchmarkInput({benchmarkContent:'标题摘要'}),/至少/);
  const body='这是用户提供的真实全文。'.repeat(30);const r=await benchmarkInput({benchmarkContent:body});assert.equal(r.benchmarkSource,'user_pasted');assert.equal(r.benchmarkContent,body);
});
test('upload keeps real Word text and all embedded images',async()=>{
  const r=await documentInput({sourceDocContent:'真实资料：我们提供真实产品功能，不承诺收益。',sourceDocHtml:'<p>真实资料这是足够长度的产品资料。</p><img src="data:image/png;base64,aGVsbG8="><p>图一说明</p><img src="https://example.com/2.png">'});assert.equal(r.sourceImages.length,2);assert(r.sourceDocContent.includes('[资料图片 1]'));assert(r.sourceDocContent.includes('[资料图片 2]'));
});
test('HTML rejects scripts, event handlers, unsafe links and styles',()=>{const out=safeHtml('<h1>文章</h1><img src="https://example.com/a.png" onerror="alert(1)"><p style="background:url(https://bad.test)">正文</p><script>alert(1)</script><a href="javascript:alert(1)">标题</a>');assert(!/script|onerror|url\(/i.test(out));});
test('accounts cannot see or modify each other’s task or credentials',async()=>{
  const user=digest('qa_alice');await collection('article_web_tasks').add({_id:'test-task',user,title:'private',createdAt:'2026'});
  await collection('article_web_variants').add({_id:digest('test-task:model'),user,taskId:'test-task',modelId:'model',articleHtml:'<p>private</p>',status:'idle',activeAttemptId:null,revision:1});
  assert.equal((await route(req(alice),{},'/state')).tasks.length,1);assert.equal((await route(req(bob),{},'/state')).tasks.length,0);
  await assert.rejects(()=>route(req(bob),{taskId:'test-task',modelId:'model',html:'<p>overwrite</p>',revision:1},'/article/save'),/不存在/);
  const saved=await route(req(alice),{taskId:'test-task',modelId:'model',html:'<p>edited</p>',revision:1},'/article/save');assert.equal(saved.revision,2);
  await assert.rejects(()=>route(req(alice),{taskId:'test-task',modelId:'model',html:'<p>stale edit</p>',revision:1},'/article/save'),/另一窗口/);
  assert.equal((await collection('article_web_variants').doc(digest('test-task:model')).get()).data[0].articleHtml,'<p>edited</p>');
});
test('forged session and logged-out session are rejected',async()=>{await assert.rejects(()=>route(req('forged'),{},'/state'),/登录/);const login=await route(req(''),{username:'qa_alice',password:'test-password-123'},'/auth/login');await route(req(login.token),{},'/auth/logout');await assert.rejects(()=>route(req(login.token),{},'/state'),/登录失效/);});
test('publishing refuses unbound accounts without model or WeChat calls',async()=>{await assert.rejects(()=>route(req(alice),{taskId:'test-task',modelId:'model'},'/article/publish'),/绑定/);});
