// =====================================================================
// CERMS - MongoDB Read / Update / Delete demonstration
//
// Run from the repository root, AFTER load.js (load.js resets the
// collections, so the demo gives the same output every time):
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/workflow_rud.js
//
// Collections: workflow_templates, workflow_instances, workflow_audit,
// workflow_notifications. Event and user IDs refer to the PostgreSQL
// seed data (seed.sql).
// =====================================================================

const path = require('path');

// Reuse the workflow engine (createWorkflowInstance, deleteWorkflowForEvent,
// purgeOldNotifications, ...).
load(path.resolve('db', 'mongo', 'workflow_engine.js'));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = days => new Date(now.getTime() - days * DAY);

function heading(title) {
  print('\n' + '='.repeat(70) + '\n' + title + '\n' + '='.repeat(70));
}
function show(label, value) {
  print('\n--- ' + label);
  printjson(value);
}


// ---------------------------------------------------------------------
// 0. SETUP: sample documents the demo needs (not part of R/U/D).
//    Fixed _ids + upserts keep this re-runnable.
// ---------------------------------------------------------------------
heading('0. SETUP');

// Workflow for event 2 (ECE Technical Symposium, DEPARTMENT event),
// created through the engine. This also writes an audit entry and a
// notification for the first approver (HOD Two, user 8).
if (!db.workflow_instances.findOne({ event_id: 2 })) {
  createWorkflowInstance(
    { event_id: 2, category: 'DEPARTMENT', event_type: 'SEMINAR',
      department_code: 'ECE', requester_role: 'FACULTY', submitted_by_user_id: 6 },
    { HOD_OF_EVENT_DEPARTMENT: 8, ANY_ADMIN: 9 }
  );
}

// An old workflow for event 6 (Coding Club Meetup), which was CANCELLED.
db.workflow_instances.updateOne(
  { event_id: 6 },
  { $setOnInsert: {
      event_id: 6, template_code: 'CLUB_EVENT', template_version: 1,
      status: 'CANCELLED', current_stage_no: null,
      submitted_by_user_id: 3, submitted_at: new Date('2026-09-10T04:30:00Z'),
      stages: [
        { stage_no: 1, name: 'Club Coordinator Review', approver_role: 'CLUB_COORDINATOR',
          assigned_to_user_id: null, status: 'SKIPPED' },
        { stage_no: 2, name: 'Faculty Advisor Approval', approver_role: 'FACULTY',
          assigned_to_user_id: 5, status: 'NOT_STARTED' }
      ],
      updated_at: new Date('2026-09-12T04:30:00Z') } },
  { upsert: true }
);

// Notifications of different ages and states.
[
  { _id: 'demo-n1', recipient_user_id: 7, event_id: 3, type: 'APPROVAL_ASSIGNED',
    message: 'Approval required for event 3: HOD Approval', status: 'UNREAD', created_at: daysAgo(1),  read_at: null },
  { _id: 'demo-n2', recipient_user_id: 7, event_id: 1, type: 'APPROVAL_ASSIGNED',
    message: 'Approval required for event 1: HOD Approval', status: 'READ',   created_at: daysAgo(45), read_at: daysAgo(44) },
  { _id: 'demo-n3', recipient_user_id: 1, event_id: 5, type: 'WORKFLOW_COMPLETED',
    message: 'All approvals are complete for event 5',      status: 'READ',   created_at: daysAgo(40), read_at: daysAgo(39) },
  { _id: 'demo-n4', recipient_user_id: 1, event_id: 3, type: 'STAGE_APPROVED',
    message: 'Faculty advisor approved event 3',           status: 'UNREAD', created_at: daysAgo(2),  read_at: null },
  { _id: 'demo-n5', recipient_user_id: 5, event_id: 3, type: 'APPROVAL_ASSIGNED',
    message: 'Approval required for event 3: Faculty Advisor Approval', status: 'READ', created_at: daysAgo(10), read_at: daysAgo(9) }
].forEach(doc => db.workflow_notifications.replaceOne({ _id: doc._id }, doc, { upsert: true }));

show('documents per collection after setup', {
  workflow_templates: db.workflow_templates.countDocuments(),
  workflow_instances: db.workflow_instances.countDocuments(),
  workflow_audit: db.workflow_audit.countDocuments(),
  workflow_notifications: db.workflow_notifications.countDocuments()
});


// ---------------------------------------------------------------------
// 1. READ
// ---------------------------------------------------------------------
heading('1. READ');

// R1. find() with a projection: only the fields we need (code, name and
//     the stage names) of every active template.
show('R1 active templates, projected to code, name and stage names',
  db.workflow_templates.find(
    { is_active: true },
    { _id: 0, template_code: 1, version: 1, name: 1, 'stages.stage_no': 1, 'stages.name': 1 }
  ).toArray());

// R2. Filter on a nested array with $elemMatch: workflows where ONE stage
//     is both an HOD stage and still PENDING (both conditions on the
//     same array element).
show('R2 workflows waiting for an HOD ($elemMatch)',
  db.workflow_instances.find(
    { stages: { $elemMatch: { approver_role: 'HOD', status: 'PENDING' } } },
    { _id: 0, event_id: 1, template_code: 1, current_stage_no: 1 }
  ).toArray());

// R3. Approver inbox: the stages assigned to HOD One (user 7) that are
//     still pending. 'stages.$' returns only the matching stage.
show('R3 approver inbox for user 7 (positional projection stages.$)',
  db.workflow_instances.find(
    { status: 'IN_PROGRESS',
      stages: { $elemMatch: { assigned_to_user_id: 7, status: 'PENDING' } } },
    { _id: 0, event_id: 1, template_code: 1, 'stages.$': 1 }
  ).toArray());

// R4. sort + limit: the three newest notifications on the system.
show('R4 three newest notifications (sort by created_at desc, limit 3)',
  db.workflow_notifications.find({}, { _id: 0, recipient_user_id: 1, type: 1, status: 1, created_at: 1 })
    .sort({ created_at: -1 })
    .limit(3)
    .toArray());

// R5. Aggregation pipeline with $unwind + $group + $lookup:
//     how many stages of each template are in each status, with the
//     template's display name joined in from workflow_templates.
show('R5 stage status per template ($unwind, $group, $lookup)',
  db.workflow_instances.aggregate([
    { $unwind: '$stages' },                               // one document per stage
    { $group: {                                           // count per template + status
        _id: { template_code: '$template_code', stage_status: '$stages.status' },
        stages: { $sum: 1 } } },
    { $lookup: {                                          // join the template's name
        from: 'workflow_templates',
        localField: '_id.template_code',
        foreignField: 'template_code',
        as: 'template' } },
    { $project: {
        _id: 0,
        template_code: '$_id.template_code',
        template_name: { $first: '$template.name' },
        stage_status: '$_id.stage_status',
        stages: 1 } },
    { $sort: { template_code: 1, stage_status: 1 } }
  ]).toArray());


// ---------------------------------------------------------------------
// 2. UPDATE
// ---------------------------------------------------------------------
heading('2. UPDATE');

// U1. updateOne with the positional operator $ plus $set, $inc and $push.
//     HOD One (user 7) approves stage 3 of event 3. The filter's
//     $elemMatch finds the stage; 'stages.$' updates exactly that stage.
//     (The app does this through approveWorkflowStage(); here the
//     operators are shown directly.)
const u1 = db.workflow_instances.updateOne(
  { event_id: 3, status: 'IN_PROGRESS',
    stages: { $elemMatch: { stage_no: 3, status: 'PENDING', assigned_to_user_id: 7 } } },
  { $set:  { 'stages.$.status': 'APPROVED',
             'stages.$.acted_by_user_id': 7,
             'stages.$.acted_at': now,
             'stages.$.comment': 'Approved by HOD.',
             updated_at: now },
    $inc:  { current_stage_no: 1 },                                   // 3 -> 4
    $push: { remarks: { by_user_id: 7, text: 'Venue moved to Seminar Hall B is fine.', at: now } } }
);
// ...and the next stage (4, admin) becomes PENDING.
const u1b = db.workflow_instances.updateOne(
  { event_id: 3, 'stages.stage_no': 4 },
  { $set: { 'stages.$.status': 'PENDING',
            'stages.$.assigned_to_user_id': 9,
            'stages.$.due_by': new Date(now.getTime() + 72 * 60 * 60 * 1000) } }
);
show('U1 positional $ update (matched / modified)',
  { stage3: [u1.matchedCount, u1.modifiedCount], stage4: [u1b.matchedCount, u1b.modifiedCount] });
show('U1 event 3 stages after the update',
  db.workflow_instances.findOne({ event_id: 3 },
    { _id: 0, current_stage_no: 1, remarks: 1, 'stages.stage_no': 1, 'stages.status': 1 }));

// U2. updateMany: HOD One opens the inbox, so all of user 7's UNREAD
//     notifications become READ.
const u2 = db.workflow_notifications.updateMany(
  { recipient_user_id: 7, status: 'UNREAD' },
  { $set: { status: 'READ', read_at: now } }
);
show('U2 updateMany: mark user 7 notifications READ', { matched: u2.matchedCount, modified: u2.modifiedCount });

// U3. Deactivate a template: GUEST_LECTURE v1 is no longer offered for new
//     events. Running workflows keep their own copy of the stages.
const u3 = db.workflow_templates.updateOne(
  { template_code: 'GUEST_LECTURE', version: 1 },
  { $set: { is_active: false } }
);
show('U3 deactivate GUEST_LECTURE v1', { matched: u3.matchedCount, modified: u3.modifiedCount });

// U4. Upsert a new template version: insert GUEST_LECTURE v2 if it does
//     not exist, otherwise update it. v2 drops the faculty review stage.
const u4 = db.workflow_templates.updateOne(
  { template_code: 'GUEST_LECTURE', version: 2 },
  { $set: {
      name: 'Guest Lecture Approval (v2)',
      description: 'Faculty review removed; HOD and admin only. PLACEHOLDER.',
      applies_to: { event_category: 'ACADEMIC', event_type: 'GUEST_LECTURE', department_code: null },
      is_active: true,
      required_fields: ['guest_name', 'guest_affiliation', 'talk_topic'],
      stages: [
        { stage_no: 1, name: 'HOD Approval', approver_role: 'HOD',
          approver_rule: 'HOD_OF_EVENT_DEPARTMENT', sla_hours: 48 },
        { stage_no: 2, name: 'Admin: Gate Pass and Final Approval', approver_role: 'ADMIN',
          approver_rule: 'ANY_ADMIN', sla_hours: 48 }
      ],
      on_reject: 'STOP' },
    $setOnInsert: { created_by_user_id: 9, created_at: now } },     // only on first insert
  { upsert: true }
);
show('U4 upsert GUEST_LECTURE v2', { matched: u4.matchedCount, modified: u4.modifiedCount, upserted: u4.upsertedCount });
show('U4 GUEST_LECTURE versions now',
  db.workflow_templates.find({ template_code: 'GUEST_LECTURE' },
    { _id: 0, version: 1, is_active: 1, 'stages.name': 1 }).sort({ version: 1 }).toArray());


// ---------------------------------------------------------------------
// 3. DELETE
// ---------------------------------------------------------------------
heading('3. DELETE');

// D1. deleteOne: remove the workflow of event 6, which was cancelled.
const d1 = db.workflow_instances.deleteOne({ event_id: 6, status: 'CANCELLED' });
show('D1 deleteOne cancelled event 6 workflow', { deletedCount: d1.deletedCount });

// D2. deleteMany (inside purgeOldNotifications): READ notifications
//     older than 30 days. demo-n2 (45 days) and demo-n3 (40 days) go;
//     demo-n5 (10 days) and unread ones stay.
const d2 = purgeOldNotifications(30);
show('D2 purgeOldNotifications(30) -> deleteMany', { deletedCount: d2 });

// D3. Event 2 was cancelled in PostgreSQL (trg_cancel_event_bookings),
//     so its workflow is deleted: instance + unread notifications.
//     The audit trail stays, with a new WORKFLOW_DELETED entry.
const d3 = deleteWorkflowForEvent(2, 9, 'Event 2 cancelled in PostgreSQL');
show('D3 deleteWorkflowForEvent(2)', d3);
show('D3 audit entries kept for event 2',
  db.workflow_audit.find({ event_id: 2 }, { _id: 0, action: 1, acted_by_user_id: 1, comment: 1 })
    .sort({ created_at: 1 }).toArray());

show('documents per collection at the end', {
  workflow_templates: db.workflow_templates.countDocuments(),
  workflow_instances: db.workflow_instances.countDocuments(),
  workflow_audit: db.workflow_audit.countDocuments(),
  workflow_notifications: db.workflow_notifications.countDocuments()
});
