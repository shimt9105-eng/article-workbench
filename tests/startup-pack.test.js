const {test}=require('node:test'),assert=require('node:assert/strict');
const {packStartup}=require('../backend/startup-pack');
test('startup transport deduplicates repeated source media and restores article and source bytes',()=>{
 const image='data:image/png;base64,'+'QUJD'.repeat(30000);
 const source={state:{tasks:[{sourceImages:[{src:image}],sourceDocHtml:`<p>素材</p><img src="${image}">`,variants:[{articleHtml:`<h1>正文</h1><img src="${image}">`,revision:7}]}]},quota:{remaining:1}};
 const before=JSON.stringify(source);const packed=JSON.parse(packStartup(source));
 const restored=JSON.parse(packed.json,(_,item)=>typeof item==='string'?item.replace(/workbench-image:(\d+):end/g,(marker,id)=>packed.images[Number(id)]??marker):item);
 assert.equal(packed.images.length,1);assert.deepEqual(restored,source);assert.equal(JSON.stringify(source),before);assert.ok(packStartup(source).length<before.length/2);
});
