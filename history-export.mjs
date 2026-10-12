import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);
const clean=require('./backend/node_modules/sanitize-html'),{sanitizeHtml}=require('./backend/core');
const source=process.argv[2]||path.join(os.homedir(),'Library/Application Support/编辑2号文章工作台/state.json');
const destination=process.argv[3]||path.join(root,'private/history.json');
const raw=await readFile(source),state=JSON.parse(raw),images=new Map();
const assetDir=path.join(path.dirname(destination),'history-media');await mkdir(assetDir,{recursive:true});
async function htmlWithImages(html){
  if(!String(html||'').trim())return '';

  for(const match of String(html).matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)){
    const original=match[2].replaceAll('&amp;','&');
    if(original.startsWith('/')||original.startsWith('file:')){
      const file=original.startsWith('file:')?fileURLToPath(original):original;
      if(!images.has(file)){const buffer=await readFile(file);const ext=path.extname(file).toLowerCase();const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[ext];if(!mime)throw new Error('历史图片格式不支持');const sha256=crypto.createHash('sha256').update(buffer).digest('hex'),name=sha256+ext;const target=path.join(assetDir,name);try{await writeFile(target,buffer,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||crypto.createHash('sha256').update(await readFile(target)).digest('hex')!==sha256)throw e;}images.set(file,{src:`https://history.invalid/${name}`,sha256,bytes:buffer.length});}
      html=html.replaceAll(match[2],images.get(file).src);
    }
  }
  let value=clean(sanitizeHtml(html),{allowedTags:clean.defaults.allowedTags.concat(['img','h1','section','article','figure','figcaption']),allowedAttributes:{'*':['style','class'],a:['href','title'],img:['src','alt','width','height']},allowedSchemes:['https','data'],allowedSchemesByTag:{a:['https'],img:['https','data']},allowProtocolRelative:false});
  for(const image of images.values())value=value.replaceAll(image.src,image.src.replace('https://history.invalid/','history-media/'));
  if(/(?:src|href)=["'](?:file:|\/Users\/)/i.test(value))throw new Error('历史文章仍包含电脑路径');return value;
}
const tasks=[];
for(const t of state.tasks||[]){
  const variants=[];
  for(const v of t.variants||[])variants.push({modelId:v.modelId,modelName:v.modelName,source:v.source||'',status:v.articleHtml?'idle':'error',articleHtml:await htmlWithImages(v.articleHtml||''),lastError:v.articleHtml?'':'该历史版本未生成成功',comments:[],revision:0,readOnly:true});
  tasks.push({id:'history_'+t.id,title:t.title,createdAt:t.createdAt,updatedAt:t.updatedAt,systemLocked:true,readOnly:true,activeModelId:t.activeModelId,status:'idle',variants});
}
await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,JSON.stringify({tasks},null,2),{mode:0o600});
const unchanged=crypto.createHash('sha256').update(await readFile(source)).digest('hex')===crypto.createHash('sha256').update(raw).digest('hex');if(!unchanged)throw new Error('读取期间历史状态变化，请重新导出');
const report={sourceSha256:crypto.createHash('sha256').update(raw).digest('hex'),sourceRevision:state.revision,originalUnchanged:unchanged,tasks:tasks.length,variants:tasks.reduce((n,t)=>n+t.variants.length,0),completedVariants:tasks.reduce((n,t)=>n+t.variants.filter(v=>v.articleHtml).length,0),localImages:images.size,imageReferences:tasks.reduce((n,t)=>n+t.variants.reduce((m,v)=>m+(v.articleHtml.match(/<img\b/g)||[]).length,0),0),imageHashes:[...images.values()].map(({sha256,bytes})=>({sha256,bytes})),exportSha256:crypto.createHash('sha256').update(await readFile(destination)).digest('hex')};
await writeFile(path.join(root,'../document/history-export.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
