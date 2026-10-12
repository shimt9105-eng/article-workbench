#!/usr/bin/env python3
"""Deploy the web API. Credentials never enter the repository or command output."""
import json
import base64
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent
ROOT = SCRIPT.parents[2]
NAME = 'article-workbench-api'
SENSITIVE = []

def load(path):
    result = {}
    for line in path.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
    return result

def run(args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        detail=result.stdout+'\n'+result.stderr
        for secret in sorted(SENSITIVE,key=len,reverse=True):
            if secret: detail=detail.replace(secret,'[REDACTED]')
        raise RuntimeError(f'操作失败（退出码 {result.returncode}）：'+detail[-2200:])
    return result.stdout

def query(base, fields):
    args = [str(Path.home()/'.local/bin/dws'), 'aitable', '+record-query', '--base-id', base, '--table-id', 'hERWDMS', '--field-ids', ','.join(fields), '--format', 'json']
    payload = json.loads(run(args))
    data=payload.get('data',{})
    if data.get('hasMore'):
        raise RuntimeError('配置表未读取完整，停止部署；需使用分页读取')
    return data.get('records',[])

def cell(v):
    if isinstance(v,dict): return str(v.get('name') or v.get('value') or '')
    if isinstance(v,list): return ','.join(cell(i) for i in v)
    return str(v or '')

def main():
    settings=load(Path.home()/'.config/编辑2号/bot.env')
    wx=load(Path.home()/'.config/编辑3号/bot.env')
    cli=os.path.expandvars(settings['CLOUDBASE_CLI_PATH'])
    key=load(Path.home()/'.config/切片1号/cloudbase.env')['CLOUDBASE_APIKEY']
    fields=['01ZM8y7','QybOYGI','GXThFWU','NrdW3Kp','WdsdUnY','VHWsePx','9M1HNXb','zVLxI9t']
    records=query('mExel2BLV5DN6KYaFpM56EkMWgk9rpMq',fields)
    models=[]
    for r in records:
        c=r.get('cells',{})
        if cell(c.get('NrdW3Kp'))!='是': continue
        m=dict(id=str(r.get('recordId') or r.get('id')),name=cell(c.get('01ZM8y7')),apiKey=cell(c.get('QybOYGI')),source=cell(c.get('GXThFWU')),baseUrl=cell(c.get('WdsdUnY')).rstrip('/'),protocol=cell(c.get('VHWsePx')),thinking=cell(c.get('9M1HNXb')),type=cell(c.get('zVLxI9t')))
        if all(m.get(k) for k in ['id','name','apiKey','source','baseUrl']) and m['baseUrl'].startswith('https://') and not any(s in m['baseUrl'].lower() for s in ['127.0.0.1','localhost','codex-cli']): models.append(m)
    search_records=query('mExel2BLV5DN6KYaFpXBDXQjWgk9rpMq',['01ZM8y7','3859Vfe'])
    search_keys=[cell(r.get('cells',{}).get('3859Vfe')) for r in search_records if cell(r.get('cells',{}).get('01ZM8y7')).lower()=='tikhub']
    if len(search_keys)!=1 or not search_keys[0]: raise RuntimeError('TikHub 配置不唯一或未配置')
    if not models: raise RuntimeError('没有可部署的在线模型配置')
    secret_dir=Path.home()/'.config/article-workbench-web';secret_dir.mkdir(mode=0o700,exist_ok=True)
    secret_file=secret_dir/'backend-secrets.json'
    if secret_file.exists(): private=json.loads(secret_file.read_text())
    else:
        private={'ENCRYPTION_KEY':secrets.token_hex(32),'SESSION_SECRET':secrets.token_hex(32)}
        fd=os.open(secret_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: json.dump(private,f)
    os.chmod(secret_file,0o600)
    env={**private,'CLOUDBASE_ENV_ID':settings['CLOUDBASE_ENV_ID'],'CLOUDBASE_APIKEY':key,'MODELS_B64':base64.b64encode(json.dumps(models,ensure_ascii=False).encode()).decode(),'TIKHUB_API_KEY':search_keys[0],'WECHAT_API_BASE_URL':wx['WECHAT_API_BASE_URL'],'WECHAT_PROXY_SECRET':wx.get('WECHAT_PROXY_SECRET',''),'ALLOWED_ORIGINS':'https://shimt9105-eng.github.io','USE_SHARED_CONFIG':'enabled','TRIAL_ENABLED':'enabled','TRIAL_SCOPE':'visitor','DAILY_LIMIT':'quota:30','GLOBAL_DAILY_LIMIT':'quota:30','TZ':'Asia/Shanghai'}
    SENSITIVE.extend([key,search_keys[0],wx.get('WECHAT_PROXY_SECRET',''),*private.values(),*[m['apiKey'] for m in models],env['MODELS_B64']])
    config={'envId':settings['CLOUDBASE_ENV_ID'],'functions':[{'name':NAME,'dir':str(SCRIPT/'backend'),'type':'HTTP','runtime':'Nodejs20.19','handler':'server.main','gatewayPath':'/'+NAME,'public':True,'timeout':900,'memorySize':512,'installDependency':True,'ignore':['node_modules/**','node_modules','.git/**'],'envVariables':env}]}
    # Bootstrap only new, separately named collections; existing desktop/bot state is untouched.
    for name in ['users','sessions','credentials','limits','tasks','variants','searches','drafts']:
        command={'update':'article_web_'+name,'updates':[{'q':{'_id':'__bootstrap__'},'u':{'$set':{'bootstrap':True}},'upsert':True}]}
        run([cli,'db','nosql','execute','-e',settings['CLOUDBASE_ENV_ID'],'--command',json.dumps([{'TableName':'article_web_'+name,'CommandType':'UPDATE','Command':json.dumps(command)}]),'--json'],SCRIPT)
    with tempfile.TemporaryDirectory(prefix='article-workbench-deploy-') as directory:
        p=Path(directory)/'cloudbaserc.json';p.write_text(json.dumps(config,ensure_ascii=False));p.chmod(0o600)
        run([cli,'fn','deploy',NAME,'--force','--httpFn','--dir',str(SCRIPT/'backend'),'--install-dependency','true','--json'],directory)
    public={'version':'2.1.1','envId':settings['CLOUDBASE_ENV_ID'],'api':settings['CLOUDBASE_SITE_URL']+'/'+NAME,'models':[{'source':m['source'],'name':m['name'],'type':m['type']} for m in models],'trialLimit':10,'trialScope':'visitor','globalDailyLimit':30}
    (SCRIPT.parent/'document'/'deployment.json').write_text(json.dumps(public,ensure_ascii=False,indent=2))
    print(json.dumps({'deployed':NAME,'modelCount':len(models),'api':public['api']},ensure_ascii=False))

if __name__=='__main__':main()
