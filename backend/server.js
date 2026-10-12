const http=require('node:http');
const crypto=require('node:crypto');
const cloudbase=require('@cloudbase/node-sdk');
const cheerio=require('cheerio');
const clean=require('sanitize-html');
const mammoth=require('mammoth');
const Jimp=require('jimp');
const {digest,same,passwordHash,encrypt,decrypt,download,safeUrl}=require('./security');
const {systemPrompt,buildModelInput,buildCoverPrompt,buildDraftArticles,sanitizeHtml,stripTags,nowIso,formatTaskTimestamp}=require('./core');
const {callModel}=require('./model');
const {placeSourceImages}=require('./source-images');
const {parseSearchResponse,recommend}=require('./research');
const VERSION='2.1.1', INITIAL='根据固定 System 依据，把原始随笔润色成一篇完整的微信公众号文章。保留真实观点与个人表达，不虚构信息。';
const PREFIX='article_web_', KEY=process.env.ENCRYPTION_KEY||'', SIGN=process.env.SESSION_SECRET||'';
const app=cloudbase.init({env:process.env.CLOUDBASE_ENV_ID||cloudbase.SYMBOL_CURRENT_ENV,...(process.env.CLOUDBASE_APIKEY?{accessKey:process.env.CLOUDBASE_APIKEY}:{})});
const db=app.database();
const col=name=>db.collection(PREFIX+name);
const uid=()=>crypto.randomUUID().replaceAll('-','');
const shared=['true','enabled'].includes(process.env.USE_SHARED_CONFIG);
const trial=process.env.TRIAL_ENABLED==='enabled';
const trialId=user=>digest('trial:v1:'+(process.env.TRIAL_SCOPE==='visitor'?user:'site'));
async function trialQuota(user){const r=await get('limits',trialId(user));const used=r?.count||0;return {limit:10,used,remaining:Math.max(0,10-used),scope:process.env.TRIAL_SCOPE==='visitor'?'visitor':'site'};}
class UserError extends Error {constructor(message,status=400){super(message);this.status=status;}}
async function get(name,id){const r=await col(name).where({_id:id}).limit(1).get();return r.data?.[0]||null;}
async function add(name,id,data){await col(name).add({_id:id,...data});}
async function patch(name,id,data){await col(name).doc(id).update(data);}
async function claim(name,id,field,expected,data){const r=await col(name).where({_id:id,[field]:expected}).update(data);return r.updated===1;}
async function limit(id,max=30){
  const bucket=digest(id+':'+Math.floor(Date.now()/300000));
  try{await add('limits',bucket,{count:0,createdAt:Date.now()});}catch(e){if(!await get('limits',bucket))throw e;}
  const r=await col('limits').where({_id:bucket,count:db.command.lt(max)}).update({count:db.command.inc(1)});
  if(r.updated!==1)throw new UserError('操作过于频繁，请 5 分钟后再试',429);
}
async function usage(user){
  if(trial){
    const id=trialId(user);try{await add('limits',id,{count:0,createdAt:Date.now()});}catch(e){if(!await get('limits',id))throw e;}
    const r=await col('limits').where({_id:id,count:db.command.lt(10)}).update({count:db.command.inc(1)});
    if(r.updated!==1)throw new UserError('10 次体验额度已用完，历史文章仍可查看',429);
    if(process.env.TRIAL_SCOPE==='visitor'){
      const globalId=digest('trial-global:'+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));
      try{await add('limits',globalId,{count:0,createdAt:Date.now()});}catch(e){if(!await get('limits',globalId))throw e;}
      const reserved=await col('limits').where({_id:globalId,count:db.command.lt(Number(String(process.env.GLOBAL_DAILY_LIMIT||30).replace('quota:','')))}).update({count:db.command.inc(1)});
      if(reserved.updated!==1){await col('limits').doc(id).update({count:db.command.inc(-1)});throw new UserError('今日全站共享调用已达保护上限，明日再试；你的剩余体验额度已保留',429);}
    }
    return;
  }
  const globalId=digest('global:'+new Date().toISOString().slice(0,10));
  try{await add('limits',globalId,{count:0,createdAt:Date.now()});}catch(e){if(!await get('limits',globalId))throw e;}
  const global=await col('limits').where({_id:globalId,count:db.command.lt(Number(String(process.env.GLOBAL_DAILY_LIMIT||30).replace('quota:','')))}).update({count:db.command.inc(1)});
  if(global.updated!==1)throw new UserError('今日全站共享额度已用完，明日再试',429);
  const id=digest(user+':'+new Date().toISOString().slice(0,10));
  try{await add('limits',id,{count:0,createdAt:Date.now()});}catch(e){if(!await get('limits',id))throw e;}
  const max=Number(String(process.env.DAILY_LIMIT||30).replace('quota:',''));
  const r=await col('limits').where({_id:id,count:db.command.lt(max)}).update({count:db.command.inc(1)});
  if(r.updated!==1)throw new UserError(`今日调用额度（${max} 次）已用完，明日再试`,429);
}
function safeHtml(html){return clean(sanitizeHtml(html),{allowedTags:clean.defaults.allowedTags.concat(['img','h1','section','article','figure','figcaption']),allowedAttributes:{'*':['style','class'],a:['href','title'],img:['src','alt','width','height']},allowedSchemes:['https','data'],allowedSchemesByTag:{a:['https'],img:['https','data']},allowProtocolRelative:false});}
async function auth(req){
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');const [body,mac]=token.split('.');
  if(!body||!mac||!same(crypto.createHmac('sha256',SIGN).update(body).digest('hex'),mac))throw new UserError('请先登录',401);
  let session;try{session=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new UserError('登录失效，请重新登录',401);}
  if(session.exp<Date.now()||!(session.kind==='guest'&&trial&&/^guest_[a-f0-9]{64}$/.test(session.user))&&!await get('sessions',session.sid))throw new UserError('登录失效，请重新登录',401);
  return session;
}
async function credentials(user){const record=await get('credentials',user);return record?decrypt(record.encrypted,KEY):{};}
async function config(user){const own=await credentials(user);return {...own,models:own.models?.length?own.models:shared?JSON.parse(process.env.MODELS_B64?Buffer.from(process.env.MODELS_B64,'base64').toString('utf8'):'[]'):[],tikhub:own.tikhub||(shared?process.env.TIKHUB_API_KEY:'')};}
async function models(user){return (await config(user)).models.filter(m=>m.enabled!==false&&m.type!=='生图模型'&&['OpenAI Chat','OpenAI Responses','Anthropic Messages'].includes(m.protocol)&&!/^qwen|通义/i.test(m.name)&&!m.baseUrl.includes('codex-cli'));}
async function model(user,id){const m=(await models(user)).find(m=>m.id===id);if(!m)throw new UserError('所选模型已停用，请重新选择');return m;}
async function task(user,id){const t=await get('tasks',id);if(!t||t.user!==user)throw new UserError('任务不存在',404);return t;}
async function variant(user,taskId,modelId){await task(user,taskId);const v=await get('variants',digest(taskId+':'+modelId));if(!v||v.user!==user)throw new UserError('模型版本不存在',404);return v;}
function publicVariant(v){const {_id,user,...data}=v;const expired=v.activeAttemptId&&Date.now()-Date.parse(v.startedAt)>910000;return {...data,id:_id,...(expired?{status:'error',lastError:'上次生成已超时，可重试。原有正文已保留'}:{})};}
async function state(user){
  const list=await col('tasks').where({user}).orderBy('createdAt','desc').limit(100).get();
  const tasks=await Promise.all((list.data||[]).map(async t=>{
    const r=await col('variants').where({user,taskId:t._id}).limit(100).get();
    const {_id,user:owner,...data}=t;
    const variants=(r.data||[]).map(publicVariant);
    return {...data,id:_id,variants,activeModelId:variants[0]?.modelId,status:variants.some(v=>v.status==='processing')?'processing':'idle'};
  }));
  return {appVersion:VERSION,schemaVersion:1,revision:0,tasks,activeTaskId:tasks[0]?.id||null};
}
async function imageData(src){
  let buffer,type;
  if(/^data:image\/(png|jpeg|gif);base64,/i.test(src)){buffer=Buffer.from(src.split(',')[1],'base64');type=src.slice(5,src.indexOf(';'));}
  else {({buffer,type}=await download(src));}
  if(!buffer.length||buffer.length>10*1024*1024)throw new UserError('图片为空或超过 10MB');
  await Jimp.read(buffer);return {buffer,type};
}
async function documentInput(p){
  let content=String(p.sourceDocContent||'').trim(),html=String(p.sourceDocHtml||'');
  if(!p.docxBase64&&!content&&!html)return {sourceDocContent:'',sourceDocHtml:'',sourceImages:[],sourceDocImageCount:0,sourceDocTitle:'未上传 Word',sourceDocUrl:'',sourceDocWarnings:[]};
  if(p.docxBase64){
    const buffer=Buffer.from(p.docxBase64,'base64');if(buffer.length>8*1024*1024)throw new UserError('Word 文件不得超过 8MB');
    let result;try{result=await mammoth.convertToHtml({buffer},{convertImage:mammoth.images.imgElement(async image=>({src:`data:${image.contentType};base64,${await image.read('base64')}`}))});}catch{throw new UserError('无法读取 Word，请上传有效的 .docx 文件');}
    html=safeHtml(result.value);content=stripTags(html);
  }
  if(!content&&!/<img\b/i.test(html))throw new UserError('Word 中没有可用正文或图片，请更换文件或移除上传后继续');
  if(content.length>120000)throw new UserError('资料正文过长，请缩减到 12 万字以内');
  const $=cheerio.load(html||'<p></p>'),images=[];
  $('img').each((n,el)=>{const src=$(el).attr('src');if(src){const id=`资料图片 ${n+1}`;images.push({id,src,alt:$(el).attr('alt')||id,beforeText:$(el).parent().prev().text(),afterText:$(el).parent().next().text()});$(el).replaceWith(`[${id}]`);}});
  if(images.length) content=$.root().text();
  return {sourceDocContent:content,sourceDocHtml:html,sourceImages:images,sourceDocImageCount:images.length,sourceDocTitle:p.docxName||'上传 / 粘贴的资料',sourceDocUrl:String(p.sourceDocUrl||''),sourceDocWarnings:[]};
}
async function benchmarkInput(p){
  if(p.benchmarkContent){const text=String(p.benchmarkContent).trim();if(text.length<100)throw new UserError('对标正文至少需要 100 字');return {benchmarkContent:text.slice(0,120000),benchmarkTitle:p.benchmarkTitle||'用户提供的对标全文',benchmarkSource:'user_pasted'};}
  let u;try{u=new URL(p.benchmarkUrl);}catch{throw new UserError('请填写有效的对标文章链接');}if(u.hostname!=='mp.weixin.qq.com'||u.protocol!=='https:'||u.username||u.password)throw new UserError('对标文章请使用 HTTPS 微信文章链接');
  let buffer;try{({buffer}=await download(u.toString(),4*1024*1024));}catch{throw new UserError('暂时无法读取对标文章，请稍后重试或更换链接；已填写内容会保留',502);}const $=cheerio.load(buffer.toString('utf8'));
  const el=$('#js_content');el.find('script,style').remove();const content=el.text().trim();
  if(!el.length||content.length<100||/环境异常|访问过于频繁|内容已被发布者删除/.test($('body').text()))throw new UserError('微信暂未提供对标全文，请确认原文可访问，稍后重试或更换对标文章；已填写内容会保留');
  return {benchmarkContent:content.slice(0,120000),benchmarkTitle:$('#activity-name').text().trim()||$('meta[property="og:title"]').attr('content')||'对标文章',benchmarkSource:'full_text'};
}
async function generate(user,p){
  const t=await task(user,p.taskId),v=await variant(user,p.taskId,p.modelId),m=await model(user,p.modelId);
  if(v.activeAttemptId&&Date.now()-Date.parse(v.startedAt)<=910000)throw new UserError('此版本正在生成，请等待完成',409);
  await usage(user);const attempt=uid(),start=nowIso();
  if(!await claim('variants',v._id,'revision',v.revision,{activeAttemptId:attempt,status:'processing',revision:v.revision+1,startedAt:start,lastError:'',...(v.activeAttemptId?{supersededAttemptId:v.activeAttemptId}:{})}))throw new UserError('版本已更新，请刷新后重试',409);
  const comments=v.comments||[],mode=p.instruction?'revise':'initial',instruction=p.instruction||INITIAL;
  if(mode==='revise')comments.push({id:uid(),role:'user',text:instruction,selectedText:p.selectedText||'',createdAt:start});
  try{
    const result=await callModel(m,buildModelInput({task:{...t,articleHtml:v.articleHtml,comments},instruction,selectedText:p.selectedText||'',mode}));
    const placed=placeSourceImages(result.html,t.sourceImages||[]),html=safeHtml(placed.html);
    comments.push({id:uid(),role:'assistant',text:result.comment,createdAt:nowIso()});
    const saved=await claim('variants',v._id,'activeAttemptId',attempt,{articleHtml:html,comments,status:'idle',activeAttemptId:null,completedAttemptId:attempt,revision:v.revision+2,lastError:''});
    if(!saved)throw new UserError('生成结果已被更新任务取代',409);
    await patch('tasks',t._id,{updatedAt:nowIso(),sourceDocWarnings:[...new Set([...(t.sourceDocWarnings||[]),...placed.warnings])]});return {ok:true};
  }catch(e){
    const message=e.status?e.message:/timeout|abort/i.test(e.message)?'模型调用超时，可重试该版本':/HTTP \d+/.exec(e.message)?.[0]?'模型服务调用失败（'+(/HTTP \d+/.exec(e.message)[0])+')，请检查模型配置或重试':'模型生成失败，请检查配置或重试；原有正文已保留';
    await claim('variants',v._id,'activeAttemptId',attempt,{status:'error',activeAttemptId:null,lastError:message,comments:[...comments,{id:uid(),role:'assistant',text:message,createdAt:nowIso()}],revision:v.revision+2});
    throw new UserError(message,502);
  }
}
async function wxRequest(c,path,options={}){
  const origin=process.env.WECHAT_API_BASE_URL||'https://api.weixin.qq.com/cgi-bin';
  const headers={...(options.headers||{}),...(process.env.WECHAT_PROXY_SECRET?{'X-Editor3-Proxy-Secret':process.env.WECHAT_PROXY_SECRET}:{})};
  const r=await fetch(origin+path,{...options,headers,signal:AbortSignal.timeout(45000)});
  let value;try{value=await r.json();}catch{throw new UserError(`公众号接口不可用（HTTP ${r.status}）`,502);}
  if(!r.ok||value.errcode){
    const code=Number(value.errcode||r.status);
    const text={40164:'请将后台出口 IP 加入公众号 IP 白名单，再验证绑定',40013:'AppID 无效，请检查公众号后台',40125:'AppSecret 无效，请重新填写',48001:'公众号没有该接口权限，请检查开发接口权限',40014:'公众号授权已失效，请重新验证绑定',42001:'公众号授权已过期，请重试'}[code]||'公众号接口返回错误，请检查权限或稍后重试';
    // Only a literal IPv4 address from WeChat's whitelist error may be displayed.
    const ip=code===40164?String(value.errmsg||'').match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0]:'';
    throw new UserError(`${text}（${code}）${ip?'：'+ip:''}`,502);
  }
  return value;
}
async function wxToken(c){
  const q=new URLSearchParams({grant_type:'client_credential',appid:c.appId,secret:c.appSecret});
  const data=await wxRequest(c,'/token?'+q);if(!data.access_token)throw new UserError('公众号未返回授权令牌',502);return data.access_token;
}
async function uploadWx(c,token,path,buffer,type,filename){
  const f=new FormData();f.append('media',new Blob([buffer],{type}),filename);
  return wxRequest(c,path+(path.includes('?')?'&':'?')+'access_token='+encodeURIComponent(token),{method:'POST',body:f});
}
async function cover(user,t,v){
  const conf=await config(user);const m=conf.models.find(m=>m.type==='生图模型');if(!m)throw new UserError('请在配置中添加生图模型，才能自动生成公众号封面');
  await usage(user);const prompt=buildCoverPrompt({...t,variants:[v]},[v.modelId]);
  const r=await fetch(m.baseUrl+'/images/generations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${m.apiKey}`},body:JSON.stringify({model:m.name,prompt,size:'1536x1024',n:1,quality:'low',response_format:'b64_json'}),signal:AbortSignal.timeout(300000)});
  if(!r.ok)throw new UserError(`封面生成失败（HTTP ${r.status}）`,502);
  const data=await r.json(),image=data.data?.[0];let buffer;
  if(image?.b64_json)buffer=Buffer.from(image.b64_json,'base64');else if(image?.url)({buffer}=await download(image.url));else throw new UserError('生图模型未返回图片',502);
  if(buffer.length>10*1024*1024)throw new UserError('封面超过 10MB');
  for(const quality of [80,65,50,35,20]){const image=await Jimp.read(buffer);const b=await image.cover(900,383).quality(quality).getBufferAsync(Jimp.MIME_JPEG);if(b.length<=64*1024)return {buffer:b,model:m.name};}
  throw new UserError('封面压缩后仍超过 64KB');
}
async function publish(user,p){
  const t=await task(user,p.taskId),v=await variant(user,p.taskId,p.modelId),c=(await credentials(user)).wechat;
  if(!c?.verifiedAt)throw new UserError('请先绑定并验证公众号');
  if(!v.articleHtml||v.status!=='idle'||!v.completedAttemptId)throw new UserError('仅可发送已成功完成的文章');
  const id=digest(user+':'+p.taskId+':'+p.modelId+':'+c.appId+':'+digest(v.articleHtml));
  const prev=await get('drafts',id);
  if(prev?.status==='success')return {...prev,status:'duplicate'};
  if(prev)throw new UserError(prev.status==='unknown'?'微信可能已接受草稿，请先检查公众号草稿箱，避免重复提交':'该草稿正在发送，或已有发送记录。请查看发送记录',409);
  await add('drafts',id,{user,taskId:p.taskId,modelId:p.modelId,model_name:v.modelName,status:'running',createdAt:nowIso(),appSuffix:c.appId.slice(-6)});
  let submitting=false;
  try{
    const token=await wxToken(c),generated=await cover(user,t,v),thumb=await uploadWx(c,token,'/material/add_material?type=thumb',generated.buffer,'image/jpeg','cover.jpg');
    const $=cheerio.load(v.articleHtml,{xmlMode:false});const cache=new Map();
    for(const img of $('img').toArray()){
      const src=$(img).attr('src');if(!cache.has(src)){const bytes=await imageData(src);const converted=await (await Jimp.read(bytes.buffer)).quality(85).getBufferAsync(Jimp.MIME_JPEG);const uploaded=await uploadWx(c,token,'/media/uploadimg',converted,'image/jpeg','inline.jpg');if(!uploaded.url)throw new UserError('正文图片上传失败',502);cache.set(src,uploaded.url);}
      $(img).attr('src',cache.get(src));
    }
    if(!thumb.media_id)throw new UserError('封面上传失败，尚未创建草稿',502);
    const article=buildDraftArticles({...t,variants:[v]},[v.modelId],'')[0];
    const body={articles:[{title:article.title,digest:article.digest,author:c.author||'',content:$('body').html(),thumb_media_id:thumb.media_id,show_cover_pic:1,need_open_comment:0,only_fans_can_comment:0}]};
    submitting=true;
    const result=await wxRequest(c,'/draft/add?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!result.media_id)throw new Error('Missing draft id');
    const record={status:'success',media_id:result.media_id,title:article.title,completedAt:nowIso(),coverModel:generated.model};
    await patch('drafts',id,record);return {...record,model_name:v.modelName};
  }catch(e){
    const status=submitting?'unknown':'failed';await patch('drafts',id,{status,error:e.status?e.message:'发送中断，请查看公众号草稿箱确认是否已创建',updatedAt:nowIso()});
    if(!submitting)await col('drafts').doc(id).remove();
    throw e.status?e:new UserError('发送中断，请先检查公众号草稿箱，避免重复提交',502);
  }
}
async function route(req,p,path){
  if(path==='/health')return {ok:true,version:VERSION};
  if(path==='/guest/enter'){
    if(!trial)throw new UserError('免登录体验尚未开启',404);
    await limit('guest:'+digest(req.headers['x-forwarded-for']||req.socket.remoteAddress||''),20);
    if(!/^[a-f0-9]{64}$/.test(p.deviceSecret||''))throw new UserError('访客凭据无效');
    const session={kind:'guest',user:'guest_'+digest(p.deviceSecret),exp:Date.now()+365*86400000};
    const payload=Buffer.from(JSON.stringify(session)).toString('base64url');
    return {token:payload+'.'+crypto.createHmac('sha256',SIGN).update(payload).digest('hex'),quota:await trialQuota(session.user)};
  }
  if(path==='/auth/login'||path==='/auth/register'){
    if(trial)throw new UserError('请直接使用免登录体验',403);
    await limit('auth:'+digest(req.headers['x-forwarded-for']||req.socket.remoteAddress||''),20);
    const username=String(p.username||'').trim().toLowerCase();if(!/^[a-z0-9_-]{3,32}$/.test(username))throw new UserError('用户名使用 3–32 个英文字母、数字、下划线或短横线');
    const id=digest(username),existing=await get('users',id);
    if(path==='/auth/register'){
      if(existing)throw new UserError('用户名不可用');const password=await passwordHash(p.password);
      try{await add('users',id,{username,...password,createdAt:nowIso()});}catch{throw new UserError('用户名不可用');}
    }else {
      const value=await passwordHash(String(p.password||''),existing?.salt||'nonexistent');
      if(!existing||!same(value.hash,existing.hash))throw new UserError('用户名或密码不正确',401);
    }
    const session={user:id,sid:uid(),exp:Date.now()+12*3600000};await add('sessions',session.sid,{user:id,expiresAt:session.exp});
    const payload=Buffer.from(JSON.stringify(session)).toString('base64url');return {token:payload+'.'+crypto.createHmac('sha256',SIGN).update(payload).digest('hex'),username};
  }
  const session=await auth(req),user=session.user;
  if(path==='/auth/logout'){await col('sessions').doc(session.sid).remove();return {ok:true};}
  await limit(user,120);
  if(path==='/models')return (await models(user)).map(({id,name,source})=>({id,name,source}));
  if(path==='/state')return state(user);
  if(path==='/quota')return trial?trialQuota(user):{limit:30,scope:'daily'};
  if(path==='/config/status'){
    const c=await config(user);return {...(trial?{quota:await trialQuota(user)}:{}),shared,hasSearch:!!c.tikhub,models:c.models.map(({id,name,source,protocol,baseUrl,type})=>({id,name,source,protocol,baseUrl,type})),wechat:c.wechat?{name:c.wechat.name,appSuffix:c.wechat.appId.slice(-6),verifiedAt:c.wechat.verifiedAt,author:c.wechat.author}:null,dailyLimit:Number(String(process.env.DAILY_LIMIT||30).replace('quota:',''))};
  }
  if(path==='/config/save'){
    const current=await credentials(user);
    if(p.appendModel)p.models=[...(current.models||[]),p.appendModel];
    if(p.models){if(!Array.isArray(p.models)||p.models.length>20)throw new UserError('模型配置无效');
      current.models=await Promise.all(p.models.map(async(m,n)=>{
        await safeUrl(m.baseUrl);if(!['OpenAI Chat','OpenAI Responses','Anthropic Messages'].includes(m.protocol))throw new UserError('请选择受支持的模型协议');
        if(!m.name||!m.source||!m.apiKey)throw new UserError('模型需填写来源、名称和 API Key');
        return {id:m.id||digest(user+':'+m.source+':'+m.name+':'+n),name:String(m.name).slice(0,100),source:String(m.source).slice(0,80),apiKey:String(m.apiKey),baseUrl:String(m.baseUrl).replace(/\/$/,''),protocol:m.protocol,type:m.type||'文字模型'};
      }));
    }
    if(p.tikhub)current.tikhub=String(p.tikhub).trim();
    const value={encrypted:encrypt(current,KEY),updatedAt:nowIso()};
    if(await get('credentials',user))await patch('credentials',user,value);else await add('credentials',user,value);return {ok:true};
  }
  if(path==='/wechat/bind'){
    if(!/^wx[a-z0-9]{16}$/i.test(p.appId||'')||!p.appSecret||!p.name)throw new UserError('请填写公众号名称、AppID 和 AppSecret');
    const c={name:String(p.name).slice(0,60),appId:p.appId,appSecret:String(p.appSecret),author:String(p.author||'').slice(0,32)};
    await wxToken(c);c.verifiedAt=nowIso();const current=await credentials(user);current.wechat=c;
    const value={encrypted:encrypt(current,KEY),updatedAt:nowIso()};if(await get('credentials',user))await patch('credentials',user,value);else await add('credentials',user,value);
    return {ok:true,name:c.name,verifiedAt:c.verifiedAt};
  }
  if(path==='/wechat/unbind'){const c=await credentials(user);delete c.wechat;await patch('credentials',user,{encrypted:encrypt(c,KEY)});return {ok:true};}
  if(path==='/research/search'){
    const keyword=String(p.keyword||'').trim().slice(0,100);if(!keyword)throw new UserError('请输入搜索主题');
    const c=await config(user);if(!c.tikhub)throw new UserError('请在连接设置中配置 TikHub API Key');await usage(user);
      const r=await fetch('https://api.tikhub.io/api/v1/wechat_search/v2/fetch_search',{method:'POST',headers:{Authorization:`Bearer ${c.tikhub}`,'Content-Type':'application/json'},body:JSON.stringify({keyword,business_type:'article',sort:'hot',publish_time:'all',offset:0,cursor:null,raw:false}),signal:AbortSignal.timeout(50000)});
    if(!r.ok)throw new UserError(`搜索服务失败（HTTP ${r.status}），请检查搜索 Key`,502);let result;try{result=await r.json();}catch{throw new UserError('搜索服务返回的数据格式异常，请稍后重试',502);}
    let parsed;try{parsed=parseSearchResponse(result);}catch(e){throw new UserError(e.message,502);}
    const id=uid();await add('searches',id,{user,keyword,...parsed,createdAt:nowIso()});return {id,keyword,...parsed};
  }
  if(path==='/research/recommend'){
    const s=await get('searches',p.searchId);if(!s||s.user!==user)throw new UserError('搜索结果不存在',404);
    if(!s.articles.length)return {recommendations:[]};await usage(user);const m=await model(user,p.modelId);
    const recommendations=await recommend(m,s.keyword,String(p.goal||'').slice(0,2000),s.articles);await patch('searches',s._id,{recommendations,modelId:m.id,recommendedAt:nowIso()});return {recommendations};
  }
  if(path==='/benchmark/read')return benchmarkInput(p);
  if(path==='/document/read')return documentInput(p);
  if(path==='/task/create'){
    if(trial&&(await trialQuota(user)).remaining===0)throw new UserError('10 次体验额度已用完，历史文章仍可查看',429);
    const ids=[...new Set(p.modelIds||[])];if(!ids.length||ids.length>8)throw new UserError('请选择 1–8 个写作模型');
    if(!String(p.originalEssay||'').trim())throw new UserError('请填写随笔或初步想法');
    const chosen=await Promise.all(ids.map(id=>model(user,id)));const [doc,b]=await Promise.all([documentInput(p),benchmarkInput(p)]),id=uid();
    await add('tasks',id,{user,title:formatTaskTimestamp(),...doc,...b,benchmarkUrl:String(p.benchmarkUrl||''),originalEssay:String(p.originalEssay).slice(0,120000),systemLocked:true,createdAt:nowIso(),updatedAt:nowIso(),schemaVersion:1});
    for(const m of chosen)await add('variants',digest(id+':'+m.id),{user,taskId:id,modelId:m.id,modelName:m.name,source:m.source,status:'idle',articleHtml:'',comments:[],revision:0,activeAttemptId:null,completedAttemptId:null});
    return {taskId:id};
  }
  if(path==='/task/add-models'){
    await task(user,p.taskId);const chosen=await Promise.all([...new Set(p.modelIds||[])].map(id=>model(user,id)));if(!chosen.length)throw new UserError('请选择新模型');
    for(const m of chosen){const id=digest(p.taskId+':'+m.id);if(await get('variants',id))throw new UserError('该模型已存在');await add('variants',id,{user,taskId:p.taskId,modelId:m.id,modelName:m.name,source:m.source,status:'idle',articleHtml:'',comments:[],revision:0,activeAttemptId:null,completedAttemptId:null});}return {ok:true};
  }
  if(path==='/variant/generate')return generate(user,p);
  if(path==='/article/save'){
    const v=await variant(user,p.taskId,p.modelId);if(v.activeAttemptId)throw new UserError('生成中暂不能编辑');
    if(p.revision!==v.revision)throw new UserError('另一窗口已更新正文，请刷新后编辑',409);
    const html=safeHtml(p.html);if(Buffer.byteLength(html)>4*1024*1024)throw new UserError('文章超过 4MB');
    if(!await claim('variants',v._id,'revision',v.revision,{articleHtml:html,revision:v.revision+1,lastManualEditAt:nowIso()}))throw new UserError('正文发生变化，请刷新后再编辑',409);
    return {savedAt:nowIso(),revision:v.revision+1};
  }
  if(path==='/article/publish')return publish(user,p);
  if(path==='/drafts')return {items:(await col('drafts').where({user}).orderBy('createdAt','desc').limit(50).get()).data||[]};
  throw new UserError('接口不存在',404);
}
async function handle(req,res){
  const origin=req.headers.origin||'',allow=String(process.env.ALLOWED_ORIGINS||'').split(',').includes(origin);
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(allow?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const respond=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value));};
  if(req.method==='OPTIONS')return respond(allow?204:403,{});
  if(req.method!=='POST'&&req.url!=='/health')return respond(405,{error:'请使用 POST'});
  if(origin&&!allow)return respond(403,{error:'网页来源未授权'});
  try{
    if(!/^[a-f0-9]{64}$/.test(KEY)||SIGN.length<32)throw new UserError('服务尚未配置完成',503);
    let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw new UserError('提交内容超过 12MB',413);raw+=chunk;}
    let p;try{p=raw?JSON.parse(raw):{};}catch{throw new UserError('提交格式无效');}
    const path=new URL(req.url,'http://localhost').pathname.replace(/^\/article-workbench-api/,'');
    const result=await route(req,p,path);respond(200,result);
  }catch(e){respond(e.status||500,{error:e.status?e.message:'服务暂时不可用，请稍后重试'});}
}
if(require.main===module)http.createServer(handle).listen(Number(process.env.PORT||9000),'0.0.0.0');
module.exports={handle,route,safeHtml,documentInput,benchmarkInput,VERSION};
