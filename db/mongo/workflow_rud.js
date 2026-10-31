// =====================================================================
// CERMS - isolated MongoDB Read / Update / Delete demonstration
//
// Run after loading workflow templates:
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/workflow_rud.js
//
// This script uses only workflow_rud_demo* scratch collections. It does
// not create fake production users, alter live workflow instances, or
// delete production workflow, audit, or notification data.
// =====================================================================

const source = db.workflow_templates.findOne({ template_code: 'STANDARD_EVENT', is_active: true });
if (!source) throw new Error('Load the active workflow templates before running this demo');

const key = 'four-stage-example';
const workflows = db.workflow_rud_demo;
const audits = db.workflow_rud_demo_audit;
const notifications = db.workflow_rud_demo_notifications;

const demo = {
  demo_key: key,
  template_code: source.template_code,
  template_version: source.version,
  status: 'IN_PROGRESS',
  current_stage_no: 1,
  stages: source.stages.map(stage => ({
    stage_no: stage.stage_no,
    name: stage.name,
    approver_role: stage.approver_role,
    status: stage.stage_no === 1 ? 'PENDING' : 'NOT_STARTED'
  })),
  updated_at: new Date()
};

workflows.replaceOne({ demo_key: key }, demo, { upsert: true });
audits.replaceOne({ demo_key: key, action: 'WORKFLOW_CREATED' }, {
  demo_key: key, action: 'WORKFLOW_CREATED', created_at: new Date()
}, { upsert: true });
notifications.replaceOne({ demo_key: key, type: 'APPROVAL_ASSIGNED' }, {
  demo_key: key, type: 'APPROVAL_ASSIGNED', approver_role: source.stages[0].approver_role,
  status: 'UNREAD', created_at: new Date()
}, { upsert: true });

print('\n--- R: active approval templates');
printjson(db.workflow_templates.find(
  { is_active: true },
  { _id: 0, template_code: 1, version: 1, 'stages.stage_no': 1, 'stages.approver_role': 1 }
).toArray());

print('\n--- R: scratch workflow pending at its current stage');
printjson(workflows.findOne(
  { demo_key: key, stages: { $elemMatch: { stage_no: 1, status: 'PENDING' } } },
  { _id: 0, demo_key: 1, current_stage_no: 1, stages: 1 }
));

print('\n--- U: approve stage 1 and activate stage 2 with a positional update');
const update = workflows.updateOne(
  { demo_key: key, status: 'IN_PROGRESS', current_stage_no: 1,
    stages: { $elemMatch: { stage_no: 1, status: 'PENDING' } } },
  { $set: {
      'stages.$[current].status': 'APPROVED',
      'stages.$[next].status': 'PENDING',
      current_stage_no: 2,
      updated_at: new Date()
    } },
  { arrayFilters: [{ 'current.stage_no': 1 }, { 'next.stage_no': 2 }] }
);
printjson({ matched: update.matchedCount, modified: update.modifiedCount,
  workflow: workflows.findOne({ demo_key: key }, { _id: 0, current_stage_no: 1, stages: 1 }) });

print('\n--- U: mark the scratch assignment notification read');
printjson(notifications.updateOne(
  { demo_key: key, status: 'UNREAD' },
  { $set: { status: 'READ', read_at: new Date() } }
));

print('\n--- D: remove the scratch workflow only; retain its scratch audit record');
printjson(workflows.deleteOne({ demo_key: key }));
printjson({ remainingScratchAudits: audits.countDocuments({ demo_key: key }),
  remainingScratchNotifications: notifications.countDocuments({ demo_key: key }) });
