import { randomUUID } from "node:crypto";
import { parseEnvironment } from "../config.js";
import { createMongoDatabase } from "../database/mongo.js";

const config = parseEnvironment(process.env);
if (config.NODE_ENV === "production") {
  throw new Error("Development store bootstrap is disabled in production.");
}

const database = createMongoDatabase(config);
try {
  const mongo = await database.getDb();
  const requestedEmail =
    process.env.DEVELOPMENT_USER_EMAIL?.trim().toLowerCase();
  const users = await mongo
    .collection<{ _id: string; email: string }>("users")
    .find(requestedEmail ? { email: requestedEmail } : {})
    .project<{ _id: string; email: string }>({ _id: 1, email: 1 })
    .limit(2)
    .toArray();

  if (users.length === 0) {
    throw new Error("No matching development user exists. Sign in once first.");
  }
  if (users.length > 1) {
    throw new Error(
      "Several development users exist. Set DEVELOPMENT_USER_EMAIL before retrying.",
    );
  }

  const user = users[0];
  const memberships = mongo.collection<{
    userId: string;
    storeId: string;
    storeName: string;
    role: string;
    active: boolean;
  }>("storeMemberships");
  const existing = await memberships.findOne({
    userId: user._id,
    active: true,
  });
  if (existing) {
    console.log(`Development store already available: ${existing.storeName}`);
  } else {
    const storeName =
      process.env.DEVELOPMENT_STORE_NAME?.trim() || "Magasin pilote";
    await memberships.insertOne({
      userId: user._id,
      storeId: randomUUID(),
      storeName,
      role: "MANAGER",
      active: true,
    });
    console.log(`Development store created: ${storeName}`);
  }
} finally {
  await database.close();
}
