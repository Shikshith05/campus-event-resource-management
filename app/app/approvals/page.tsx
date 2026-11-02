import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import ApprovalInbox from "../components/ApprovalInbox";
import { getSessionUser } from "../../lib/auth";
import { APPROVAL_ROLES } from "../../lib/session";

export const metadata: Metadata = { title: "Approvals | CERMS" };

export default async function ApprovalsPage() {
  const user = await getSessionUser();
  const canDecide = user ? APPROVAL_ROLES.includes(user.role) : false;
  return <AppShell active="approvals">
    <div className="page-heading">
      <div><span className="eyebrow">Decision center</span><h1 className="page-title">Approval inbox</h1><p className="page-description">{canDecide ? "Review requests assigned to you. Only the approver assigned to the current stage can decide." : "This is a read-only inbox. Decisions are limited to the approver assigned to the current stage."}</p></div>
    </div>
    <ApprovalInbox canDecide={canDecide} />
  </AppShell>;
}
