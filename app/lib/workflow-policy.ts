export const REQUIRED_APPROVAL_ROLES = [
  "CLUB_COORDINATOR",
  "HOD",
  "DEAN_OF_STUDENT_AFFAIRS",
  "VICE_CHANCELLOR"
] as const;

type ApprovalStage = {
  stage_no: number;
  name: string;
  approver_role: string;
  assigned_to_user_id?: number | null;
  status?: string;
  skip_if_requester_role?: string[];
};

type WorkflowActionState = {
  status: string;
  current_stage_no: number | null;
  stages: readonly ApprovalStage[];
};

export type WorkflowActionCheck =
  | { ok: true; stage_no: number }
  | { ok: false; status: 403 | 409; message: string };

export function validateCurrentWorkflowActor(
  instance: WorkflowActionState,
  actorId: number
): WorkflowActionCheck {
  if (instance.status !== "IN_PROGRESS") {
    return {
      ok: false,
      status: 409,
      message: `Workflow is already ${instance.status}`
    };
  }

  const currentStage = instance.stages.find(stage =>
    stage.stage_no === instance.current_stage_no && stage.status === "PENDING"
  );
  if (!currentStage) {
    return { ok: false, status: 409, message: "Workflow has no pending current stage" };
  }
  if (currentStage.assigned_to_user_id !== actorId) {
    return { ok: false, status: 403, message: "User is not assigned to the current workflow stage" };
  }
  return { ok: true, stage_no: currentStage.stage_no };
}

export function nextUnstartedWorkflowStage(
  stages: readonly ApprovalStage[],
  currentStageNo: number
): number | null {
  return stages
    .filter(stage => stage.stage_no > currentStageNo && stage.status === "NOT_STARTED")
    .sort((left, right) => left.stage_no - right.stage_no)[0]?.stage_no ?? null;
}

export function validateApprovalStageSequence(stages: readonly ApprovalStage[]): string | null {
  if (stages.length !== REQUIRED_APPROVAL_ROLES.length) {
    return `exactly ${REQUIRED_APPROVAL_ROLES.length} approval stages are required`;
  }

  for (const [index, stage] of stages.entries()) {
    const requiredRole = REQUIRED_APPROVAL_ROLES[index];
    if (stage.stage_no !== index + 1 || stage.approver_role !== requiredRole) {
      return `stage ${index + 1} must be ${requiredRole} in the required order`;
    }
    if (stage.skip_if_requester_role?.length) {
      return `stage ${index + 1} cannot be skipped based on the requester role`;
    }
  }

  return null;
}

export function validateApproverAssignments(
  stages: readonly ApprovalStage[],
  requesterId: number
): string | null {
  const seen = new Map<number, ApprovalStage>();

  for (const stage of stages) {
    const assignedId = stage.assigned_to_user_id;
    if (assignedId == null) {
      return `No active assignment exists for ${stage.name} (${stage.approver_role}); configure an approver assignment before submitting this event`;
    }
    if (assignedId === requesterId) {
      return `The requester is assigned to ${stage.name}; assign another approver before submitting this event`;
    }
    const prior = seen.get(assignedId);
    if (prior) {
      return `${prior.name} and ${stage.name} resolve to the same user; assign distinct approvers before submitting this event`;
    }
    seen.set(assignedId, stage);
  }

  return null;
}
