import { MongoClient } from "mongodb";
import { Pool, type QueryResultRow } from "pg";

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

export async function mongoDatabase() {
  const client = mongoClient();
  await client.connect();
  return client.db();
}
