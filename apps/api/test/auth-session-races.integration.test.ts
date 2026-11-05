import { randomUUID } from "node:crypto";
import type { CollectionOptions, Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "../src/config";
import { createMongoDatabase } from "../src/database/mongo";
import type { DatabaseService } from "../src/database/types";
import { createMongoAuthService } from "../src/auth/service";

const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri || process.env.TEST_MONGODB_TRANSACTIONS !== "true")(
  "session revocation and concurrent renewal on disposable Mongo",
  () => {
    let database: DatabaseService, db: Db;
    const config = parseEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: uri,
      MONGODB_DATABASE: "fl_m8_auth_" + randomUUID().replaceAll("-", ""),
      AUTH_DEVELOPMENT_CODE: "123456",
    });
    beforeAll(async () => {
      database = createMongoDatabase(config);
      db = await database.getDb();
    });
    afterAll(async () => {
      try {
        await db?.dropDatabase();
      } finally {
        await database?.close();
      }
    });
    async function fixture() {
      const auth = createMongoAuthService(database, config, async () => {}),
        deviceId = randomUUID(),
        email = randomUUID() + "@example.test",
        storeId = randomUUID();
      const login = async (targetDeviceId = deviceId) => {
        const challenge = await auth.requestChallenge({
          email,
          deviceId: targetDeviceId,
          platform: "IOS",
          appVersion: "test",
        });
        return auth.verifyChallenge(challenge.challengeId, "123456");
      };
      const first = await login();
      await db.collection("storeMemberships").insertOne({
        userId: first.user.id,
        storeId,
        storeName: "Isolated auth test",
        role: "MANAGER",
        active: true,
      });
      return { auth, deviceId, storeId, first, login };
    }
    /** Gate after the real read, before the service can persist a renewal. */
    function pauseUserReads(count = 1) {
      const users = db.collection("users"),
        originalCollection = db.collection.bind(db),
        originalRead = users.findOne.bind(users);
      let release!: () => void,
        reached!: () => void,
        remaining = count;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        ready = new Promise<void>((resolve) => {
          reached = resolve;
        });
      const collection = vi
        .spyOn(db, "collection")
        .mockImplementation(((name: string, options?: CollectionOptions) =>
          name === "users"
            ? users
            : originalCollection(name, options)) as typeof db.collection);
      const read = vi
        .spyOn(users, "findOne")
        .mockImplementation(async (filter, options) => {
          const result = await originalRead(filter, options);
          if (remaining > 0) {
            if (--remaining === 0) reached();
            await gate;
          }
          return result;
        });
      return {
        ready,
        release,
        restore: () => {
          release();
          read.mockRestore();
          collection.mockRestore();
        },
      };
    }
    it("does not resurrect a session when logout wins against an already-started renewal", async () => {
      const f = await fixture(),
        pause = pauseUserReads();
      const pending = f.auth
        .refreshSession(f.deviceId, f.first.refreshToken)
        .then(
          (value) => ({ value, error: undefined }),
          (error) => ({ value: undefined, error }),
        );
      try {
        await pause.ready;
        await f.auth.logout(f.first.accessToken);
        pause.release();
        expect((await pending).error).toMatchObject({
          publicCode: "AUTH_SESSION_EXPIRED",
        });
        await expect(
          f.auth.authorizeStore(f.first.accessToken, f.storeId, f.deviceId),
        ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
        expect(
          await db
            .collection("deviceSessions")
            .findOne({ userId: f.first.user.id }),
        ).toHaveProperty("revokedAt");
      } finally {
        pause.restore();
        await pending;
      }
    });
    it("never reauthorizes old access tokens after a fresh login and ignores their late logout", async () => {
      const f = await fixture();
      await f.auth.logout(f.first.accessToken);
      const second = await f.login();
      await expect(
        f.auth.authorizeStore(f.first.accessToken, f.storeId, f.deviceId),
      ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
      await f.auth.logout(f.first.accessToken);
      await expect(
        f.auth.authorizeStore(second.accessToken, f.storeId, f.deviceId),
      ).resolves.toMatchObject({ userId: f.first.user.id });
      expect(
        await db.collection("deviceSessions").countDocuments({
          userId: f.first.user.id,
          deviceId: f.deviceId,
        }),
      ).toBe(1);
    });
    it("does not overwrite a newer login when an older renewal resumes late", async () => {
      const f = await fixture(),
        pause = pauseUserReads();
      const pending = f.auth
        .refreshSession(f.deviceId, f.first.refreshToken)
        .then(
          (value) => ({ value, error: undefined }),
          (error) => ({ value: undefined, error }),
        );
      try {
        await pause.ready;
        const second = await f.login();
        pause.release();
        expect((await pending).error).toMatchObject({
          publicCode: "AUTH_SESSION_EXPIRED",
        });
        await expect(
          f.auth.authorizeStore(second.accessToken, f.storeId, f.deviceId),
        ).resolves.toMatchObject({ userId: f.first.user.id });
        await expect(
          f.auth.refreshSession(f.deviceId, second.refreshToken),
        ).resolves.toMatchObject({ user: { id: f.first.user.id } });
      } finally {
        pause.restore();
        await pending;
      }
    });
    it("rotates once when two renewals have already read the same credential", async () => {
      const f = await fixture(),
        pause = pauseUserReads(2);
      const pending = Promise.allSettled([
        f.auth.refreshSession(f.deviceId, f.first.refreshToken),
        f.auth.refreshSession(f.deviceId, f.first.refreshToken),
      ]);
      try {
        await pause.ready;
        pause.release();
        const results = await pending;
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
        const winner = results.find((result) => result.status === "fulfilled");
        if (winner?.status !== "fulfilled") throw Error("No renewal winner");
        await expect(
          f.auth.refreshSession(f.deviceId, winner.value.refreshToken),
        ).resolves.toMatchObject({ user: { id: f.first.user.id } });
      } finally {
        pause.restore();
        await pending;
      }
    });
    it("keeps one current identity when verified logins complete concurrently", async () => {
      const f = await fixture();
      const attempts = await Promise.allSettled([f.login(), f.login()]);
      const sessions = attempts.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      expect(sessions.length).toBeGreaterThan(0);
      const authorized = await Promise.allSettled(
        sessions.map((session) =>
          f.auth.authorizeStore(session.accessToken, f.storeId, f.deviceId),
        ),
      );
      expect(
        authorized.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        await db.collection("deviceSessions").countDocuments({
          userId: f.first.user.id,
          deviceId: f.deviceId,
        }),
      ).toBe(1);
      await expect(
        f.auth.authorizeStore(f.first.accessToken, f.storeId, f.deviceId),
      ).rejects.toMatchObject({ publicCode: "AUTH_SESSION_EXPIRED" });
    });
    it("rolls back replacement if the fresh session cannot be inserted", async () => {
      const f = await fixture(),
        sessions = db.collection("deviceSessions"),
        originalCollection = db.collection.bind(db);
      const collection = vi
        .spyOn(db, "collection")
        .mockImplementation(((name: string, options?: CollectionOptions) =>
          name === "deviceSessions"
            ? sessions
            : originalCollection(name, options)) as typeof db.collection);
      const insert = vi
        .spyOn(sessions, "insertOne")
        .mockRejectedValue(Error("CONTROLLED_SESSION_WRITE_FAILURE"));
      try {
        await expect(f.login()).rejects.toThrow(
          "CONTROLLED_SESSION_WRITE_FAILURE",
        );
        await expect(
          f.auth.authorizeStore(f.first.accessToken, f.storeId, f.deviceId),
        ).resolves.toMatchObject({ userId: f.first.user.id });
      } finally {
        insert.mockRestore();
        collection.mockRestore();
      }
    });
    it("keeps another device connected, binds tokens to their device and rechecks live store membership", async () => {
      const f = await fixture(),
        otherDevice = randomUUID(),
        other = await f.login(otherDevice);
      await expect(
        f.auth.authorizeStore(other.accessToken, f.storeId, f.deviceId),
      ).rejects.toMatchObject({ publicCode: "AUTH_DEVICE_MISMATCH" });
      await f.auth.logout(f.first.accessToken);
      await expect(
        f.auth.authorizeStore(other.accessToken, f.storeId, otherDevice),
      ).resolves.toMatchObject({ userId: f.first.user.id });
      await expect(
        f.auth.authorizeStore(other.accessToken, randomUUID(), otherDevice),
      ).rejects.toMatchObject({ publicCode: "STORE_ACCESS_DENIED" });
      await db.collection("storeMemberships").updateOne(
        {
          userId: f.first.user.id,
          storeId: f.storeId,
        },
        { $set: { active: false } },
      );
      await expect(
        f.auth.authorizeStore(other.accessToken, f.storeId, otherDevice),
      ).rejects.toMatchObject({ publicCode: "STORE_ACCESS_DENIED" });
    });
  },
);
