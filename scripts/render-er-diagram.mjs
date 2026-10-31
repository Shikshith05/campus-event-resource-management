// Renders the ER diagram images in docs/ from the Mermaid block in
// docs/er-diagram.md (the single source of truth).
//
//   node scripts/render-er-diagram.mjs
//
// Needs @mermaid-js/mermaid-cli (mmdc). It is not a project dependency;
// npx downloads it into its own cache, so nothing is added to the repo:
//   npx -y @mermaid-js/mermaid-cli@11 --version
//
// Output (PNG for documents, SVG for zooming):
//   docs/er-diagram.png / .svg           all 15 tables (best on screen)
//   docs/er-diagram-core.png / .svg      people, clubs, venues, resources
//   docs/er-diagram-booking.png / .svg   events, bookings and audit tables
// The two halves are readable at A4 width. The booking half repeats the
// core tables it references as small key-only boxes, so every
// relationship line has both ends.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const markdown = readFileSync(join(root, "docs", "er-diagram.md"), "utf8");
const block = markdown.match(/```mermaid\n([\s\S]*?)```/)?.[1];
if (!block) throw new Error("No ```mermaid block found in docs/er-diagram.md");

// Split the block into entity definitions and relationship lines.
const entities = new Map();                         // name -> full "NAME { ... }" text
for (const match of block.matchAll(/^ {4}([A-Z_]+) \{\n([\s\S]*?)^ {4}\}/gm)) {
  entities.set(match[1], { text: match[0], body: match[2] });
}
const relations = block.split("\n")
  .filter(line => /^\s+[A-Z_]+\s+\S+--\S+\s+[A-Z_]+\s+:/.test(line))
  .map(line => {
    const [, left, right] = line.match(/^\s+([A-Z_]+)\s+\S+\s+([A-Z_]+)/);
    return { line, left, right };
  });

const CORE = ["DEPARTMENT", "ROLE", "APP_USER", "CLUB", "CLUB_MEMBER",
              "WORKFLOW_APPROVER_ASSIGNMENT", "VENUE", "RESOURCE"];
const BOOKING = ["EVENT", "EVENT_VENUE_PREFERENCE", "GUEST_LECTURE_DETAILS", "BOOKING",
                 "BOOKING_RESOURCE", "BOOKING_CONFLICT_LOG", "BOOKING_STATUS_HISTORY"];
const missing = [...entities.keys()].filter(name => !CORE.includes(name) && !BOOKING.includes(name));
if (missing.length || entities.size !== CORE.length + BOOKING.length) {
  throw new Error(`Update CORE/BOOKING in this script; unassigned tables: ${missing.join(", ")}`);
}

// A key-only copy of a table: its primary-key rows plus a note.
function stub(name) {
  const keys = entities.get(name).body.split("\n").filter(row => /\bPK\b/.test(row));
  return `    ${withoutComments(`${name} {\n${keys.join("\n")}`)}\n        string see_core_diagram\n    }`;
}

// The A4 halves leave out the "comment" column (e.g. the list of allowed
// values): it makes the boxes about a third wider. Types, names and
// PK/FK/UK markers stay; the full diagram keeps the comments.
const withoutComments = text => text.replace(/ "[^"]*"$/gm, "");

function diagram(tables, withStubs) {
  const included = new Set(tables);
  const lines = relations.filter(r => included.has(r.left) || included.has(r.right));
  const stubs = withStubs
    ? [...new Set(lines.flatMap(r => [r.left, r.right]))].filter(name => !included.has(name))
    : [];
  return [
    "erDiagram",
    ...tables.map(name => withoutComments(entities.get(name).text)),
    ...stubs.map(stub),
    ...lines.filter(r => withStubs || (included.has(r.left) && included.has(r.right))).map(r => r.line)
  ].join("\n") + "\n";
}

// The A4 halves use a larger font and tighter spacing: boxes grow with the
// text but the gaps between them do not, so the text is larger in print.
const A4_CONFIG = {
  themeVariables: { fontSize: "20px" },
  er: { nodeSpacing: 40, rankSpacing: 60, entityPadding: 10 }
};

const outputs = [
  { name: "er-diagram", source: block.startsWith("erDiagram") ? block : `erDiagram\n${block}`, width: 2400, config: {} },
  { name: "er-diagram-core", source: diagram(CORE, false), width: 1800, config: A4_CONFIG },
  { name: "er-diagram-booking", source: diagram(BOOKING, true), width: 1800, config: A4_CONFIG }
];

const work = mkdtempSync(join(tmpdir(), "cerms-er-"));
try {
  for (const output of outputs) {
    const input = join(work, `${output.name}.mmd`);
    const config = join(work, `${output.name}.json`);
    writeFileSync(input, output.source);
    writeFileSync(config, JSON.stringify(output.config));
    for (const extension of ["svg", "png"]) {
      const target = join(root, "docs", `${output.name}.${extension}`);
      execFileSync("npx", ["-y", "@mermaid-js/mermaid-cli@11", "-i", input, "-o", target, "-c", config,
        "-b", "white", "-w", String(output.width), ...(extension === "png" ? ["-s", "2"] : [])],
        { stdio: "inherit", shell: process.platform === "win32" });
    }
    const tables = (output.source.match(/^ {4}[A-Z_]+ \{/gm) ?? []).length;
    console.log(`${output.name}: ${tables} table boxes`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
