const APPROVER_LABELS: Record<string, string> = {
  CLUB_COORDINATOR: "Club Coordinator",
  HOD: "HOD",
  DEAN_OF_STUDENT_AFFAIRS: "Dean of Student Affairs",
  VICE_CHANCELLOR: "Vice Chancellor"
};

export function approverLabel(role: string): string {
  return APPROVER_LABELS[role] ?? role.replaceAll("_", " ");
}
