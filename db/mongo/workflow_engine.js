// =====================================================================
// CERMS - MongoDB workflow engine
//
// Load with mongosh:
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/workflow_engine.js
//
// The application should call the functions in this file after validating
// PostgreSQL event/user data. approvers is an object keyed by approver_rule,
// for example { ANY_ADMIN: 9, HOD_OF_EVENT_DEPARTMENT: 7 }.
// =====================================================================

const workflowCollections = {
  templates: db.workflow_templates,
  instances: db.workflow_instances,
  audit: db.workflow_audit,
  notifications: db.workflow_notifications
};

function templateMatches(template, event) {
  const appliesTo = template.applies_to || {};
  return template.is_active === true
    && (appliesTo.event_category == null || appliesTo.event_category === event.category)
    && (appliesTo.event_type == null || appliesTo.event_type === event.event_type)
    && (appliesTo.department_code == null || appliesTo.department_code === event.department_code);
}

function templateSpecificity(template) {
  const appliesTo = template.applies_to || {};
  return [
    appliesTo.department_code,
    appliesTo.event_type,
    appliesTo.event_category
  ].filter(value => value != null).length;
}

function selectWorkflowTemplate(event) {
  const candidates = workflowCollections.templates
    .find({})
    .toArray()
    .filter(template => templateMatches(template, event))
    .sort((left, right) => {
      const specificity = templateSpecificity(right) - templateSpecificity(left);
      return specificity || right.version - left.version;
    });

  if (candidates.length === 0) {
    throw new Error(`No active workflow template matches event ${event.event_id}`);
  }
  return candidates[0];
}

function requiredFieldsPresent(template, event) {
  return (template.required_fields || []).filter(
    field => event[field] == null || event[field] === ''
  );
}

function resolveApprover(stage, approvers) {
  const userId = approvers[stage.approver_rule];
  if (userId == null) {
    throw new Error(
      `No approver supplied for rule ${stage.approver_rule} at stage ${stage.stage_no}`
    );
  }
  return userId;
}

function writeAudit(eventId, workflowId, stageNo, action, actorId, comment, previousStatus, newStatus, stageAssignedAt) {
  workflowCollections.audit.insertOne({
    event_id: eventId,
    workflow_instance_id: workflowId,
    stage_no: stageNo || null,
    action,
    acted_by_user_id: actorId || null,
    comment: comment || null,
    previous_status: previousStatus || null,
    new_status: newStatus || null,
    stage_assigned_at: stageAssignedAt || null,
    created_at: new Date()
  });
}

function createNotification(eventId, recipientId, type, message, metadata) {
  workflowCollections.notifications.insertOne({
    event_id: eventId,
    recipient_user_id: recipientId,
    type,
    message,
    metadata: metadata || null,
    status: 'UNREAD',
    created_at: new Date(),
    read_at: null
  });
}

function createWorkflowInstance(event, approvers) {
  if (workflowCollections.instances.findOne({ event_id: event.event_id })) {
    throw new Error(`Workflow already exists for event ${event.event_id}`);
  }

  const template = selectWorkflowTemplate(event);
  const missingFields = requiredFieldsPresent(template, event);
  if (missingFields.length > 0) {
    throw new Error(
      `Event ${event.event_id} is missing required fields: ${missingFields.join(', ')}`
    );
  }

  const submittedAt = new Date();
  const stages = template.stages.map(stage => {
    const skipped = (stage.skip_if_requester_role || [])
      .includes(event.requester_role);
    const assignedTo = skipped ? null : resolveApprover(stage, approvers);
    const status = skipped ? 'SKIPPED' : 'NOT_STARTED';
    return {
      stage_no: stage.stage_no,
      name: stage.name,
      approver_role: stage.approver_role,
      approver_rule: stage.approver_rule,
      sla_hours: stage.sla_hours,
      assigned_to_user_id: assignedTo,
      status,
      due_by: null,
      stage_assigned_at: null,
      acted_by_user_id: null,
      acted_at: null,
      comment: null
    };
  });

  const firstPending = stages.find(stage => stage.status === 'NOT_STARTED');
  if (!firstPending) {
    throw new Error(`Workflow for event ${event.event_id} has no actionable stage`);
  }
  firstPending.status = 'PENDING';
  firstPending.stage_assigned_at = submittedAt;
  firstPending.due_by = new Date(
    submittedAt.getTime() + firstPending.sla_hours * 60 * 60 * 1000
  );

  const instance = {
    event_id: event.event_id,
    template_code: template.template_code,
    template_version: template.version,
    status: 'IN_PROGRESS',
    current_stage_no: firstPending.stage_no,
    submitted_by_user_id: event.submitted_by_user_id,
    submitted_at: submittedAt,
    stages,
    updated_at: submittedAt
  };

  const result = workflowCollections.instances.insertOne(instance);
  writeAudit(event.event_id, result.insertedId, null, 'WORKFLOW_CREATED',
    event.submitted_by_user_id, null, null, 'IN_PROGRESS', submittedAt);
  createNotification(
    event.event_id,
    firstPending.assigned_to_user_id,
    'APPROVAL_ASSIGNED',
    `Approval required for event ${event.event_id}: ${firstPending.name}`
  );
  return workflowCollections.instances.findOne({ _id: result.insertedId });
}

function getPendingStage(instance) {
  return instance.stages.find(stage =>
    stage.stage_no === instance.current_stage_no && stage.status === 'PENDING'
  );
}

function actOnStage(eventId, actorId, action, comment) {
  const instance = workflowCollections.instances.findOne({ event_id: eventId });
  if (!instance) {
    throw new Error(`Workflow for event ${eventId} does not exist`);
  }
  if (instance.status !== 'IN_PROGRESS') {
    throw new Error(`Workflow for event ${eventId} is already ${instance.status}`);
  }

  const pendingStage = getPendingStage(instance);
  if (!pendingStage || pendingStage.assigned_to_user_id !== actorId) {
    throw new Error(`User ${actorId} is not assigned to the current workflow stage`);
  }

  const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const now = new Date();
  const stagePath = `stages.${pendingStage.stage_no - 1}`;
  const update = {
    [`${stagePath}.status`]: nextStatus,
    [`${stagePath}.acted_by_user_id`]: actorId,
    [`${stagePath}.acted_at`]: now,
    [`${stagePath}.comment`]: comment || null,
    updated_at: now
  };

  if (action === 'REJECT') {
    update.status = 'REJECTED';
    update.current_stage_no = null;
  } else {
    const nextStage = instance.stages.find(stage =>
      stage.stage_no > pendingStage.stage_no && stage.status === 'NOT_STARTED'
    );
    if (nextStage) {
      const nextPath = `stages.${nextStage.stage_no - 1}`;
      update[`${nextPath}.status`] = 'PENDING';
      update[`${nextPath}.due_by`] = new Date(
        now.getTime() + nextStage.sla_hours * 60 * 60 * 1000
      );
      update[`${nextPath}.stage_assigned_at`] = now;
      update.current_stage_no = nextStage.stage_no;
      createNotification(
        eventId,
        nextStage.assigned_to_user_id,
        'APPROVAL_ASSIGNED',
        `Approval required for event ${eventId}: ${nextStage.name}`
      );
    } else {
      update.status = 'APPROVED';
      update.current_stage_no = null;
      createNotification(
        eventId,
        instance.submitted_by_user_id,
        'WORKFLOW_COMPLETED',
        `All approvals are complete for event ${eventId}`
      );
    }
  }

  const updated = workflowCollections.instances.findOneAndUpdate(
    {
      _id: instance._id,
      status: 'IN_PROGRESS',
      [`${stagePath}.status`]: 'PENDING',
      [`${stagePath}.assigned_to_user_id`]: actorId
    },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!updated) {
    throw new Error('Workflow changed before this action could be committed');
  }

  writeAudit(
    eventId,
    instance._id,
    pendingStage.stage_no,
    `STAGE_${action}D`,
    actorId,
    comment,
    'PENDING',
    nextStatus,
    pendingStage.stage_assigned_at
  );
  if (action === 'REJECT') {
    createNotification(
      eventId,
      instance.submitted_by_user_id,
      'WORKFLOW_REJECTED',
      `Workflow rejected at stage ${pendingStage.stage_no}: ${comment || 'No reason provided'}`
    );
  }
  return updated;
}

function approveWorkflowStage(eventId, actorId, comment) {
  return actOnStage(eventId, actorId, 'APPROVE', comment);
}

function rejectWorkflowStage(eventId, actorId, comment) {
  if (!comment || comment.trim() === '') {
    throw new Error('A rejection comment is required');
  }
  return actOnStage(eventId, actorId, 'REJECT', comment);
}

function escalateOverdueStages(asOf) {
  const now = asOf || new Date();
  const overdue = workflowCollections.instances.find({
    status: 'IN_PROGRESS',
    'stages.status': 'PENDING',
    'stages.due_by': { $lt: now }
  }).toArray();

  overdue.forEach(instance => {
    const stage = instance.stages.find(candidate =>
      candidate.status === 'PENDING' && candidate.due_by < now
    );
    if (!stage) return;
    const alreadyNotified = workflowCollections.notifications.findOne({
      event_id: instance.event_id,
      type: 'SLA_ESCALATION',
      'metadata.stage_no': stage.stage_no,
      created_at: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    });
    if (!alreadyNotified) {
      createNotification(
        instance.event_id,
        stage.assigned_to_user_id,
        'SLA_ESCALATION',
        `Approval stage ${stage.stage_no} is overdue for event ${instance.event_id}`,
        { stage_no: stage.stage_no }
      );
    }
  });
  return overdue.length;
}

workflowCollections.instances.createIndex({ event_id: 1 }, { unique: true });
workflowCollections.audit.createIndex({ event_id: 1, created_at: -1 });
workflowCollections.notifications.createIndex({
  recipient_user_id: 1,
  status: 1,
  created_at: -1
});

print('CERMS workflow engine loaded');
