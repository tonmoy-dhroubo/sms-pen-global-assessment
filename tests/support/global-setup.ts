import { prepareTestBucket } from "./test-storage";
import { dropAndRecreateSchema, migrateDeploy, testDatabaseUrl } from "./test-db";

// Runs once before the integration suite: a clean schema with the committed migrations applied, and an empty test
// bucket. Tests then truncate tables between themselves (see setup.ts); they never rebuild the schema.
export default async function setup() {
  const url = testDatabaseUrl();
  await dropAndRecreateSchema(url);
  migrateDeploy(url);
  await prepareTestBucket();
}
