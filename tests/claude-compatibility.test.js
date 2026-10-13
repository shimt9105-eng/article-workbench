const test=require('node:test');
const assert=require('node:assert/strict');
const {callModel}=require('../backend/model');
const {recommend}=require('../backend/research');

test('Claude Chat generation and recommendation satisfy provider max_tokens requirement',async()=>{
  const previous=global.fetch;
  const model={name:'claude-opus-5',protocol:'OpenAI Chat',baseUrl:'https://isolated.invalid/v1',apiKey:'isolated'};
  const articles=[{id:'1',title:'真实文章',url:'https://mp.weixin.qq.com/s?test=1'}];
  const limits=[];
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://isolated.invalid/v1/chat/completions');
    const body=JSON.parse(options.body);
    // Reproduce the upstream rejection rather than simply checking construction.
    if(!Number.isInteger(body.max_tokens)||body.max_tokens<=0)return {ok:false,status:400,text:async()=>'{"error":{"message":"max_tokens: Field required"}}'};
    limits.push(body.max_tokens);
    const content=limits.length===1?{html:'<h1>完整文章</h1><p>正文</p>',comment:'完成'}:{recommendations:[{id:'1',reason:'符合主题'}]};
    const payload={choices:[{message:{content:JSON.stringify(content)}}]};
    return {ok:true,text:async()=>JSON.stringify(payload),json:async()=>payload};
  };
  try{
    assert.match((await callModel(model,'真实输入')).html,/完整文章/);
    assert.equal((await recommend(model,'主题','方向',articles))[0].id,'1');
    assert.deepEqual(limits,[12000,3000]);
  }finally{global.fetch=previous;}
});

test('Other Chat models retain their existing request parameters',async()=>{
  const previous=global.fetch;
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(Object.hasOwn(body,'max_tokens'),false);
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"html":"<p>正文</p>"}'}}]})};
  };
  try{await callModel({name:'gemini-3.8-flash',protocol:'OpenAI Chat',baseUrl:'https://isolated.invalid/v1',apiKey:'isolated'},'真实输入');}
  finally{global.fetch=previous;}
});
