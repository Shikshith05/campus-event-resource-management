// CERMS MongoDB workflow analytics.
//
// Run:
//   mongosh "mongodb://localhost:27017/cerms" db/mongo/analytics.js

print('Approval turnaround by stage:');
db.workflow_audit.aggregate([
  { $match: { action: { $in: ['STAGE_APPROVED', 'STAGE_REJECTED'] } } },
  { $group: {
      _id: '$stage_no',
      decisions: { $sum: 1 },
      average_decision_time_hours: {
        $avg: {
          $divide: [
            { $subtract: ['$created_at', '$stage_assigned_at'] },
            3600000
          ]
        }
      }
  } },
  { $sort: { _id: 1 } }
]).forEach(printjson);

print('Workflow outcomes:');
db.workflow_instances.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).forEach(printjson);

print('Unread notifications by type:');
db.workflow_notifications.aggregate([
  { $match: { status: 'UNREAD' } },
  { $group: { _id: '$type', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).forEach(printjson);
