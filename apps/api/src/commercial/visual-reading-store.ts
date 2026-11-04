import {
  synchronizedCommercialVisualReadingSchema,
  type SynchronizedCommercialVisualReading,
} from "@fl-copilot/sync-contracts";
export type VisualReadingDocument = Omit<
  SynchronizedCommercialVisualReading,
  "status" | "analysisRevision"
> & {
  analysisRevision?: number | null;
  _id: string;
  status: string;
  attemptCount?: number;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  nextAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
export function serializeVisualReading(row: VisualReadingDocument) {
  const reading = synchronizedCommercialVisualReadingSchema.parse(row);
  // A normalized absent revision is omitted, never sent as undefined in a JSON entity.
  if (reading.analysisRevision === undefined) delete reading.analysisRevision;
  return reading;
}
