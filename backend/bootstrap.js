const http=require('node:http');
let handler;
http.createServer((req,res)=>{
  if(!handler){
    let component='server';
    try{for(const name of ['@cloudbase/node-sdk','cheerio','sanitize-html','mammoth','jimp']){component=name;require(name);}component='server';handler=require('./server').handle;}catch(e){
      const missing=String(e.message||'').match(/Cannot find module '([@a-z0-9_./-]+)'/i)?.[1];
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'后端依赖加载失败',code:e.code||'LOAD_FAILED',component,...(missing?{module:missing}:{})}));return;
    }
  }
  handler(req,res);
}).listen(Number(process.env.PORT||9000),'0.0.0.0');
