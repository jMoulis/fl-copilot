import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  emailIntakeDecisionSchema,
  type EmailIntakeReceipt,
} from "@fl-copilot/sync-contracts";
import {
  newEmailAdmissionSelection,
  selectedEmailFiles,
  groupEmailTicketViews,
  setEmailFilePurpose,
  separateEmailTickets,
  emailAdmissionFiles,
} from "./email-admission-selection";
function receipt(count = 6): EmailIntakeReceipt {
  const time = "2026-10-20T12:00:00Z";
  return {
    id: randomUUID(),
    storeId: randomUUID(),
    ownerId: randomUUID(),
    conversationId: randomUUID(),
    bindingId: randomUUID(),
    providerEmailId: randomUUID(),
    sender: "qa@example.test",
    subject: "Do not interpret this as user permission",
    receivedAt: time,
    updatedAt: time,
    version: 2,
    status: "AWAITING_CONFIRMATION",
    files: Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      providerAttachmentId: randomUUID(),
      filename: `photo-${i}.jpg`,
      mediaType: "image/jpeg",
      status: "READY",
      sourceDocumentId: null,
    })),
  };
}
function decision(
  r: EmailIntakeReceipt,
  files: ReturnType<typeof emailAdmissionFiles>,
) {
  return emailIntakeDecisionSchema.parse({
    id: r.id,
    receiptId: r.id,
    actionId: randomUUID(),
    storeId: r.storeId,
    ownerId: r.ownerId,
    conversationId: r.conversationId,
    version: 1,
    policyVersion: 1,
    receiptVersion: r.version,
    choice: "ADMIT",
    createdAt: r.receivedAt,
    updatedAt: r.receivedAt,
    files: files.map((file) => ({
      ...file,
      checksum: null,
      manifestHash: null,
    })),
  });
}
it("keeps all fifty files independent and AUTO regardless of image-like names/MIME until a human chooses", () => {
  const r = receipt(50),
    draft = newEmailAdmissionSelection(),
    first = emailAdmissionFiles(r, draft, randomUUID),
    again = emailAdmissionFiles(r, draft, () => {
      throw Error("UNEXPECTED_ID_REPLACEMENT");
    });
  expect(again).toEqual(first);
  expect(first).toHaveLength(50);
  expect(new Set(first.map((file) => file.processingId)).size).toBe(50);
  expect(first.every((file) => file.mode === "AUTO")).toBe(true);
  expect(decision(r, first).files).toHaveLength(50);
});
it("accepts several explicit ticket groups and a store photo in receipt order, independent of tap order", () => {
  const r = receipt(),
    draft = newEmailAdmissionSelection(),
    [a, b, c, d, e, f] = r.files;
  const first = groupEmailTicketViews(
      r,
      draft,
      [c!.id, a!.id, b!.id],
      randomUUID,
    ),
    second = groupEmailTicketViews(r, draft, [e!.id, d!.id], randomUUID);
  setEmailFilePurpose(r, draft, f!.id, "STORE_PHOTO");
  const files = emailAdmissionFiles(r, draft, randomUUID);
  expect(files.map((file) => file.fileId)).toEqual(
    r.files.map((file) => file.id),
  );
  expect(
    files
      .slice(0, 3)
      .every(
        (file) => file.processingId === first && file.mode === "WASTE_TICKET",
      ),
  ).toBe(true);
  expect(
    files
      .slice(3, 5)
      .every(
        (file) => file.processingId === second && file.mode === "WASTE_TICKET",
      ),
  ).toBe(true);
  expect(first).not.toBe(second);
  expect(files[5]).toMatchObject({ fileId: f!.id, mode: "STORE_PHOTO" });
  expect(decision(r, files).files).toHaveLength(6);
});
it.each(["TOO_MANY", "DUPLICATE", "EXCLUDED", "FOREIGN", "ONE"])(
  "refuses %s group members without changing any other choice",
  (kind) => {
    const r = receipt(6),
      draft = newEmailAdmissionSelection();
    const ids = r.files.map((file) => file.id);
    if (kind === "EXCLUDED") draft.excluded.add(ids[0]!);
    const selected =
      kind === "TOO_MANY"
        ? ids
        : kind === "DUPLICATE"
          ? [ids[0]!, ids[0]!]
          : kind === "FOREIGN"
            ? [ids[0]!, randomUUID()]
            : kind === "ONE"
              ? [ids[0]!]
              : ids.slice(0, 2);
    expect(() =>
      groupEmailTicketViews(r, draft, selected, () => {
        throw Error("SHOULD_NOT_ALLOCATE_ID");
      }),
    ).toThrow("EMAIL_TICKET_GROUP_INVALID");
    expect(draft.tickets.size).toBe(0);
    expect(draft.purposes.size).toBe(0);
  },
);
it("separates a ticket only on explicit choice and retains the independent identities across retries", () => {
  const r = receipt(),
    draft = newEmailAdmissionSelection(),
    original = emailAdmissionFiles(r, draft, randomUUID);
  const group = groupEmailTicketViews(
    r,
    draft,
    r.files.slice(0, 3).map((file) => file.id),
    randomUUID,
  );
  separateEmailTickets(draft, group);
  const files = emailAdmissionFiles(r, draft, randomUUID);
  expect(files.slice(0, 3).map((file) => file.processingId)).toEqual(
    original.slice(0, 3).map((file) => file.processingId),
  );
  expect(files.slice(0, 3).every((file) => file.mode === "WASTE_TICKET")).toBe(
    true,
  );
  expect(files.slice(3)).toEqual(original.slice(3));
  expect(decision(r, files).files).toHaveLength(6);
});
it("changing one view to a store photo leaves the other ticket views untouched", () => {
  const r = receipt(),
    draft = newEmailAdmissionSelection(),
    ids = r.files.slice(0, 3).map((file) => file.id);
  const group = groupEmailTicketViews(r, draft, ids, randomUUID);
  setEmailFilePurpose(r, draft, ids[1]!, "STORE_PHOTO");
  const files = emailAdmissionFiles(r, draft, randomUUID);
  expect(files[0]).toMatchObject({ processingId: group, mode: "WASTE_TICKET" });
  expect(files[2]).toMatchObject({ processingId: group, mode: "WASTE_TICKET" });
  expect(files[1]).toMatchObject({ mode: "STORE_PHOTO" });
  expect(files[1]?.processingId).not.toBe(group);
  expect(decision(r, files).files).toHaveLength(6);
});
it("never adds unsupported/already-applied/unselected files back to a group or confirmation", () => {
  const r = receipt(),
    draft = newEmailAdmissionSelection();
  r.files[0]!.status = "UNSUPPORTED";
  r.files[1]!.status = "APPLIED";
  r.files[1]!.sourceDocumentId = randomUUID();
  draft.excluded.add(r.files[2]!.id);
  expect(selectedEmailFiles(r, draft).map((file) => file.id)).toEqual(
    r.files.slice(3).map((file) => file.id),
  );
  expect(() =>
    groupEmailTicketViews(
      r,
      draft,
      [r.files[0]!.id, r.files[3]!.id],
      randomUUID,
    ),
  ).toThrow("EMAIL_TICKET_GROUP_INVALID");
  expect(
    emailAdmissionFiles(r, draft, randomUUID).map((file) => file.fileId),
  ).toEqual(r.files.slice(3).map((file) => file.id));
});
