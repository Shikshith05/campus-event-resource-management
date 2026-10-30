import type { Metadata } from "next";
import AppShell from "../components/AppShell";
import ApprovalInbox from "../components/ApprovalInbox";

export const metadata: Metadata = { title: "Approvals | CERMS" };

export default function ApprovalsPage() {
  return <AppShell active="approvals">
    <div className="page-heading">
      <div><span className="eyebrow">Decision center</span><h1 className="page-title">Approval inbox</h1><p className="page-description">Review the event details, leave a comment, and record your decision.</p></div>
    </div>
    <ApprovalInbox />
  </AppShell>;
}
