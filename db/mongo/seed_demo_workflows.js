// Seed two fictional approval requests for a disposable local demo database.
// Run AFTER load.js and only when PostgreSQL has been initialized from
// db/sql/seed.sql; those SQL fixtures use event IDs 7 and 8.
//
// mongosh "mongodb://localhost:27017/cerms" db/mongo/seed_demo_workflows.js

const template = db.workflow_templates.findOne({
  template_code: 'CLUB_EVENT',
  version: 2,
  is_active: true
});

if (!template) {
  throw new Error('Run db/mongo/load.js first to load the active CLUB_EVENT template');
}

const now = new Date();
const demoEvents = [7, 8];
let seeded = 0;
let preserved = 0;

for (const eventId of demoEvents) {
  const stages = [
    { stage_no: 1, assigned_to_user_id: 6 }, // Faculty Two: Robotics Club advisor
    { stage_no: 2, assigned_to_user_id: 8 }, // HOD ECE
    { stage_no: 3, assigned_to_user_id: 10 }, // fictional demo Dean
    { stage_no: 4, assigned_to_user_id: 11 } // fictional demo Vice Chancellor
  ].map(({ stage_no, assigned_to_user_id }) => {
    const source = template.stages.find(stage => stage.stage_no === stage_no);
    const isCurrent = stage_no === 1;
    return {
      stage_no,
      name: source.name,
      approver_role: source.approver_role,
      approver_rule: source.approver_rule,
      sla_hours: source.sla_hours,
      assigned_to_user_id,
      status: isCurrent ? 'PENDING' : 'NOT_STARTED',
      due_by: isCurrent ? new Date(now.getTime() + source.sla_hours * 60 * 60 * 1000) : null,
      stage_assigned_at: isCurrent ? now : null,
      acted_by_user_id: null,
      acted_at: null,
      comment: null
    };
  });

  const instance = {
    event_id: eventId,
    template_code: template.template_code,
    template_version: template.version,
    status: 'IN_PROGRESS',
    current_stage_no: 1,
    submitted_by_user_id: 2, // Student Two
    submitted_at: now,
    stages,
    updated_at: now
  };

  // Never replace a workflow with the same event ID. A local reset creates
  // these rows once; rerunning this script preserves any later decisions.
  const result = db.workflow_instances.updateOne(
    { event_id: eventId },
    { $setOnInsert: instance },
    { upsert: true }
  );

  if (result.upsertedCount === 0) {
    preserved += 1;
    continue;
  }

  seeded += 1;
  const instanceId = result.upsertedId;
  db.workflow_audit.insertOne({
    event_id: eventId,
    workflow_instance_id: instanceId,
    stage_no: null,
    action: 'WORKFLOW_CREATED',
    acted_by_user_id: 2,
    comment: null,
    previous_status: null,
    new_status: 'IN_PROGRESS',
    stage_assigned_at: now,
    created_at: now
  });
  db.workflow_notifications.insertOne({
    event_id: eventId,
    recipient_user_id: 6,
    type: 'APPROVAL_ASSIGNED',
    message: `Approval required for event ${eventId}: ${stages[0].name}`,
    metadata: null,
    status: 'UNREAD',
    created_at: now,
    read_at: null
  });
}

print(`Demo workflow instances seeded: ${seeded}; existing instances preserved: ${preserved}`);
