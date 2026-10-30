// Approval-workflow engine for the web app: a TypeScript port of
// db/mongo/workflow_engine.js using the official mongodb driver.
//
// Same collections and document shapes as the mongosh engine, so
// db/mongo/analytics.js reports on workflows started from either one:
//   workflow_templates      approval chains (workflow_templates.json)
//   workflow_instances      one running approval per PostgreSQL event_id
//   workflow_audit          append-only history (WORKFLOW_CREATED, STAGE_APPROVED, ...)
//   workflow_notifications  inbox messages for approvers and requesters
//
// MongoDB decides WHICH stage is current and who is assigned to it.
// PostgreSQL facts (event category, department, who the approvers are)
// come from workflow_context(); see db/sql/workflow.sql.
import type { Db, ObjectId } from "mongodb";
import { mongoDatabase } from "./db";

// ---------------------------------------------------------------------
// Document shapes
// ---------------------------------------------------------------------

export type StageStatus = "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
export type WorkflowStatus = "IN_PROGRESS" | "APPROVED" | "REJECTED" | "CANCELLED";

type TemplateStage = {
  stage_no: number;
  name: string;
  approver_role: string;
  approver_rule: string;
  sla_hours: number;
  skip_if_requester_role?: string[];
};

type WorkflowTemplate = {
  template_code: string;
  version: number;
  name: string;
  applies_to?: {
    event_category?: string | null;
    event_type?: string | null;
    department_code?: string | null;
  };
  is_active: boolean;
  required_fields?: string[];
  stages: TemplateStage[];
};

export type WorkflowStage = {
  stage_no: number;
  name: string;
  approver_role: string;
  approver_rule?: string;
  sla_hours?: number;
  assigned_to_user_id: number | null;
  status: StageStatus;
  due_by?: Date | null;
  stage_assigned_at?: Date | null;
  acted_by_user_id: number | null;
  acted_at: Date | null;
  comment: string | null;
};

export type WorkflowInstance = {
  _id?: ObjectId;
  event_id: number;
  template_code: string;
  template_version: number;
  status: WorkflowStatus;
  current_stage_no: number | null;
  submitted_by_user_id: number;
  submitted_at: Date;
  stages: WorkflowStage[];
  updated_at: Date;
};

export type WorkflowAudit = {
  event_id: number;
  workflow_instance_id: ObjectId;
  stage_no: number | null;
  action: string;
  acted_by_user_id: number | null;
  comment: string | null;
  previous_status: string | null;
  new_status: string | null;
  stage_assigned_at: Date | null;
  created_at: Date;
};

type WorkflowNotification = {
  event_id: number;
  recipient_user_id: number | null;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  status: "UNREAD" | "READ";
  created_at: Date;
  read_at: Date | null;
};

// What the engine needs to know about the PostgreSQL event.
export type WorkflowEvent = {
  event_id: number;
  category: string;
  event_type: string;
  department_code: string | null;
  requester_role: string;          // app role of the organizer (skip_if_requester_role)
  submitted_by_user_id: number;
  [field: string]: unknown;        // extra fields checked by required_fields
};

// One user per approver_rule, e.g. { HOD_OF_EVENT_DEPARTMENT: 7, ANY_ADMIN: 9 }.
export type Approvers = Record<string, number | null | undefined>;

// An expected failure with the HTTP status the API should answer with.
export class WorkflowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkflowError";
  }
}

async function collections() {
  const db: Db = await mongoDatabase();
  return {
    templates: db.collection<WorkflowTemplate>("workflow_templates"),
    instances: db.collection<WorkflowInstance>("workflow_instances"),
    audit: db.collection<WorkflowAudit>("workflow_audit"),
    notifications: db.collection<WorkflowNotification>("workflow_notifications")
  };
}

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------
// Template selection (same rules as workflow_engine.js)
// ---------------------------------------------------------------------

function templateMatches(template: WorkflowTemplate, event: WorkflowEvent): boolean {
  const appliesTo = template.applies_to ?? {};
  return template.is_active === true
    && (appliesTo.event_category == null || appliesTo.event_category === event.category)
    && (appliesTo.event_type == null || appliesTo.event_type === event.event_type)
    && (appliesTo.department_code == null || appliesTo.department_code === event.department_code);
}

// More non-null fields in applies_to = more specific.
function templateSpecificity(template: WorkflowTemplate): number {
  const appliesTo = template.applies_to ?? {};
  return [appliesTo.department_code, appliesTo.event_type, appliesTo.event_category]
    .filter(value => value != null).length;
}

// The most specific active template for the event; newest version wins a tie.
export async function selectWorkflowTemplate(event: WorkflowEvent): Promise<WorkflowTemplate> {
  const { templates } = await collections();
  const candidates = (await templates.find({}).toArray())
    .filter(template => templateMatches(template, event))
    .sort((left, right) =>
      templateSpecificity(right) - templateSpecificity(left) || right.version - left.version
    );

  if (candidates.length === 0) {
    throw new WorkflowError(`No active workflow template matches event ${event.event_id}`, 422);
  }
  return candidates[0];
}

function missingRequiredFields(template: WorkflowTemplate, event: WorkflowEvent): string[] {
  return (template.required_fields ?? []).filter(
    field => event[field] == null || event[field] === ""
  );
}

function resolveApprover(stage: TemplateStage, approvers: Approvers): number {
  const userId = approvers[stage.approver_rule];
  if (userId == null) {
    throw new WorkflowError(
      `No approver found for rule ${stage.approver_rule} at stage ${stage.stage_no}`,
      422
    );
  }
  return userId;
}

// ---------------------------------------------------------------------
// Audit and notifications (same fields as workflow_engine.js)
// ---------------------------------------------------------------------

async function writeAudit(entry: Omit<WorkflowAudit, "created_at">): Promise<void> {
  const { audit } = await collections();
  await audit.insertOne({ ...entry, created_at: new Date() });
}

async function createNotification(
  eventId: number,
  recipientId: number | null,
  type: string,
  message: string,
  metadata: Record<string, unknown> | null = null
): Promise<void> {
  const { notifications } = await collections();
  await notifications.insertOne({
    event_id: eventId,
    recipient_user_id: recipientId,
    type,
    message,
    metadata,
    status: "UNREAD",
    created_at: new Date(),
    read_at: null
  });
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

// Starts the approval of one event: copies the template's stages into a
// new instance (so later template edits do not change running
// approvals), marks stages SKIPPED when skip_if_requester_role says so,
// assigns every other stage to a user, and makes the first one PENDING.
export async function createWorkflowInstance(
  event: WorkflowEvent,
  approvers: Approvers
): Promise<WorkflowInstance> {
  const { instances } = await collections();
  if (await instances.findOne({ event_id: event.event_id })) {
    throw new WorkflowError(`Workflow already exists for event ${event.event_id}`, 409);
  }

  const template = await selectWorkflowTemplate(event);
  const missing = missingRequiredFields(template, event);
  if (missing.length > 0) {
    throw new WorkflowError(
      `Event ${event.event_id} is missing required fields: ${missing.join(", ")}`,
      422
    );
  }

  const submittedAt = new Date();
  const stages: WorkflowStage[] = template.stages.map(stage => {
    const skipped = (stage.skip_if_requester_role ?? []).includes(event.requester_role);
    return {
      stage_no: stage.stage_no,
      name: stage.name,
      approver_role: stage.approver_role,
      approver_rule: stage.approver_rule,
      sla_hours: stage.sla_hours,
      assigned_to_user_id: skipped ? null : resolveApprover(stage, approvers),
      status: skipped ? "SKIPPED" : "NOT_STARTED",
      due_by: null,
      stage_assigned_at: null,
      acted_by_user_id: null,
      acted_at: null,
      comment: null
    };
  });

  const first = stages.find(stage => stage.status === "NOT_STARTED");
  if (!first) {
    throw new WorkflowError(`Workflow for event ${event.event_id} has no actionable stage`, 422);
  }
  first.status = "PENDING";
  first.stage_assigned_at = submittedAt;
  first.due_by = new Date(submittedAt.getTime() + (first.sla_hours ?? 0) * HOUR_MS);

  const instance: WorkflowInstance = {
    event_id: event.event_id,
    template_code: template.template_code,
    template_version: template.version,
    status: "IN_PROGRESS",
    current_stage_no: first.stage_no,
    submitted_by_user_id: event.submitted_by_user_id,
    submitted_at: submittedAt,
    stages,
    updated_at: submittedAt
  };

  let insertedId: ObjectId;
  try {
    insertedId = (await instances.insertOne(instance)).insertedId;
  } catch (error) {
    // Unique index on event_id: another request created it first.
    if ((error as { code?: number }).code === 11000) {
      throw new WorkflowError(`Workflow already exists for event ${event.event_id}`, 409);
    }
    throw error;
  }

  await writeAudit({
    event_id: event.event_id,
    workflow_instance_id: insertedId,
    stage_no: null,
    action: "WORKFLOW_CREATED",
    acted_by_user_id: event.submitted_by_user_id,
    comment: null,
    previous_status: null,
    new_status: "IN_PROGRESS",
    stage_assigned_at: submittedAt
  });
  await createNotification(
    event.event_id,
    first.assigned_to_user_id,
    "APPROVAL_ASSIGNED",
    `Approval required for event ${event.event_id}: ${first.name}`
  );
  return { ...instance, _id: insertedId };
}

// ---------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------

export async function getWorkflowForEvent(eventId: number): Promise<WorkflowInstance | null> {
  const { instances } = await collections();
  return instances.findOne({ event_id: eventId });
}

export async function getAuditForEvent(eventId: number): Promise<WorkflowAudit[]> {
  const { audit } = await collections();
  return audit.find({ event_id: eventId }).sort({ created_at: 1 }).toArray();
}

export type PendingItem = { instance: WorkflowInstance; stage: WorkflowStage };

// The approver inbox: running workflows whose CURRENT stage is assigned
// to this user and still PENDING. Oldest submission first.
export async function getPendingForApprover(userId: number): Promise<PendingItem[]> {
  const { instances } = await collections();
  const found = await instances
    .find({
      status: "IN_PROGRESS",
      stages: { $elemMatch: { assigned_to_user_id: userId, status: "PENDING" } }
    })
    .sort({ submitted_at: 1 })
    .toArray();

  return found.flatMap(instance => {
    const stage = currentPendingStage(instance);
    return stage && stage.assigned_to_user_id === userId ? [{ instance, stage }] : [];
  });
}

export function currentPendingStage(instance: WorkflowInstance): WorkflowStage | undefined {
  return instance.stages.find(
    stage => stage.stage_no === instance.current_stage_no && stage.status === "PENDING"
  );
}

// ---------------------------------------------------------------------
// Approve / reject
// ---------------------------------------------------------------------

type StageAction = "APPROVE" | "REJECT";

// What the whole workflow becomes after this action:
//   IN_PROGRESS  another stage follows
//   APPROVED     the last stage was approved
//   REJECTED     any stage was rejected
export type WorkflowOutcome = "IN_PROGRESS" | "APPROVED" | "REJECTED";

export type StageActionOptions = {
  // Called after every check passed and before MongoDB is written.
  // The API uses it to write the final outcome to PostgreSQL inside a
  // still-open transaction: if it throws, MongoDB is not changed.
  beforeWrite?: (outcome: WorkflowOutcome) => Promise<void>;
};

async function actOnStage(
  eventId: number,
  actorId: number,
  action: StageAction,
  comment: string | null,
  options: StageActionOptions
): Promise<WorkflowInstance> {
  const { instances } = await collections();
  const instance = await instances.findOne({ event_id: eventId });
  if (!instance) {
    throw new WorkflowError(`Workflow for event ${eventId} does not exist`, 404);
  }
  if (instance.status !== "IN_PROGRESS") {
    throw new WorkflowError(`Workflow for event ${eventId} is already ${instance.status}`, 409);
  }

  const pendingStage = currentPendingStage(instance);
  if (!pendingStage || pendingStage.assigned_to_user_id !== actorId) {
    throw new WorkflowError(`User ${actorId} is not assigned to the current workflow stage`, 403);
  }

  const nextStatus: StageStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
  const now = new Date();
  // Stage n is stored at array index n - 1.
  const stagePath = `stages.${pendingStage.stage_no - 1}`;
  const update: Record<string, unknown> = {
    [`${stagePath}.status`]: nextStatus,
    [`${stagePath}.acted_by_user_id`]: actorId,
    [`${stagePath}.acted_at`]: now,
    [`${stagePath}.comment`]: comment || null,
    updated_at: now
  };

  let outcome: WorkflowOutcome;
  const nextStage = instance.stages.find(
    stage => stage.stage_no > pendingStage.stage_no && stage.status === "NOT_STARTED"
  );
  if (action === "REJECT") {
    outcome = "REJECTED";
    update.status = "REJECTED";
    update.current_stage_no = null;
  } else if (nextStage) {
    outcome = "IN_PROGRESS";
    const nextPath = `stages.${nextStage.stage_no - 1}`;
    update[`${nextPath}.status`] = "PENDING";
    update[`${nextPath}.due_by`] = new Date(now.getTime() + (nextStage.sla_hours ?? 0) * HOUR_MS);
    update[`${nextPath}.stage_assigned_at`] = now;
    update.current_stage_no = nextStage.stage_no;
  } else {
    outcome = "APPROVED";
    update.status = "APPROVED";
    update.current_stage_no = null;
  }

  if (options.beforeWrite) {
    await options.beforeWrite(outcome);
  }

  // The filter repeats the checks, so two approvers clicking at the same
  // time cannot both succeed (only one update matches).
  const updated = await instances.findOneAndUpdate(
    {
      _id: instance._id,
      status: "IN_PROGRESS",
      [`${stagePath}.status`]: "PENDING",
      [`${stagePath}.assigned_to_user_id`]: actorId
    },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!updated) {
    throw new WorkflowError("Workflow changed before this action could be saved", 409);
  }

  await writeAudit({
    event_id: eventId,
    workflow_instance_id: instance._id,
    stage_no: pendingStage.stage_no,
    // Explicit names: analytics.js matches STAGE_APPROVED / STAGE_REJECTED.
    // (`STAGE_${action}D` would give STAGE_REJECTD for a rejection.)
    action: action === "APPROVE" ? "STAGE_APPROVED" : "STAGE_REJECTED",
    acted_by_user_id: actorId,
    comment: comment || null,
    previous_status: "PENDING",
    new_status: nextStatus,
    stage_assigned_at: pendingStage.stage_assigned_at ?? null
  });

  if (outcome === "IN_PROGRESS" && nextStage) {
    await createNotification(eventId, nextStage.assigned_to_user_id, "APPROVAL_ASSIGNED",
      `Approval required for event ${eventId}: ${nextStage.name}`);
  } else if (outcome === "APPROVED") {
    await createNotification(eventId, instance.submitted_by_user_id, "WORKFLOW_COMPLETED",
      `All approvals are complete for event ${eventId}`);
  } else {
    await createNotification(eventId, instance.submitted_by_user_id, "WORKFLOW_REJECTED",
      `Workflow rejected at stage ${pendingStage.stage_no}: ${comment || "No reason provided"}`);
  }
  return updated;
}

export function approveWorkflowStage(
  eventId: number,
  actorId: number,
  comment?: string | null,
  options: StageActionOptions = {}
): Promise<WorkflowInstance> {
  return actOnStage(eventId, actorId, "APPROVE", comment ?? null, options);
}

export async function rejectWorkflowStage(
  eventId: number,
  actorId: number,
  comment: string,
  options: StageActionOptions = {}
): Promise<WorkflowInstance> {
  if (!comment || comment.trim() === "") {
    throw new WorkflowError("A rejection comment is required", 400);
  }
  return actOnStage(eventId, actorId, "REJECT", comment, options);
}

// ---------------------------------------------------------------------
// PostgreSQL workflow_context() row -> engine inputs
// ---------------------------------------------------------------------

export type WorkflowContextRow = {
  event_id: number;
  title: string;
  category: string;
  event_type: string;
  department_code: string | null;
  organizer_id: number;
  requester_role: string;
  coordinator_of_event_club: number | null;
  advisor_of_event_club: number | null;
  hod_of_event_department: number | null;
  any_faculty_of_event_department: number | null;
  any_admin: number | null;
};

// Column names of workflow_context() -> approver_rule names in the templates.
export function approversFromContext(context: WorkflowContextRow): Approvers {
  return {
    COORDINATOR_OF_EVENT_CLUB: context.coordinator_of_event_club,
    ADVISOR_OF_EVENT_CLUB: context.advisor_of_event_club,
    HOD_OF_EVENT_DEPARTMENT: context.hod_of_event_department,
    ANY_FACULTY_OF_EVENT_DEPARTMENT: context.any_faculty_of_event_department,
    ANY_ADMIN: context.any_admin
  };
}

export function eventFromContext(context: WorkflowContextRow, submittedBy: number): WorkflowEvent {
  return {
    event_id: context.event_id,
    category: context.category,
    event_type: context.event_type,
    department_code: context.department_code,
    requester_role: context.requester_role,
    submitted_by_user_id: submittedBy
  };
}
