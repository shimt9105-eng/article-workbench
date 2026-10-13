const test=require('node:test');
const assert=require('node:assert/strict');
const {refundTrialCall}=require('../backend/quota-refund');
function fixture(failReceipt=false){
 const records=new Map([['visitor',{count:10}],['daily',{count:30}]]);let queue=Promise.resolve();
 const db={runTransaction(callback){const run=queue.then(async()=>{
  const copy=new Map([...records].map(([key,v])=>[key,structuredClone(v)]));
  const result=await callback({collection(){return {doc(id){return {
   async get(){return {data:copy.get(id)||null};},
   async update(value){copy.set(id,{...copy.get(id),...value});return {};},
   async set(value){if(failReceipt)throw new Error('simulated storage failure');copy.set(id,value);return {};}
  };}};}});
  records.clear();for(const [key,v]of copy)records.set(key,v);return result;
 });queue=run.catch(()=>{});return run;}};
 return {db,records};
}
test('duplicate failure callbacks restore exactly one visitor call and retain the daily protection count',async()=>{
 const {db,records}=fixture();
 const result=await Promise.all(Array.from({length:8},()=>refundTrialCall(db,'isolated','visitor','refund-attempt-1','attempt-1')));
 assert.equal(result.filter(Boolean).length,1);assert.equal(records.get('visitor').count,9);assert.equal(records.get('daily').count,30);
 assert.equal(records.get('refund-attempt-1').attemptId,'attempt-1');
});
test('a failed receipt write rolls the quota update back; zero usage is never made negative',async()=>{
 const failed=fixture(true);await assert.rejects(refundTrialCall(failed.db,'isolated','visitor','refund','attempt'));
 assert.equal(failed.records.get('visitor').count,10);assert.equal(failed.records.has('refund'),false);
 const empty=fixture();empty.records.set('visitor',{count:0});
 assert.equal(await refundTrialCall(empty.db,'isolated','visitor','refund','attempt'),false);assert.equal(empty.records.get('visitor').count,0);
});
