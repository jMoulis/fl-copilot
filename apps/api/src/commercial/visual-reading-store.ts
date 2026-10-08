import {
  synchronizedCommercialVisualReadingSchema,
  type SynchronizedCommercialVisualReading,
} from "@fl-copilot/sync-contracts";
export type VisualReadingDocument = Omit<
  SynchronizedCommercialVisualReading,
  "status"
> & {
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
  return synchronizedCommercialVisualReadingSchema.parse(row);
}
