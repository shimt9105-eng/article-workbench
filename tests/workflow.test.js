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
test('Word is optional while invalid uploads still fail explicitly',async()=>{
  const empty=await documentInput({});
  assert.equal(empty.sourceDocContent,'');assert.equal(empty.sourceDocHtml,'');assert.deepEqual(empty.sourceImages,[]);assert.equal(empty.sourceDocImageCount,0);
  await assert.rejects(()=>documentInput({docxBase64:Buffer.from('not a Word document').toString('base64')}),/有效的 .docx/);
  const short=await documentInput({sourceDocContent:'真实短资料',sourceDocHtml:'<p>真实短资料</p>'});assert.equal(short.sourceDocContent,'真实短资料');
});
test('invalid benchmark URLs give a readable error after removing the pasted-body field',async()=>{
  await assert.rejects(()=>benchmarkInput({benchmarkUrl:''}),/有效的对标文章链接/);
  await assert.rejects(()=>benchmarkInput({benchmarkUrl:'https://example.com/article'}),/HTTPS 微信文章链接/);
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
test('initial and feedback generation retain the exact fixed System and guard concurrent attempts',async()=>{
  const user=digest('qa_alice'),config={models:[{id:'qa-text',name:'qa-model',source:'isolated',apiKey:'qa-only',baseUrl:'https://example.com/v1',protocol:'OpenAI Chat',type:'文字模型'}]};
  await collection('article_web_credentials').add({_id:user,encrypted:encrypt(config,process.env.ENCRYPTION_KEY)});
  const created=await route(req(alice),{modelIds:['qa-text'],sourceDocContent:'真实产品资料，明确功能，不虚构承诺。真实产品资料。',benchmarkContent:'这是一份真实全文的隔离测试文本。'.repeat(20),benchmarkUrl:'https://mp.weixin.qq.com/s?test=1',originalEssay:'我自己的实际观点。'},'/task/create');
  const previousFetch=global.fetch;let release,requestBody;
  const pending=new Promise(r=>{release=r;});
  global.fetch=async(url,options)=>{requestBody=JSON.parse(options.body);await pending;return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({html:'<h1>真实文章</h1><p>按照用户事实写作。</p>',comment:'已更新全文'})}}]})};};
  try{
    const generation=route(req(alice),{taskId:created.taskId,modelId:'qa-text'},'/variant/generate');
    while(!requestBody)await new Promise(r=>setImmediate(r));
    assert.equal(requestBody.messages[0].content,require('../backend/core').systemPrompt());
    const input=JSON.parse(requestBody.messages[1].content);assert.equal(input.固定System依据.原始随笔,'我自己的实际观点。');assert.equal(input.任务模式,'initial');
    await assert.rejects(()=>route(req(alice),{taskId:created.taskId,modelId:'qa-text'},'/variant/generate'),/正在生成/);
    release();await generation;
    const latest=(await collection('article_web_variants').doc(digest(created.taskId+':qa-text')).get()).data[0];assert(latest.completedAttemptId);assert.equal(latest.activeAttemptId,null);assert(latest.articleHtml.includes('真实文章'));
    const attempts=latest.completedAttemptId;
    await route(req(alice),{taskId:created.taskId,modelId:'qa-text',instruction:'结尾更具体',selectedText:'用户原句'},'/variant/generate');
    const feedback=JSON.parse(requestBody.messages[1].content);assert.equal(feedback.任务模式,'revise');assert.equal(feedback.用户选中的文章文本,'用户原句');assert.equal(feedback.固定System依据.原始随笔,'我自己的实际观点。');
    const revised=(await collection('article_web_variants').doc(digest(created.taskId+':qa-text')).get()).data[0];assert.notEqual(revised.completedAttemptId,attempts);assert(revised.comments.some(c=>c.text==='结尾更具体'));
  }finally{global.fetch=previousFetch;}
});
test('a failed model preserves the last successful HTML and can be retried separately',async()=>{
  const list=(await route(req(alice),{},'/state')).tasks;const t=list.find(t=>t.variants.some(v=>v.modelId==='qa-text')),v=t.variants.find(v=>v.modelId==='qa-text');const previous=v.articleHtml;
  const originalFetch=global.fetch;global.fetch=async()=>({ok:false,status:503,text:async()=>'{"error":{"message":"provider failure"}}'});
  try{await assert.rejects(()=>route(req(alice),{taskId:t.id,modelId:v.modelId},'/variant/generate'),/HTTP 503/);const failed=(await route(req(alice),{},'/state')).tasks.find(x=>x.id===t.id).variants.find(x=>x.modelId===v.modelId);assert.equal(failed.articleHtml,previous);assert.equal(failed.status,'error');assert.equal(failed.activeAttemptId,null);}finally{global.fetch=originalFetch;}
});


test('source image placement retains desktop fallback and never duplicates existing images',()=>{
  const {placeSourceImages}=require('../backend/source-images');
  const images=[{id:'资料图片 1',src:'https://example.com/one.jpg',alt:'真实资料图',beforeText:'销售 6400 单'}];
  const matched=placeSourceImages('<p>销售 6400 单。</p><p>结尾</p>',images);
  assert.match(matched.html,/<\/p><img .*one\.jpg/);
  assert.equal(matched.warnings.length,0);
  const fallback=placeSourceImages('<p>不匹配的正文。</p>',images);
  assert.equal(fallback.warnings.length,1);
  const again=placeSourceImages(fallback.html,images);
  assert.equal((again.html.match(/<img /g)||[]).length,1);
});
test('an article can be generated without Word and retains its original essay and benchmark',async()=>{
  const fullText='用于隔离验证的对标全文，只有用户实际提供的事实可以参与创作。'.repeat(10);
  const essay='不上传 Word，根据我的观点写文章。';
  const created=await route(req(alice),{modelIds:['qa-text'],benchmarkContent:fullText,benchmarkUrl:'https://mp.weixin.qq.com/s?optional-word=1',originalEssay:essay},'/task/create');
  const previousFetch=global.fetch;let input;
  global.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.messages[0].content,require('../backend/core').systemPrompt());input=JSON.parse(body.messages[1].content);return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({html:'<h1>无需 Word 的文章</h1><p>依照实际观点创作。</p>',comment:'已完成'})}}]})};};
  try{
    await route(req(alice),{taskId:created.taskId,modelId:'qa-text'},'/variant/generate');
    assert.equal(input.固定System依据.原始随笔,essay);assert.equal(input.固定System依据.对标文章正文,fullText);assert.equal(input.固定System依据.资料图片数量,0);assert(!input.固定System依据.资料文档正文);
    const result=(await route(req(alice),{},'/state')).tasks.find(t=>t.id===created.taskId);assert.equal(result.sourceDocTitle,'未上传 Word');assert(result.variants[0].articleHtml.includes('无需 Word 的文章'));
  }finally{global.fetch=previousFetch;}
});
