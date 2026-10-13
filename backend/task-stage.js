// Only WeChat-confirmed drafts finish a task; generation alone does not.
function completedTaskIds(records){return new Set(records.filter(r=>r.taskId&&r.media_id&&r.status==='success').map(r=>r.taskId));}
module.exports={completedTaskIds};
