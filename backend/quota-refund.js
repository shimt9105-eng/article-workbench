// Atomic, idempotent compensation. Daily site protection still counts every attempt.
async function refundTrialCall(db, collectionName, quotaId, refundId, attemptId) {
  return db.runTransaction(async transaction => {
    const collection=transaction.collection(collectionName);
    const receipt=await collection.doc(refundId).get();
    if(receipt.code)throw new Error('Quota receipt read failed');
    if(receipt.data)return false;
    const usage=await collection.doc(quotaId).get();
    if(usage.code)throw new Error('Quota read failed');
    if(!usage.data||!Number.isInteger(usage.data.count)||usage.data.count<=0)return false;
    const updated=await collection.doc(quotaId).update({count:usage.data.count-1});
    if(updated.code)throw new Error('Quota refund failed');
    const saved=await collection.doc(refundId).set({type:'model_failure_refund',quotaId,attemptId,createdAt:Date.now()});
    if(saved.code)throw new Error('Quota receipt write failed');
    return true;
  });
}
module.exports={refundTrialCall};
