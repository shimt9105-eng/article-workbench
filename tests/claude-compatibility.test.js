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

test('Micu Claude legacy Chat configuration uses documented Messages protocol for generation and recommendations',async()=>{
  const previous=global.fetch;
  const model={name:'claude-opus-5',protocol:'OpenAI Chat',baseUrl:'https://www.micuapi.ai/v1',apiKey:'isolated'};
  const limits=[];
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://www.micuapi.ai/v1/messages');
    assert.equal(options.headers['User-Agent'],'claude-cli/2.0.76 (external, cli)');
    assert.equal(options.headers.Authorization,'Bearer isolated');
    assert.equal(options.headers['anthropic-version'],'2023-06-01');
    const body=JSON.parse(options.body);
    assert.equal(Object.hasOwn(body,'response_format'),false);
    if(!body.system||body.messages.some(m=>m.role==='system'))return {ok:false,status:400,text:async()=>'{"error":{"message":"system: Field required"}}'};
    assert.ok(body.system.includes('JSON'));assert.equal(body.messages[0].role,'user');
    limits.push(body.max_tokens);
    const result=limits.length===1?{html:'<h1>文章</h1>',comment:'完成'}:{recommendations:[{id:'1',reason:'符合主题'}]};
    const payload={content:[{type:'text',text:JSON.stringify(result)}]};
    return {ok:true,text:async()=>JSON.stringify(payload),json:async()=>payload};
  };
  try{
    assert.match((await callModel(model,'写作输入')).html,/文章/);
    assert.equal((await recommend(model,'主题','方向',[{id:'1',title:'真实文章',url:'https://mp.weixin.qq.com/s?test=1'}]))[0].id,'1');
    assert.deepEqual(limits,[8192,3000]);
  }finally{global.fetch=previous;}
});

test('Provider invalid request cooldown is classified for an actionable user message',async()=>{
  const previous=global.fetch;
  global.fetch=async()=>({ok:false,status:400,text:async()=>JSON.stringify({error:{message:'Too many invalid requests from this session. Please check your request format and retry later.'}})});
  try { await assert.rejects(callModel({name:'claude-opus-5',protocol:'OpenAI Chat',baseUrl:'https://www.micuapi.ai/v1',apiKey:'isolated'},'输入'),e=>e.code==='UPSTREAM_INVALID_REQUEST_COOLDOWN'); }
  finally { global.fetch=previous; }
});
