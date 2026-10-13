const {test}=require('node:test'),assert=require('node:assert/strict');
const {completedTaskIds}=require('../backend/task-stage');
test('only confirmed successful WeChat delivery completes the task',()=>{
 const ids=completedTaskIds([{taskId:'sent',status:'success',media_id:'wx-id'},{taskId:'missing-confirmation',status:'success'},{taskId:'unknown',status:'unknown',media_id:'maybe'},{taskId:'failed',status:'failed'},{taskId:'running',status:'running'}]);
 assert.deepEqual([...ids],['sent']);assert.equal(ids.has('generated-only'),false);
});
