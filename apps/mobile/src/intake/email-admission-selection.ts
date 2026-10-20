import { z } from "zod";
import { MAX_RECEIPT_VIEWS } from "@fl-copilot/domain";
import type { EmailIntakeReceipt } from "@fl-copilot/sync-contracts";
export type EmailFilePurpose = "AUTO" | "WASTE_TICKET" | "STORE_PHOTO";
/** Unsubmitted UI choices only; accepted decisions still live in SQLite/Outbox. */
export type EmailAdmissionSelection = {
  excluded: Set<string>;
  ids: Map<string, string>;
  purposes: Map<string, Exclude<EmailFilePurpose, "AUTO">>;
  tickets: Map<string, string>;
};
export function newEmailAdmissionSelection(): EmailAdmissionSelection {
  return {
    excluded: new Set(),
    ids: new Map(),
    purposes: new Map(),
    tickets: new Map(),
  };
}
export function selectedEmailFiles(
  receipt: EmailIntakeReceipt,
  draft: EmailAdmissionSelection,
) {
  return receipt.files.filter(
    (file) =>
      ["READY", "PENDING", "FAILED"].includes(file.status) &&
      !file.sourceDocumentId &&
      !draft.excluded.has(file.id),
  );
}
export function groupEmailTicketViews(
  receipt: EmailIntakeReceipt,
  draft: EmailAdmissionSelection,
  files: readonly string[],
  id: () => string,
) {
  const selected = new Set(
    selectedEmailFiles(receipt, draft).map((file) => file.id),
  );
  if (
    files.length < 2 ||
    files.length > MAX_RECEIPT_VIEWS ||
    new Set(files).size !== files.length ||
    files.some((file) => !selected.has(file))
  )
    throw Error("EMAIL_TICKET_GROUP_INVALID");
  const group = z.uuid().parse(id());
  for (const file of files) {
    draft.tickets.set(file, group);
    draft.purposes.set(file, "WASTE_TICKET");
  }
  return group;
}
export function setEmailFilePurpose(
  receipt: EmailIntakeReceipt,
  draft: EmailAdmissionSelection,
  fileId: string,
  purpose: EmailFilePurpose,
) {
  z.enum(["AUTO", "WASTE_TICKET", "STORE_PHOTO"]).parse(purpose);
  if (!selectedEmailFiles(receipt, draft).some((file) => file.id === fileId))
    throw Error("EMAIL_INTAKE_SELECTION_CHANGED");
  // Choosing another use is explicit and never reinterprets the other views.
  draft.tickets.delete(fileId);
  if (purpose === "AUTO") draft.purposes.delete(fileId);
  else draft.purposes.set(fileId, purpose);
}
export function separateEmailTickets(
  draft: EmailAdmissionSelection,
  group: string,
) {
  for (const [file, id] of draft.tickets)
    if (id === group) {
      draft.tickets.delete(file);
      draft.purposes.set(file, "WASTE_TICKET");
    }
}
export function emailAdmissionFiles(
  receipt: EmailIntakeReceipt,
  draft: EmailAdmissionSelection,
  id: () => string,
) {
  return selectedEmailFiles(receipt, draft).map((file) => {
    let separate = draft.ids.get(file.id);
    if (!separate) {
      separate = z.uuid().parse(id());
      draft.ids.set(file.id, separate);
    }
    const ticket = draft.tickets.get(file.id);
    return {
      fileId: file.id,
      processingId: ticket ?? separate,
      mode: ticket
        ? ("WASTE_TICKET" as const)
        : (draft.purposes.get(file.id) ?? ("AUTO" as const)),
    };
  });
}
