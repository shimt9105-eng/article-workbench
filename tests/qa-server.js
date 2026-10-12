// Isolated browser fixture. Never contacts CloudBase, models, TikHub or WeChat.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const port=Number(process.env.QA_PORT||4382),remaining=Number(process.env.QA_REMAINING??10);const root=path.resolve(__dirname,'../web');let task=null,reads=0;
const articles=[1,2,3,4].map(id=>({id:String(id),url:'https://mp.weixin.qq.com/s?qa='+id,title:['如何用 AI 理清电商经营流程','从重复劳动到业务自动化','电商 Agent 的实际落地边界','让工具回到具体问题'][id-1],account:'隔离测试来源 '+id,readCountText:id===1?'阅读 1.2万':'未提供',summary:'隔离测试摘要，只用于验证用户流程，不是真实文章。'}));
const models=[{id:'qa-model',source:'隔离测试服务',name:'qa-text'},{id:'qa-model-2',source:'另一隔离服务',name:'qa-text'}];
const s=()=>({tasks:task?[task]:[],activeTaskId:task?.id});
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end(`window.WORKBENCH_API="http://127.0.0.1:${port}/api";`);}
  if(!url.pathname.startsWith('/api/')){const file=path.join(root,url.pathname==='/'?'index.html':url.pathname);if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'text/html');return res.end(fs.readFileSync(file));}
  let raw='';for await(const chunk of req)raw+=chunk;const p=raw?JSON.parse(raw):{},route=url.pathname.slice(4);let data;
  if(route==='/guest/enter')data={token:'qa-fixture-only',quota:{limit:10,remaining,scope:'site'}};
  else if(route==='/quota')data={limit:10,used:10-remaining,remaining,scope:'site'};
  else if(route==='/auth/login')data={token:'qa-fixture-only',username:'qa_user'};
  else if(route==='/models')data=models;
  else if(route==='/config/status')data={shared:true,hasSearch:true,models,dailyLimit:30,quota:{limit:10,remaining,scope:'site'},wechat:null};
  else if(route==='/state')data=s();
  else if(route==='/research/search')data={id:'qa-search',articles};
  else if(route==='/research/recommend')data={recommendations:articles.slice(0,3).map(a=>({...a,reason:'与电商流程自动化主题相关；这里只依据标题摘要推荐，选入后再读全文。'}))};
  else if(route==='/benchmark/read'){reads++;res.writeHead(400,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'隔离测试：模拟微信全文不可读，请粘贴全文后继续'}));}
  else if(route==='/task/create'){task={id:'qa-task',title:'隔离测试文章',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceDocContent:p.sourceDocContent,sourceDocTitle:'隔离资料',benchmarkUrl:p.benchmarkUrl,benchmarkTitle:'隔离对标',benchmarkContent:p.benchmarkContent,originalEssay:p.originalEssay,systemLocked:true,variants:p.modelIds.map(modelId=>({modelId,modelName:'qa-text',source:'隔离测试',status:'idle',articleHtml:'',revision:0,comments:[]}))};data={taskId:task.id};}
  else if(route==='/variant/generate'){const v=task.variants.find(v=>v.modelId===p.modelId);v.articleHtml='<h1>隔离测试：让文章流程完整连起来</h1><p>这是浏览器验收用的测试正文，不是真实模型生成。</p><p>保持原始随笔、资料与对标三项依据。</p>';v.completedAttemptId='qa-attempt';v.comments.push({role:'assistant',text:'隔离测试已完成',createdAt:new Date().toISOString()});v.revision++;data={ok:true};}
  else if(route==='/article/save'){const v=task.variants.find(v=>v.modelId===p.modelId);v.articleHtml=p.html;v.revision++;data={savedAt:new Date().toISOString(),revision:v.revision};}
  else if(route==='/drafts')data={items:[]};else data={ok:true};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
}).listen(port,'127.0.0.1');
