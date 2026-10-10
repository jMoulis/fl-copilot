import {
  substitutionEvidenceSchema,
  substitutionEvidenceStateSchema,
  type SubstitutionEvidence,
} from "@fl-copilot/domain";
import type { EvidenceStateDocument } from "./substitution-evidence-work";
export type SubstitutionEvidenceDocument = SubstitutionEvidence & {
  _id: string;
};
export function serializeSubstitutionEvidence(
  row: SubstitutionEvidenceDocument,
) {
  const { _id, ...data } = row;
  void _id;
  return substitutionEvidenceSchema.parse(data);
}
export function serializeSubstitutionEvidenceState(row: EvidenceStateDocument) {
  const { _id, ...data } = row;
  void _id;
  return substitutionEvidenceStateSchema.parse(data);
}
