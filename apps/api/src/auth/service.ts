import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Db } from "mongodb";
import type {
  AuthChallengeRequest,
  AuthChallengeResponse,
  AuthSessionResponse,
} from "@fl-copilot/sync-contracts";
import type { ApiConfig } from "../config.js";
import type { DatabaseService } from "../database/types.js";

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly publicCode: string,
    readonly messageFr: string,
    readonly retryable = false,
  ) {
    super(publicCode);
  }
}

export type AuthCodeSender = (input: {
  email: string;
  code: string;
  expiresAt: Date;
}) => Promise<void>;

export interface AuthService {
  requestChallenge(input: AuthChallengeRequest): Promise<AuthChallengeResponse>;
  verifyChallenge(
    challengeId: string,
    code: string,
  ): Promise<AuthSessionResponse>;
  refreshSession(
    deviceId: string,
    refreshToken: string,
  ): Promise<AuthSessionResponse>;
  logout(accessToken: string): Promise<void>;
}

type ChallengeDocument = {
  _id: string;
  email: string;
  deviceId: string;
  platform: "IOS" | "ANDROID";
  appVersion: string;
  codeHash: string;
  failedAttempts: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
};

type UserDocument = {
  _id: string;
  email: string;
  displayName: string;
  createdAt: Date;
};

type SessionDocument = {
  _id: string;
  userId: string;
  deviceId: string;
  refreshTokenHash: string;
  rotatedTokenHashes: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

type MembershipDocument = {
  userId: string;
  storeId: string;
  storeName: string;
  role: string;
  active: boolean;
};

type AccessClaims = {
  sub: string;
  sessionId: string;
  deviceId: string;
  exp: number;
};

export function createMongoAuthService(
  database: DatabaseService,
  config: ApiConfig,
  sendCode?: AuthCodeSender,
): AuthService {
  const sender = sendCode ?? createConfiguredCodeSender(config);

  return {
    async requestChallenge(input) {
      const db = await database.getDb();
      const now = new Date();
      const recent = await db
        .collection<ChallengeDocument>("authChallenges")
        .countDocuments({
          email: input.email,
          deviceId: input.deviceId,
          createdAt: { $gte: new Date(now.getTime() - 15 * 60_000) },
        });
      if (recent >= 5) {
        throw new AuthError(
          429,
          "AUTH_RATE_LIMITED",
          "Trop de codes ont été demandés. Réessayez dans quelques minutes.",
          true,
        );
      }

      const challengeId = randomUUID();
      const code =
        config.AUTH_DEVELOPMENT_CODE ??
        randomInt(0, 1_000_000).toString().padStart(6, "0");
      const expiresAt = new Date(
        now.getTime() + config.AUTH_CHALLENGE_TTL_SECONDS * 1000,
      );
      const document: ChallengeDocument = {
        _id: challengeId,
        email: input.email,
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        codeHash: hashCode(config.AUTH_CODE_PEPPER, challengeId, code),
        failedAttempts: 0,
        createdAt: now,
        expiresAt,
      };
      await db
        .collection<ChallengeDocument>("authChallenges")
        .insertOne(document);
      try {
        await sender({ email: input.email, code, expiresAt });
      } catch (error) {
        await db
          .collection<ChallengeDocument>("authChallenges")
          .deleteOne({ _id: challengeId });
        throw error;
      }
      return { challengeId, expiresAt: expiresAt.toISOString() };
    },

    async verifyChallenge(challengeId, code) {
      const db = await database.getDb();
      const now = new Date();
      const challenges = db.collection<ChallengeDocument>("authChallenges");
      const challenge = await challenges.findOne({ _id: challengeId });
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.failedAttempts >= 5 ||
        !safeEqual(
          challenge.codeHash,
          hashCode(config.AUTH_CODE_PEPPER, challengeId, code),
        )
      ) {
        if (challenge && !challenge.consumedAt && challenge.expiresAt > now) {
          await challenges.updateOne(
            { _id: challengeId },
            { $inc: { failedAttempts: 1 } },
          );
        }
        throw invalidCodeError();
      }
      const consumed = await challenges.updateOne(
        { _id: challengeId, consumedAt: { $exists: false } },
        { $set: { consumedAt: now } },
      );
      if (consumed.modifiedCount !== 1) throw invalidCodeError();

      const user = await getOrCreateUser(db, challenge.email, now);
      return issueSession(db, config, user, challenge.deviceId, now);
    },

    async refreshSession(deviceId, refreshToken) {
      const db = await database.getDb();
      const now = new Date();
      const tokenHash = hashToken(refreshToken);
      const sessions = db.collection<SessionDocument>("deviceSessions");
      const session = await sessions.findOne({
        deviceId,
        refreshTokenHash: tokenHash,
      });
      if (!session) {
        const reused = await sessions.findOne({
          deviceId,
          rotatedTokenHashes: tokenHash,
        });
        if (reused) {
          await sessions.updateOne(
            { _id: reused._id },
            { $set: { revokedAt: now, updatedAt: now } },
          );
        }
        throw sessionExpiredError();
      }
      if (session.revokedAt || session.expiresAt <= now)
        throw sessionExpiredError();
      const user = await db
        .collection<UserDocument>("users")
        .findOne({ _id: session.userId });
      if (!user) throw sessionExpiredError();
      return issueSession(db, config, user, deviceId, now, session);
    },

    async logout(accessToken) {
      const claims = verifyAccessToken(config.AUTH_TOKEN_SECRET, accessToken);
      const db = await database.getDb();
      await db.collection<SessionDocument>("deviceSessions").updateOne(
        {
          _id: claims.sessionId,
          deviceId: claims.deviceId,
          userId: claims.sub,
        },
        { $set: { revokedAt: new Date(), updatedAt: new Date() } },
      );
    },
  };
}

function createConfiguredCodeSender(config: ApiConfig): AuthCodeSender {
  if (config.AUTH_DEVELOPMENT_CODE && config.NODE_ENV !== "production") {
    return async () => undefined;
  }
  return async ({ email, code, expiresAt }) => {
    if (!config.AUTH_EMAIL_WEBHOOK_URL || !config.AUTH_EMAIL_WEBHOOK_TOKEN) {
      throw deliveryUnavailableError();
    }
    try {
      const response = await fetch(config.AUTH_EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.AUTH_EMAIL_WEBHOOK_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          code,
          expiresAt: expiresAt.toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw deliveryUnavailableError();
    } catch {
      throw deliveryUnavailableError();
    }
  };
}

function deliveryUnavailableError() {
  return new AuthError(
    503,
    "AUTH_DELIVERY_UNAVAILABLE",
    "L’envoi du code est momentanément indisponible.",
    true,
  );
}

async function getOrCreateUser(db: Db, email: string, now: Date) {
  const users = db.collection<UserDocument>("users");
  const existing = await users.findOne({ email });
  if (existing) return existing;
  const user: UserDocument = {
    _id: randomUUID(),
    email,
    displayName: email.split("@")[0] || "Utilisateur",
    createdAt: now,
  };
  try {
    await users.insertOne(user);
    return user;
  } catch (error) {
    const concurrent = await users.findOne({ email });
    if (concurrent) return concurrent;
    throw error;
  }
}

async function issueSession(
  db: Db,
  config: ApiConfig,
  user: UserDocument,
  deviceId: string,
  now: Date,
  current?: SessionDocument,
): Promise<AuthSessionResponse> {
  const sessions = db.collection<SessionDocument>("deviceSessions");
  const sessionId = current?._id ?? randomUUID();
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(
    now.getTime() + config.AUTH_REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  );
  const rotatedTokenHashes = current
    ? [...current.rotatedTokenHashes, current.refreshTokenHash].slice(-5)
    : [];
  await sessions.updateOne(
    { userId: user._id, deviceId },
    {
      $set: {
        refreshTokenHash,
        rotatedTokenHashes,
        updatedAt: now,
        expiresAt,
      },
      $setOnInsert: { _id: sessionId, createdAt: now },
      $unset: { revokedAt: "" },
    },
    { upsert: true },
  );
  const stored = await sessions.findOne({ userId: user._id, deviceId });
  if (!stored) throw new Error("Session could not be persisted");
  const accessTokenExpiresAt = new Date(
    now.getTime() + config.AUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  );
  const memberships = await db
    .collection<MembershipDocument>("storeMemberships")
    .find({ userId: user._id, active: true })
    .toArray();
  return {
    accessToken: signAccessToken(config.AUTH_TOKEN_SECRET, {
      sub: user._id,
      sessionId: stored._id,
      deviceId,
      exp: Math.floor(accessTokenExpiresAt.getTime() / 1000),
    }),
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    refreshToken,
    user: { id: user._id, email: user.email, displayName: user.displayName },
    stores: memberships.map((membership) => ({
      storeId: membership.storeId,
      name: membership.storeName,
      role: membership.role,
    })),
  };
}

function hashCode(pepper: string, challengeId: string, code: string) {
  return createHmac("sha256", pepper)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function signAccessToken(secret: string, claims: AccessClaims) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyAccessToken(secret: string, token: string): AccessClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw sessionExpiredError();
  const [header, payload, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (!safeEqual(signature, expected)) throw sessionExpiredError();
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AccessClaims;
    if (
      typeof claims.sub !== "string" ||
      typeof claims.sessionId !== "string" ||
      typeof claims.deviceId !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw sessionExpiredError();
    }
    return claims;
  } catch {
    throw sessionExpiredError();
  }
}

function invalidCodeError() {
  return new AuthError(
    401,
    "AUTH_CODE_INVALID",
    "Ce code est invalide ou a expiré.",
  );
}

function sessionExpiredError() {
  return new AuthError(
    401,
    "AUTH_SESSION_EXPIRED",
    "Votre session a expiré. Reconnectez-vous.",
  );
}
