const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('task switching restores locked research and clears it for another task without any API calls',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../web/experience.js'),'utf8');
  const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,classList:{toggle(name,on){this[name]=on;}},querySelectorAll(){return [];}});return elements.get(id);}
  const c=vm.createContext({window:{restoreUploadedDocument(){},setBenchmarkDocument(){}},el,search:null,recommendations:[],draftRestoring:false,draftChangeVersion:0,draftSavedVersion:0,sourceUploadAttempt:0,current:null,activeTask(){return c.current;},escapeHtml:v=>String(v||'').replaceAll('<','&lt;'),applyTrialQuota(){},fillRecommendModels(){},message:(id,v)=>{el(id).textContent=v;}});
  vm.runInContext(source.slice(source.indexOf('function articleCard('),source.indexOf('async function recommendSearch(')),c);
  vm.runInContext(source.slice(source.indexOf('window.restoreTaskInputs='),source.indexOf('window.startNamedTask=')),c);
  const articles=[1,2,3].map(id=>({id:String(id),title:'文章'+id,url:'https://mp.weixin.qq.com/s?article='+id,account:'公众号',reason:'真实推荐理由'}));
  c.current={systemLocked:true,benchmarkUrl:articles[2].url,research:{keyword:'亚马逊 AI',goal:'卖家',modelId:'推荐模型',search:{articles,recommendations:articles}}};
  await c.window.restoreTaskInputs(c.current);
  assert.equal(el('keywordInput').value,'亚马逊 AI');assert.equal(el('researchGoal').value,'卖家');assert.equal(el('recommendModel').disabled,true);
  assert.equal((el('recommendations').innerHTML.match(/class="research-card"/g)||[]).length,3);assert.match(el('recommendations').innerHTML,/已选为对标/);assert.match(el('recommendations').innerHTML,/真实推荐理由/);assert.equal((el('searchResults').innerHTML.match(/class="research-card"/g)||[]).length,3);
  c.current={systemLocked:true,readOnly:true};await c.window.restoreTaskInputs(c.current);assert.equal(el('recommendations').innerHTML,'');assert.equal(el('searchResults').innerHTML,'');assert.equal(el('keywordInput').value,'');
  c.current={systemLocked:false,draftInput:{}};await c.window.restoreTaskInputs(c.current);assert.equal(el('recommendations').innerHTML,'');assert.equal(el('recommendModel').disabled,false);assert.equal(el('allResults').classList.hidden,true);
});
