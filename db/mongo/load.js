// Upserts approval workflow templates into MongoDB and creates indexes.
// Run from the repository root:
//
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js

const fs = require('fs');
const path = require('path');

const dir = path.resolve('db', 'mongo');

// EJSON (not JSON) so that { "$date": ... } becomes a real Date.
function readDocs(file) {
  return EJSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

const templates = readDocs('workflow_templates.json');
const managedCodes = templates.map(template => template.template_code);

// Retire prior versions only for the templates maintained by this loader.
// Running this does not delete running workflows, their audit, or notices.
db.workflow_templates.updateMany(
  { template_code: { $in: managedCodes }, is_active: true },
  { $set: { is_active: false } }
);
templates.forEach(template => db.workflow_templates.replaceOne(
  { template_code: template.template_code, version: template.version },
  template,
  { upsert: true }
));

// Only one document per template code + version.
db.workflow_templates.createIndex({ template_code: 1, version: 1 }, { unique: true });
// event_id is the PostgreSQL event.event_id (the link between the two databases).
db.workflow_instances.createIndex({ event_id: 1 }, { unique: true });
// Approver inbox: "stages assigned to me that are still pending".
db.workflow_instances.createIndex({ 'stages.assigned_to_user_id': 1, 'stages.status': 1 });
db.workflow_audit.createIndex({ event_id: 1, created_at: -1 });
db.workflow_notifications.createIndex({
  recipient_user_id: 1,
  status: 1,
  created_at: -1
});

print(`workflow_templates: ${db.workflow_templates.countDocuments()} documents`);
print(`workflow_instances preserved: ${db.workflow_instances.countDocuments()} documents`);
print(`workflow_audit: ${db.workflow_audit.countDocuments()} documents`);
print(`workflow_notifications: ${db.workflow_notifications.countDocuments()} documents`);
