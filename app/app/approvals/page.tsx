import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import ApprovalInbox from "../components/ApprovalInbox";
import { getSessionUser } from "../../lib/auth";
import { APPROVAL_ROLES } from "../../lib/session";

export const metadata: Metadata = { title: "Approvals | CERMS" };

export default async function ApprovalsPage() {
  const user = await getSessionUser();
  const canDecide = user ? APPROVAL_ROLES.includes(user.role) : false;
  const description = user?.role === "CLUB_COORDINATOR"
    ? "Track pending requests for clubs you coordinate. Decisions are made by the assigned faculty approver."
    : canDecide
      ? "Review requests assigned to you. Only the approver assigned to the current stage can decide."
      : "This is a read-only inbox. Decisions are limited to the approver assigned to the current stage.";
  return <AppShell active="approvals">
    <div className="page-heading">
      <div><span className="eyebrow">Decision center</span><h1 className="page-title">Approval inbox</h1><p className="page-description">{description}</p></div>
    </div>
    <ApprovalInbox canDecide={canDecide} viewerRole={user?.role ?? null} />
  </AppShell>;
}
