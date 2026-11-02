import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromApp = createRequire(join(root, "app", "package.json"));
const read = path => readFileSync(join(root, path), "utf8");

const policyModule = { exports: {} };
const ts = fromApp("typescript");
const policyJs = ts.transpileModule(read("app/lib/workflow-policy.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
new Function("exports", "require", "module", policyJs)(
  policyModule.exports,
  fromApp,
  policyModule
);
const {
  REQUIRED_APPROVAL_ROLES,
  validateApprovalStageSequence,
  validateApproverAssignments,
  validateCurrentWorkflowActor,
  nextUnstartedWorkflowStage
} = policyModule.exports;

const venues = read("data/pes/venues.csv")
  .trim()
  .split(/\r?\n/)
  .map(line => line.split(","));
const venueRows = venues.slice(1).map(row => Object.fromEntries(
  venues[0].map((header, index) => [header, row[index]])
));

test("PES RR venue CSV preserves all ten supplied names, buildings, types, and ranges", () => {
  const seed = read("db/sql/seed.sql");
  assert.equal(venueRows.length, 10);
  assert.deepEqual(venueRows.map(row => [row.name, row.building]), [
    ["Opera House", "GJBC"],
    ["MRD Auditorium", "MRD"],
    ["GJBC 1A Audi", "GJBC"],
    ["GJBC 1B Auditorium", "GJBC"],
    ["GJBC 2A Auditorium", "GJBC"],
    ["GJBC 2B Auditorium", "GJBC"],
    ["PESU 52", "GJBC"],
    ["13th floor", "BE Block"],
    ["3rd floor seminar hall", "BE Block"],
    ["5th floor seminar hall", "BE Block"]
  ]);
  assert.ok(venueRows.every(row =>
    ["AUDITORIUM", "SEMINAR_HALL", "CLASSROOM", "LAB", "OPEN_AIR", "OTHER"].includes(row.venue_type)
  ));
  assert.deepEqual(venueRows.map(row => [Number(row.min_capacity), Number(row.max_capacity)]), [
    [1800, 2000], [250, 300], [150, 200], [150, 200], [150, 200],
    [150, 200], [150, 200], [100, 150], [100, 150], [100, 150]
  ]);
  assert.equal(venueRows[6].venue_type_confirmed, "false");
  assert.equal(venueRows[7].venue_type_confirmed, "false");
  assert.ok(venueRows.slice(0, 6).every(row => row.venue_type_confirmed === "true"));
  for (const row of venueRows) assert.ok(seed.includes(`'${row.name}'`), `${row.name} is seeded`);
  assert.match(seed, /capacity stays NULL/i);
});

test("venue schema and loader keep estimates separate and are non-destructive/idempotent by name", () => {
  const schema = read("db/sql/schema.sql");
  const loader = read("db/sql/load_pes_venues.sql");
  const booking = read("db/sql/booking_logic.sql");

  assert.match(schema, /capacity\s+INT CHECK \(capacity IS NULL OR capacity > 0\)/i);
  assert.match(schema, /min_capacity\s+INT/i);
  assert.match(schema, /max_capacity\s+INT/i);
  assert.match(loader, /ON CONFLICT \(name\) DO UPDATE/i);
  assert.match(loader, /capacity = COALESCE\(venue\.capacity, EXCLUDED\.capacity\)/i);
  assert.match(loader, /venue_type_confirmed = venue\.venue_type_confirmed OR EXCLUDED\.venue_type_confirmed/i);
  assert.doesNotMatch(loader, /\b(?:TRUNCATE|DELETE\s+FROM)\b/i);
  assert.match(booking, /venue_capacity IS NULL/i);
  assert.match(booking, /expected_footfall > booking_record\.venue_capacity/i);
});

test("all managed event templates require the same four approval roles", () => {
  const templates = JSON.parse(read("db/mongo/workflow_templates.json"));
  assert.equal(templates.length, 4);
  for (const template of templates) {
    assert.equal(validateApprovalStageSequence(template.stages), null, template.template_code);
    assert.deepEqual(template.stages.map(stage => stage.approver_role), REQUIRED_APPROVAL_ROLES);
    assert.equal(template.stages.some(stage => stage.skip_if_requester_role?.length), false);
  }

  const guest = templates.find(template => template.template_code === "GUEST_LECTURE");
  assert.deepEqual(guest.required_fields, ["guest_name", "guest_affiliation", "talk_topic"]);
  assert.ok(templates.some(template => template.template_code === "STANDARD_EVENT"));
  assert.match(read("app/app/api/events/submit/route.ts"), /"HACKATHON"/);
  assert.match(read("app/app/components/EventRequestForm.tsx"), /"HACKATHON"/);
  assert.match(read("db/sql/schema.sql"), /'HACKATHON'/);
});

test("workflow policy blocks missing, duplicate, and self approvers", () => {
  const stages = REQUIRED_APPROVAL_ROLES.map((approver_role, index) => ({
    stage_no: index + 1,
    name: approver_role,
    approver_role,
    assigned_to_user_id: index + 10
  }));
  assert.equal(validateApproverAssignments(stages, 1), null);
  assert.match(validateApproverAssignments(stages.map(stage => ({ ...stage, assigned_to_user_id: null })), 1), /No active assignment/);
  assert.match(validateApproverAssignments(stages.map(stage => ({ ...stage, assigned_to_user_id: 1 })), 1), /requester/);
  assert.match(validateApproverAssignments(stages.map((stage, index) => ({ ...stage, assigned_to_user_id: index === 2 ? 11 : stage.assigned_to_user_id })), 1), /same user/);

  const invalidOrder = stages.map(stage => ({ ...stage }));
  [invalidOrder[0].approver_role, invalidOrder[1].approver_role] = [
    invalidOrder[1].approver_role,
    invalidOrder[0].approver_role
  ];
  assert.match(validateApprovalStageSequence(invalidOrder), /required order/);
});

test("workflow actions accept only the current assignee and complete only after stage four", () => {
  const stages = REQUIRED_APPROVAL_ROLES.map((approver_role, index) => ({
    stage_no: index + 1,
    name: approver_role,
    approver_role,
    assigned_to_user_id: index + 10,
    status: index === 0 ? "PENDING" : "NOT_STARTED"
  }));
  const first = { status: "IN_PROGRESS", current_stage_no: 1, stages };
  assert.deepEqual(validateCurrentWorkflowActor(first, 10), { ok: true, stage_no: 1 });
  assert.equal(validateCurrentWorkflowActor(first, 11).status, 403);
  assert.equal(nextUnstartedWorkflowStage(stages, 1), 2);

  stages[0].status = "APPROVED";
  stages[1].status = "PENDING";
  first.current_stage_no = 2;
  assert.equal(validateCurrentWorkflowActor(first, 10).status, 403);
  assert.deepEqual(validateCurrentWorkflowActor(first, 11), { ok: true, stage_no: 2 });

  for (const stage of stages) stage.status = "APPROVED";
  first.status = "APPROVED";
  first.current_stage_no = null;
  assert.equal(nextUnstartedWorkflowStage(stages, 4), null);
  assert.equal(validateCurrentWorkflowActor(first, 13).status, 409);

  const mongoEngine = read("app/lib/workflow.ts");
  const sqlWorkflow = read("db/sql/workflow.sql");
  assert.match(mongoEngine, /findOneAndUpdate/);
  assert.match(mongoEngine, /action === "REJECT"/);
  assert.match(sqlWorkflow, /p_decision = 'APPROVED' AND p_stage_no <> 4/);
  assert.match(sqlWorkflow, /assert_workflow_stage_assignment\(p_event_id, p_stage_no\)/);
});

test("faculty approver scopes and private staff imports are enforced", () => {
  const workflowSql = read("db/sql/workflow.sql");
  const dataLoader = read("db/sql/load_pes_data.sql");
  const ignore = read(".gitignore");
  const proc = read("db/sql/procedures.sql");

  assert.match(workflowSql, /Club Coordinator assignments must use an active faculty or HOD account/i);
  assert.match(workflowSql, /c\.faculty_advisor_id = NEW\.user_id/i);
  assert.match(workflowSql, /v_department_id IS DISTINCT FROM NEW\.department_id/i);
  assert.match(dataLoader, /FROM 'data\/pes\/private\/users\.csv'/);
  assert.match(dataLoader, /FROM 'data\/pes\/private\/workflow_approvers\.csv'/);
  assert.match(ignore, /\/data\/pes\/private\//);
  assert.match(proc, /Guest lectures require guest name, affiliation, and talk topic/i);
  assert.match(proc, /INSERT INTO guest_lecture_details/i);
  assert.match(read("app/lib/session.ts"), /APPROVAL_ROLES[^\n]*\["FACULTY", "HOD", "WORKFLOW_APPROVER"\]/);
});

test("requester-facing responses do not expose approver account identities", () => {
  const submissionRoute = read("app/app/api/events/submit/route.ts");
  const timelineRoute = read("app/app/api/events/[eventId]/workflow/route.ts");
  const approvalRoute = read("app/app/api/approvals/[eventId]/route.ts");
  const appShell = read("app/app/components/AppShell.tsx");

  assert.doesNotMatch(submissionRoute, /assigned_to_user_id:\s*stage\.assigned_to_user_id/);
  assert.doesNotMatch(approvalRoute, /next_approver_user_id/);
  assert.doesNotMatch(timelineRoute, /assigned_to_user_id|acted_by_user_id|full_name/);
  assert.match(appShell, /user\.role === "WORKFLOW_APPROVER" \? "Assigned approver"/);
});

test("health reports an outdated PostgreSQL schema as not ready", () => {
  const healthRoute = read("app/app/api/health/route.ts");

  assert.match(healthRoute, /workflow_approver_assignment/);
  assert.match(healthRoute, /venue_type_confirmed/);
  assert.match(healthRoute, /record_workflow_decision/);
  assert.match(healthRoute, /schema_out_of_date/);
});

test("MongoDB example URI pins loopback to IPv4", () => {
  const envExample = read("app/.env.example");
  assert.match(envExample, /^MONGODB_URI=mongodb:\/\/127\.0\.0\.1:27017\/cerms$/m);
});

test("approval route checks event status through scoped approval details", () => {
  const approvalRoute = read("app/app/api/approvals/[eventId]/route.ts");
  assert.match(approvalRoute, /SELECT event_status FROM approval_details\(\$1::int\[\]\)/);
  assert.doesNotMatch(approvalRoute, /SELECT status FROM event WHERE event_id/);
});
