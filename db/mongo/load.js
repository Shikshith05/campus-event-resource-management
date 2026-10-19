// Loads the sample approval-workflow documents into MongoDB and creates
// the indexes. Run from the repository root:
//
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/load.js
//
// WARNING: drops and reloads the workflow_templates and
// workflow_instances collections.

const fs = require('fs');
const path = require('path');

const dir = path.resolve('db', 'mongo');

// EJSON (not JSON) so that { "$date": ... } becomes a real Date.
function readDocs(file) {
  return EJSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

db.workflow_templates.drop();
db.workflow_instances.drop();

db.workflow_templates.insertMany(readDocs('workflow_templates.json'));
db.workflow_instances.insertMany(readDocs('workflow_instances.json'));

// Only one document per template code + version.
db.workflow_templates.createIndex({ template_code: 1, version: 1 }, { unique: true });
// event_id is the PostgreSQL event.event_id (the link between the two databases).
db.workflow_instances.createIndex({ event_id: 1 });
// Approver inbox: "stages assigned to me that are still pending".
db.workflow_instances.createIndex({ 'stages.assigned_to_user_id': 1, 'stages.status': 1 });

print(`workflow_templates: ${db.workflow_templates.countDocuments()} documents`);
print(`workflow_instances: ${db.workflow_instances.countDocuments()} documents`);
