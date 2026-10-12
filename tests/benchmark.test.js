const {test}=require('node:test');
const assert=require('node:assert/strict');
const {articleUrl,pageArticle,providerArticle,readArticle}=require('../backend/benchmark');
const url='https://mp.weixin.qq.com/s?__biz=real&mid=123&idx=1&sn=signed#rd';
const content='这是一篇真实图文文章的完整正文，用于验证读取链路。'.repeat(10);
const result={code:200,data:{content:{_content_type:'article',title:'真实标题',content_text:content,content_noencode:'<p>'+content+'</p>'}}};
test('article URL retains signed parameters and rejects other hosts, ports and paths',()=>{
  assert.equal(articleUrl(url),url.replace('#rd',''));
  for(const bad of ['https://mp.weixin.qq.com:444/s/abc','https://mp.weixin.qq.com.evil.test/s/abc','https://mp.weixin.qq.com/admin','https://user@mp.weixin.qq.com/s/abc'])assert.throws(()=>articleUrl(bad));
});
test('full body is extracted without using a description or a challenge page as the article',()=>{
  assert.equal(pageArticle('<h1 id="activity-name">原文</h1><div id="js_content">'+content+'<script>secret</script></div>').benchmarkContent,content);
  assert.equal(pageArticle('<p>环境异常，验证后继续访问</p>'),null);
  assert.equal(providerArticle(result).benchmarkContent,content);
  for(const data of [{...result,code:500},{code:200,data:{content:{_content_type:'unknown',desc:content,content_text:content}}},{code:200,data:{content:{_content_type:'article',content_text:content}}}])assert.throws(()=>providerArticle(data));
});
test('blocked direct retrieval switches once to the configured detail API and reserves quota first',async()=>{
  const previous=global.fetch;let calls=0,reserved=false;
  global.fetch=async(endpoint,options)=>{calls++;assert(reserved);assert.equal(endpoint,'https://api.tikhub.io/api/v1/wechat_mp/v2/fetch_article_detail_h5');assert.deepEqual(JSON.parse(options.body),{url,raw:false});return {ok:true,json:async()=>result};};
  try{const article=await readArticle(url,{apiKey:'isolated',downloadPage:async()=>{throw new Error('redirect blocked');},beforeProvider:async()=>{reserved=true;}});assert.equal(article.benchmarkTitle,'真实标题');assert.equal(calls,1);}finally{global.fetch=previous;}
});
test('a quota rejection prevents any paid detail request',async()=>{
  const previous=global.fetch;let calls=0;global.fetch=async()=>{calls++;};
  try{await assert.rejects(()=>readArticle(url,{apiKey:'isolated',downloadPage:async()=>({buffer:Buffer.from('<p>challenge</p>')}),beforeProvider:async()=>{throw new Error('保护上限');}}),/保护上限/);assert.equal(calls,0);}finally{global.fetch=previous;}
});
test('direct success costs no detail call and provider failure exposes no credentials',async()=>{
  const previous=global.fetch;let calls=0;global.fetch=async()=>{calls++;return {ok:false,status:403};};
  try{await readArticle(url,{downloadPage:async()=>({buffer:Buffer.from('<div id="js_content">'+content+'</div>')})});assert.equal(calls,0);await assert.rejects(()=>readArticle(url,{apiKey:'never-expose',downloadPage:async()=>{throw new Error('network');}}),e=>e.status===502&&!e.message.includes('never-expose')&&e.message.includes('HTTP 403'));assert.equal(calls,1);}finally{global.fetch=previous;}
});
