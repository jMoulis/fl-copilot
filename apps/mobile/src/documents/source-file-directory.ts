/** Fixed app-owned folders only; follows iOS container relocation without accepting traversal. */
export function sourceFileDirectory(
  localUri: string,
  ordinaryDirectory: string,
) {
  const uuid = "[a-f0-9-]{36}";
  const email = new RegExp(
    `/email-originals/(${uuid}/${uuid}/${uuid}/${uuid})/original-[a-f0-9]{64}\\.bin$`,
  ).exec(localUri);
  if (email) return `email-originals/${email[1]}`;
  const recovered = new RegExp(
    `/source-originals/(${uuid}/${uuid}/${uuid})/(?:original|view)-[a-f0-9]{64}\\.(?:pdf|xlsx|jpg|png|heic|heif|json)$`,
  ).exec(localUri);
  if (recovered) return `source-originals/${recovered[1]}`;
  if (new RegExp(`/source-restorations/${uuid}\\.(pdf|xlsx)$`).test(localUri))
    return "source-restorations";
  if (new RegExp(`/mercalys-batches/${uuid}\\.xlsx$`).test(localUri))
    return "mercalys-batches";
  return ordinaryDirectory;
}
