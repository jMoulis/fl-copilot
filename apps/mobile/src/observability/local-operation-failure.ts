/** Stable diagnostics only: never persist a native message, SQL, path or source payload. */
export function localOperationFailureCode(reason: unknown): string | undefined {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && reason && !seen.has(reason); depth++) {
    seen.add(reason);
    if (typeof reason !== "object") break;
    const error = reason as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      cause?: unknown;
    };
    const message = typeof error.message === "string" ? error.message : "";
    const numeric =
      typeof error.code === "number"
        ? error.code & 255
        : Number(
            /SQLiteErrorException:\s*Error code (\d+):/i.exec(message)?.[1],
          );
    if (
      [5, 6].includes(numeric) ||
      /^SQLITE_(BUSY|LOCKED)/.test(String(error.code)) ||
      /\b(?:database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED)\b/i.test(
        message,
      )
    )
      return "LOCAL_DATABASE_BUSY";
    if (
      numeric === 13 ||
      error.code === "SQLITE_FULL" ||
      /\bdatabase or disk is full\b/i.test(message)
    )
      return "LOCAL_DATABASE_FULL";
    if (
      [11, 26].includes(numeric) ||
      ["SQLITE_CORRUPT", "SQLITE_NOTADB"].includes(String(error.code)) ||
      /\b(?:database disk image is malformed|file is not a database)\b/i.test(
        message,
      )
    )
      return "LOCAL_DATABASE_CORRUPT";
    if (numeric === 10 || /^SQLITE_IOERR/.test(String(error.code)))
      return "LOCAL_DATABASE_IO";
    if (
      error.code === "ENOENT" ||
      /\b(?:file does not exist|no such file|cannot read file at)\b/i.test(
        message,
      )
    )
      return "LOCAL_FILE_MISSING";
    if (error.name === "ZodError" || error.name === "SyntaxError")
      return "LOCAL_DATA_INVALID";
    reason = error.cause;
  }
  return undefined;
}

export function localOperationFailureMessage(code?: string) {
  switch (code) {
    case "LOCAL_DATABASE_BUSY":
      return "La base locale est occupée. Attendez la fin de l’opération en cours, puis réessayez ce fichier. Les publications précédentes sont conservées.";
    case "LOCAL_DATABASE_FULL":
      return "L’espace de stockage disponible est insuffisant. Libérez de l’espace sans supprimer l’application, puis réessayez.";
    case "LOCAL_DATABASE_CORRUPT":
      return "La base locale signale une erreur d’intégrité. Ne supprimez pas l’application ; les données doivent être examinées avant une reprise.";
    case "LOCAL_DATABASE_IO":
      return "Le stockage local n’a pas répondu. Réessayez sans supprimer l’application.";
    case "LOCAL_FILE_MISSING":
      return "L’original conservé ne peut pas être retrouvé. Sélectionnez à nouveau le fichier source ; les publications précédentes restent conservées.";
    case "LOCAL_DATA_INVALID":
      return "Les données du fichier ne peuvent pas être publiées dans leur état actuel. Les publications précédentes sont conservées. Ouvrez ce fichier pour le vérifier.";
    default:
      return undefined;
  }
}
