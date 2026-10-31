import { MongoClient } from "mongodb";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { AppRole, SessionUser } from "./session";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

const globalForDb = globalThis as unknown as {
  postgresPool?: Pool;
  mongoClient?: MongoClient;
};

function postgresPool(): Pool {
  if (!globalForDb.postgresPool) {
    globalForDb.postgresPool = new Pool({
      connectionString: requiredEnvironment("DATABASE_URL")
    });
  }
  return globalForDb.postgresPool;
}

function mongoClient(): MongoClient {
  if (!globalForDb.mongoClient) {
    globalForDb.mongoClient = new MongoClient(
      requiredEnvironment("MONGODB_URI"),
      {
        connectTimeoutMS: 3000,
        serverSelectionTimeoutMS: 3000
      }
    );
  }
  return globalForDb.mongoClient;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await postgresPool().query<T>(text, values);
  return result.rows;
}

// App role -> PostgreSQL group role (db/sql/rbac.sql). A role name cannot
// be a query parameter, so only these fixed strings are ever placed into
// SET LOCAL ROLE.
const DATABASE_ROLE: Record<AppRole, string> = {
  STUDENT: "cerms_student",
  CLUB_COORDINATOR: "cerms_student",
  FACULTY: "cerms_faculty",
  HOD: "cerms_faculty",
  WORKFLOW_APPROVER: "cerms_workflow_approver",
  ADMIN: "cerms_admin"
};

// Run queries as the logged-in user, so the database enforces RBAC and
// row-level security (not just the UI):
//   BEGIN;
//   SET LOCAL ROLE cerms_student;                -- the user's group
//   SET LOCAL app.current_user_id = '<id>';      -- read by the RLS policies
//   ...work...
//   COMMIT;                                      -- both settings end here
// "LOCAL" settings end with the transaction, so the pooled connection is
// returned clean and the next request cannot inherit this user's identity.
export async function withUserTransaction<T>(
  user: SessionUser,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const databaseRole = DATABASE_ROLE[user.role];
  if (!databaseRole) {
    throw new Error(`No database role for application role ${user.role}`);
  }

  const client = await postgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${databaseRole}`);
    // set_config(name, value, true) is SET LOCAL with a bound parameter.
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [
      String(user.userId)
    ]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// One query as the logged-in user (see withUserTransaction).
export async function queryAsUser<T extends QueryResultRow>(
  user: SessionUser,
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  return withUserTransaction(user, async client => {
    const result = await client.query<T>(text, values);
    return result.rows;
  });
}

export async function mongoDatabase() {
  const client = mongoClient();
  await client.connect();
  return client.db();
}
