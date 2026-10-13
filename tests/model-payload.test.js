const test=require('node:test');
const assert=require('node:assert/strict');
const {buildModelInput}=require('../backend/core');
const {placeSourceImages}=require('../backend/source-images');
const {callModel,modelHttpError}=require('../backend/model');
test('revision prompts exclude Word image bytes while keeping placement and the original image intact',()=>{
 const src='data:image/jpeg;base64,'+'A'.repeat(900000),task={originalEssay:'主线',sourceImages:[{id:'资料图片 1',src,alt:'全景图'}],articleHtml:'<p>图片之前</p><img src="'+src+'" alt="全景图"><p>图片之后</p>'};
 const before=task.articleHtml,input=buildModelInput({task,instruction:'优化排版',mode:'revise'}),parsed=JSON.parse(input);
 assert(input.length<2000);assert(!input.includes('base64'));assert.match(parsed.当前文章HTML,/图片之前[\s\S]*\[资料图片 1\][\s\S]*图片之后/);
 assert.equal(task.articleHtml,before);
 const restored=placeSourceImages(parsed.当前文章HTML,task.sourceImages).html;
 assert.equal((restored.match(/<img\b/g)||[]).length,1);assert(restored.includes(src));
});
test('provider error details retain the reference ID and redact credentials',()=>{
 const error=modelHttpError({status:400},JSON.stringify({error:{message:'Too many invalid requests from this session. request id: trace-123 sk-secret123'}}),{apiKey:'sk-secret123'});
 assert.equal(error.code,'UPSTREAM_INVALID_REQUEST_COOLDOWN');assert.equal(error.providerRequestId,'trace-123');assert.equal(error.httpStatus,400);assert(!error.message.includes('sk-secret123'));
});
test('truncated or empty outputs never count as a successful article',async()=>{
 const prior=global.fetch,model={name:'claude-opus-5',protocol:'Anthropic Messages',baseUrl:'https://isolated.invalid/v1',apiKey:'isolated'};
 try{
  for(const [payload,code]of [[{stop_reason:'max_tokens',content:[{type:'text',text:'{"html":"<p>partial</p>"}'}]},'MODEL_OUTPUT_TRUNCATED'],[{content:[{type:'text',text:'{"html":""}'}]},'MODEL_EMPTY_HTML']]){
   global.fetch=async()=>({ok:true,text:async()=>JSON.stringify(payload)});
   await assert.rejects(callModel(model,'isolated input'),e=>e.code===code);
  }
 }finally{global.fetch=prior;}
});
