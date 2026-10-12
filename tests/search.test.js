const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,parseSearchResponse}=require('../backend/research');
test('WeChat HTTP results are upgraded to HTTPS without losing signed query parameters',()=>{
  const input=[{doc_url:' http://mp.weixin.qq.com/s?__biz=one&mid=2&sn=abc%2Bdef ',title:'<b>亚马逊 AI</b>',source:{tag:[{title:'阅读 1.2万'}]}},{doc_url:'https://mp.weixin.qq.com/s?__biz=one&mid=2&sn=abc%2Bdef',title:'重复文章'},{doc_url:'https://mp.weixin.qq.com/s/another',title:'第二篇'}];
  const out=normalize(input);assert.equal(out.length,2);assert.equal(out[0].url,'https://mp.weixin.qq.com/s?__biz=one&mid=2&sn=abc%2Bdef');assert.equal(out[0].title,'亚马逊 AI');assert.equal(out[0].readCount,12000);
});
test('HTTP compatibility continues rejecting forged hosts, unsafe schemes and embedded credentials',()=>{
  const urls=['http://mp.weixin.qq.com.evil.test/s','http://internal.test/s','javascript:alert(1)','http://user:password@mp.weixin.qq.com/s','http://mp.weixin.qq.com:8080/s'];
  assert.equal(normalize(urls.map(doc_url=>({doc_url,title:'不可信'}))).length,0);
});
test('valid empty search differs from provider failure, missing data and discarded articles',()=>{
  assert.deepEqual(parseSearchResponse({code:200,data:{items:[]}}),{articles:[],returnedCount:0,hasMore:false});
  for(const result of [{code:500},{code:200,data:null},{code:200,data:{items:'bad'}}])assert.throws(()=>parseSearchResponse(result),/失败|格式异常/);
  assert.throws(()=>parseSearchResponse({code:200,data:{items:[{title:'无法识别',doc_url:'https://other.test/article'}]}}),/已返回结果/);
  const parsed=parseSearchResponse({code:200,data:{items:[null,{title:'有效',doc_url:'http://mp.weixin.qq.com/s/real',source:{tag:{}}}],continue_flag:true}});assert.equal(parsed.articles.length,1);assert.equal(parsed.returnedCount,2);assert(parsed.hasMore);
});
