import type { Db } from "mongodb";

type MigrationRecord = {
  _id: number;
  name: string;
  appliedAt: Date;
};

export type MongoMigration = {
  version: number;
  name: string;
  up(database: Db): Promise<void>;
};

export const mongoMigrations: readonly MongoMigration[] = [
  {
    version: 1,
    name: "initialize-schema-migrations",
    async up(database) {
      await database
        .collection<MigrationRecord>("schemaMigrations")
        .createIndex({ name: 1 }, { unique: true });
    },
  },
  {
    version: 2,
    name: "initialize-authentication-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("users")
          .createIndex({ email: 1 }, { unique: true }),
        database
          .collection("authChallenges")
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection("authChallenges").createIndex({
          email: 1,
          deviceId: 1,
          createdAt: -1,
        }),
        database
          .collection("deviceSessions")
          .createIndex({ userId: 1, deviceId: 1 }, { unique: true }),
        database
          .collection("deviceSessions")
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database
          .collection("storeMemberships")
          .createIndex({ userId: 1, storeId: 1 }, { unique: true }),
      ]);
    },
  },
  {
    version: 3,
    name: "initialize-processed-command-indexes",
    async up(database) {
      await database
        .collection("processedCommands")
        .createIndex({ storeId: 1, processedAt: -1 });
    },
  },
  {
    version: 4,
    name: "initialize-sync-change-indexes",
    async up(database) {
      await database
        .collection("syncChanges")
        .createIndex({ storeId: 1, sequence: 1 }, { unique: true });
    },
  },
  {
    version: 5,
    name: "initialize-product-master-indexes",
    async up(database) {
      await Promise.all([
        database.collection("products").createIndex({ storeId: 1, status: 1 }),
        database.collection("productIdentifiers").createIndex(
          { storeId: 1, type: 1, value: 1 },
          {
            unique: true,
            partialFilterExpression: { deletedAt: null },
          },
        ),
        database
          .collection("productIdentifiers")
          .createIndex({ storeId: 1, productId: 1 }),
        database
          .collection("productAliases")
          .createIndex({ storeId: 1, normalizedAlias: 1 }),
        database
          .collection("productAliases")
          .createIndex({ storeId: 1, productId: 1 }),
      ]);
    },
  },
  {
    version: 6,
    name: "initialize-source-upload-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("sourceUploads")
          .createIndex({ storeId: 1, sourceDocumentId: 1 }, { unique: true }),
        database
          .collection("sourceUploads")
          .createIndex({ storeId: 1, objectKey: 1 }, { unique: true }),
        database
          .collection("sourceDocuments")
          .createIndex({ storeId: 1, checksum: 1 }),
      ]);
    },
  },
  {
    version: 7,
    name: "initialize-analytics-read-model-indexes",
    async up(database) {
      await Promise.all([
        database.collection("salesObservations").createIndex({
          storeId: 1,
          productId: 1,
          date: 1,
          validationStatus: 1,
        }),
        database.collection("wasteObservations").createIndex({
          storeId: 1,
          productId: 1,
          date: 1,
          validationStatus: 1,
        }),
        database
          .collection("productDailyPerformance")
          .createIndex({ storeId: 1, productId: 1, date: 1 }, { unique: true }),
        database
          .collection("departmentDailyPerformance")
          .createIndex({ storeId: 1, date: 1 }, { unique: true }),
      ]);
    },
  },
  {
    version: 8,
    name: "initialize-waste-receipt-extraction-indexes",
    async up(database) {
      await Promise.all([
        database.collection("wasteReceiptExtractions").createIndex(
          {
            storeId: 1,
            sourceDocumentId: 1,
            provider: 1,
            model: 1,
            schemaVersion: 1,
          },
          { unique: true },
        ),
        database.collection("sourceDocuments").createIndex({
          storeId: 1,
          sourceType: 1,
          extractionStatus: 1,
        }),
      ]);
    },
  },
  {
    version: 9,
    name: "initialize-waste-receipt-arithmetic-validation-indexes",
    async up(database) {
      await Promise.all([
        database.collection("wasteReceiptArithmeticValidations").createIndex(
          {
            storeId: 1,
            sourceDocumentId: 1,
            extractionId: 1,
            validatorVersion: 1,
            tolerance: 1,
          },
          { unique: true },
        ),
        database.collection("sourceDocuments").createIndex({
          storeId: 1,
          sourceType: 1,
          arithmeticValidationStatus: 1,
        }),
      ]);
    },
  },
  {
    version: 10,
    name: "initialize-waste-receipt-product-matching-indexes",
    async up(database) {
      await Promise.all([
        database.collection("wasteReceiptProductMatches").createIndex(
          {
            storeId: 1,
            sourceDocumentId: 1,
            extractionId: 1,
            engineVersion: 1,
            catalogFingerprint: 1,
          },
          { unique: true },
        ),
        database.collection("sourceDocuments").createIndex({
          storeId: 1,
          sourceType: 1,
          productMatchingStatus: 1,
        }),
      ]);
    },
  },
  {
    version: 11,
    name: "initialize-waste-receipt-publication-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("wasteReceiptPublications")
          .createIndex(
            { storeId: 1, "publication.source.id": 1 },
            { unique: true },
          ),
        database
          .collection("wasteReceipts")
          .createIndex({ storeId: 1, confirmedWasteDate: 1 }),
        database
          .collection("wasteLines")
          .createIndex(
            { storeId: 1, receiptId: 1, sourceLineIndex: 1 },
            { unique: true },
          ),
      ]);
    },
  },
  {
    version: 12,
    name: "initialize-commercial-document-job-indexes",
    async up(database) {
      await Promise.all([
        database
          .collection("commercialDocumentJobs")
          .createIndex(
            { storeId: 1, sourceDocumentId: 1, pipelineVersion: 1 },
            { unique: true },
          ),
        database
          .collection("commercialDocumentJobs")
          .createIndex({ status: 1, createdAt: 1 }),
      ]);
    },
  },
  {
    version: 13,
    name: "initialize-commercial-document-page-indexes",
    async up(database) {
      await database
        .collection("commercialDocumentPages")
        .createIndex(
          { storeId: 1, sourceDocumentId: 1, parserVersion: 1, pageNumber: 1 },
          { unique: true },
        );
    },
  },
  {
    version: 14,
    name: "initialize-commercial-ai-page-draft-indexes",
    async up(database) {
      await database.collection("commercialDocumentAiPages").createIndex(
        {
          storeId: 1,
          sourceDocumentId: 1,
          parserVersion: 1,
          schemaVersion: 1,
          model: 1,
          pageNumber: 1,
        },
        { unique: true },
      );
    },
  },
  {
    version: 15,
    name: "initialize-commercial-review-sync",
    async up(database) {
      await database
        .collection("commercialReviewPages")
        .createIndex(
          { storeId: 1, sourceDocumentId: 1, pageNumber: 1 },
          { unique: true },
        );
      await database
        .collection("commercialReviewDecisions")
        .createIndex(
          { storeId: 1, pageId: 1, sourceBlockIndex: 1 },
          { unique: true },
        );
    },
  },
  {
    version: 16,
    name: "initialize-commercial-visual-reading",
    async up(database) {
      await database.collection("commercialVisualReadings").createIndex(
        {
          storeId: 1,
          sourceDocumentId: 1,
          schemaVersion: 1,
          model: 1,
          pageNumber: 1,
        },
        { unique: true },
      );
      await database
        .collection("commercialVisualJobs")
        .createIndex(
          { storeId: 1, sourceDocumentId: 1, schemaVersion: 1 },
          { unique: true },
        );
    },
  },
  {
    version: 17,
    name: "commercial_offer_choices",
    async up(db) {
      await db.collection("commercialOfferChoices").createIndex(
        {
          storeId: 1,
          "source.readingId": 1,
          "source.operationIndex": 1,
          "source.itemIndex": 1,
        },
        { unique: true, name: "commercial_choice_source" },
      );
      await db.collection("commercialOfferChoices").createIndex(
        { storeId: 1, duplicateKey: 1 },
        {
          unique: true,
          partialFilterExpression: { status: "RETAINED" },
          name: "commercial_choice_active_duplicate",
        },
      );
      await db
        .collection("commercialChoiceHistory")
        .createIndex(
          { storeId: 1, choiceId: 1, version: 1 },
          { unique: true, name: "commercial_choice_history" },
        );
    },
  },
  {
    version: 18,
    name: "commercial_week_preparations",
    async up(db) {
      await db
        .collection("commercialWeekPreparations")
        .createIndex(
          { storeId: 1, weekStart: 1 },
          { unique: true, name: "commercial_preparation_week" },
        );
      await db
        .collection("commercialPreparationHistory")
        .createIndex(
          { storeId: 1, preparationId: 1, version: 1 },
          { unique: true, name: "commercial_preparation_history" },
        );
    },
  },
  {
    version: 19,
    name: "commercial_version_decisions",
    async up(db) {
      await db
        .collection("commercialVersionDecisions")
        .createIndex(
          { storeId: 1, id: 1 },
          { unique: true, name: "commercial_version_decision_identity" },
        );
      await db
        .collection("commercialVersionDecisionHistory")
        .createIndex(
          { storeId: 1, decisionId: 1, version: 1 },
          { unique: true, name: "commercial_version_decision_history" },
        );
    },
  },
  {
    version: 20,
    name: "commercial_validated_offers",
    async up(db) {
      await db
        .collection("commercialValidatedOffers")
        .createIndex(
          { storeId: 1, "choice.id": 1, "choice.version": 1 },
          { unique: true, name: "commercial_validated_offer_revision" },
        );
    },
  },
  {
    version: 21,
    name: "commercial_week_plans",
    async up(db) {
      await db
        .collection("commercialWeekPlans")
        .createIndex(
          { storeId: 1, weekStart: 1 },
          { unique: true, name: "commercial_plan_week" },
        );
      await db
        .collection("commercialPlanRevisions")
        .createIndex(
          { storeId: 1, "plan.id": 1, "plan.version": 1 },
          { unique: true, name: "commercial_plan_revision" },
        );
      await db
        .collection("commercialOperations")
        .createIndex(
          { storeId: 1, planId: 1 },
          { name: "commercial_operations_plan" },
        );
      await db
        .collection("offers")
        .createIndex(
          { storeId: 1, planId: 1 },
          { name: "commercial_offers_plan" },
        );
    },
  },
  {
    version: 22,
    name: "commercial_execution_tasks",
    async up(db) {
      await db.collection("commercialExecutionTasks").createIndex(
        {
          storeId: 1,
          planRevisionId: 1,
          planChecksum: 1,
          kind: 1,
          targetId: 1,
        },
        { unique: true, name: "commercial_execution_target" },
      );
      await db
        .collection("commercialExecutionHistory")
        .createIndex(
          { storeId: 1, taskId: 1, version: 1 },
          { unique: true, name: "commercial_execution_history" },
        );
    },
  },
];

export async function runMongoMigrations(
  database: Db,
  migrations: readonly MongoMigration[] = mongoMigrations,
): Promise<void> {
  const versions = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      throw new Error("MongoDB migration versions must be positive integers");
    }
    if (versions.has(migration.version)) {
      throw new Error(
        `MongoDB migration version ${migration.version} is declared more than once`,
      );
    }
    versions.add(migration.version);
  }

  const collection = database.collection<MigrationRecord>("schemaMigrations");
  const applied = await collection.find().sort({ _id: 1 }).toArray();
  const appliedByVersion = new Map(
    applied.map((record) => [record._id, record]),
  );

  for (const migration of [...migrations].sort(
    (left, right) => left.version - right.version,
  )) {
    const existing = appliedByVersion.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name) {
        throw new Error(
          `MongoDB migration ${migration.version} name does not match the recorded migration`,
        );
      }
      continue;
    }

    await migration.up(database);
    try {
      await collection.insertOne({
        _id: migration.version,
        name: migration.name,
        appliedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrent = await collection.findOne({ _id: migration.version });
      if (concurrent?.name !== migration.name) {
        throw new Error(
          `MongoDB migration ${migration.version} conflicted with another migration`,
        );
      }
    }
  }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
