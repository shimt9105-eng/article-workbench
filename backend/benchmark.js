const cheerio=require('cheerio');
const {download}=require('./security');
class BenchmarkError extends Error {constructor(message,status=502){super(message);this.status=status;}}
function articleUrl(input){
  let u;try{u=new URL(input);}catch{throw new BenchmarkError('请填写有效的对标文章链接',400);}
  if(u.protocol!=='https:'||u.hostname!=='mp.weixin.qq.com'||u.username||u.password||u.port&&u.port!=='443'||!/^\/s(?:\/|$)/.test(u.pathname))throw new BenchmarkError('对标文章请使用 HTTPS 微信文章链接',400);
  u.hash='';return u.toString();
}
function pageArticle(raw){
  const $=cheerio.load(raw),el=$('#js_content');el.find('script,style,iframe,form').remove();
  const text=el.text().trim();
  if(!el.length||text.length<100)return null;
  return {benchmarkContent:text.slice(0,120000),benchmarkTitle:$('#activity-name').text().trim()||$('meta[property="og:title"]').attr('content')||'对标文章',benchmarkSource:'full_text'};
}
function providerArticle(payload){
  const c=payload?.data?.content;
  if(Number(payload?.code)!==200||!c||c._content_type!=='article')throw new BenchmarkError('未取得可用的对标全文，请确认链接是图文文章且原文可访问；已填写内容会保留');
  const $=cheerio.load(c.content_noencode||'');$('script,style,iframe,form').remove();
  const text=String(c.content_text||$.root().text()).trim();
  if(text.length<100||!String(c.content_noencode||'').trim())throw new BenchmarkError('文章详情未返回完整正文，请稍后重试或更换对标文章；已填写内容会保留');
  return {benchmarkContent:text.slice(0,120000),benchmarkTitle:String(c.title||'对标文章'),benchmarkSource:'tikhub_full_text'};
}
async function readArticle(url,{apiKey,beforeProvider,downloadPage=download}={}){
  try{const {buffer}=await downloadPage(url,4*1024*1024);const article=pageArticle(buffer.toString('utf8'));if(article)return article;}catch{}
  if(!apiKey)throw new BenchmarkError('微信全文读取受限，且文章详情服务尚未配置；已填写内容会保留');
  await beforeProvider?.();
  let r;try{r=await fetch('https://api.tikhub.io/api/v1/wechat_mp/v2/fetch_article_detail_h5',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({url,raw:false}),signal:AbortSignal.timeout(60000)});}catch{throw new BenchmarkError('对标全文读取超时，请稍后重试；已填写内容会保留');}
  if(!r.ok)throw new BenchmarkError(`对标文章详情服务调用失败（HTTP ${r.status}），请稍后重试；已填写内容会保留`);
  let payload;try{payload=await r.json();}catch{throw new BenchmarkError('对标文章详情返回格式异常，请稍后重试；已填写内容会保留');}
  return providerArticle(payload);
}
module.exports={articleUrl,pageArticle,providerArticle,readArticle};
