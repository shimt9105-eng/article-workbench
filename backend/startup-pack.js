// De-duplicate embedded media only in the transport. Stored articles and source
// documents remain byte-for-byte intact; unpacking restores every occurrence.
function packStartup(value){
 const images=[],ids=new Map();
 const json=JSON.stringify(value,(_,item)=>{
  if(typeof item!=='string')return item;
  return item.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,src=>{
   if(!ids.has(src)){ids.set(src,images.length);images.push(src);}
   return 'workbench-image:'+ids.get(src)+':end';
  });
 });
 return JSON.stringify({json,images});
}
module.exports={packStartup};
