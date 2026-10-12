const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function same(a, b) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); }
async function passwordHash(password, salt=crypto.randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('密码需要 12–128 个字符');
  return {salt, hash: (await scrypt(password, salt, 64)).toString('hex')};
}
function encrypt(value, key) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.');
}
function decrypt(value, key) {
  const [iv,tag,body]=value.split('.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64')),decipher.final()]).toString('utf8'));
}
function privateAddress(address) {
  if(net.isIP(address)===6) {
    const ip=address.toLowerCase();
    if(ip.startsWith('::ffff:')) return privateAddress(ip.slice(7));
    return !/^[23][0-9a-f]{0,3}:/.test(ip);
  }
  if(net.isIP(address)!==4) return true;
  const [a,b]=address.split('.').map(Number);
  return a===0 || a===10 || a===127 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && b===168 || a===100 && b>=64 && b<=127 || a>=224 || a===198 && [18,19].includes(b);
}
async function safeUrl(input) {
  const u=new URL(input);
  if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443') throw new Error('只支持公共 HTTPS 地址');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const answers=await dns.lookup(host,{all:true});
  if(!answers.length || answers.some(a=>privateAddress(a.address))) throw new Error('地址不得指向本机或内部网络');
  return u;
}
async function download(input, max=10*1024*1024) {
  const u=await safeUrl(input);
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) throw new Error(`读取失败（HTTP ${r.status}）`);
  const chunks=[]; let length=0;
  for await(const chunk of r.body) {length+=chunk.length; if(length>max) throw new Error('文件超过大小限制'); chunks.push(Buffer.from(chunk));}
  return {buffer:Buffer.concat(chunks),type:r.headers.get('content-type')||''};
}
module.exports={digest,same,passwordHash,encrypt,decrypt,privateAddress,safeUrl,download};
