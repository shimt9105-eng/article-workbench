const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../web'),history=JSON.parse(fs.readFileSync(path.join(root,'history.json')));
test('historical articles retain all model versions and only expose read-only finished content',()=>{
  assert.equal(history.tasks.length,3);assert.equal(history.tasks.flatMap(t=>t.variants).length,14);assert.equal(history.tasks.flatMap(t=>t.variants).filter(v=>v.articleHtml).length,12);
  for(const t of history.tasks){assert(t.readOnly);assert(t.variants.some(v=>v.modelId===t.activeModelId));for(const f of ['sourceDocContent','sourceDocHtml','originalEssay','appSecret','apiKey','publishedMediaByModel'])assert(!(f in t));for(const v of t.variants){assert(v.readOnly);assert.deepEqual(v.comments,[]);}}
  assert(!/\/Users\/|file:|<script|onerror=/.test(JSON.stringify(history)));
});
test('historical local images exist and retain their original checksum without duplicates',()=>{
  assert.equal(history.tasks.flatMap(t=>t.variants).reduce((n,v)=>n+(v.articleHtml.match(/<img\b/g)||[]).length,0),9);
  const files=fs.readdirSync(path.join(root,'history-media'));assert.equal(files.length,4);
  for(const name of files){const buffer=fs.readFileSync(path.join(root,'history-media',name));assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'),path.parse(name).name);assert(buffer.length>0);}
  for(const t of history.tasks)for(const v of t.variants)for(const m of v.articleHtml.matchAll(/src="(history-media\/[^" ]+)"/g))assert(fs.existsSync(path.join(root,m[1])));
});

test('shared examples are frozen to the three approved tasks',()=>{
  assert.equal(history.frozen,true);
  assert.deepEqual(history.sharedTaskIds,history.tasks.map(t=>t.id));
  assert.deepEqual(history.sharedTaskIds,['history_8aeaa078cf0b4dd892de1f942649cf6a','history_task-1791692814557-41f5c694cb','history_task-1790058368333-4564359bfe']);
});
