/** Operator-only CLI; never imported by the deployed API runtime. */
import { constants } from "node:fs";
import {
  open,
  readFile,
  mkdir,
  rename,
  lstat,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, resolve, join, basename, sep } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { ApiClient } from "../../../../packages/api-client/src/index";
import { z } from "zod";
import {
  pilotInputSchema,
  pilotRunSchema,
  pilotMobileReviewSchema,
  pilotSessionSchema,
  VisualPilotError,
  inspectPilot,
  createPilotRun,
  runPilotImport,
  pilotPushPacket,
  recordPilotMobileReview,
  type VisualPilotApi,
  type PilotSession,
} from "./visual-pilot-import";

async function privateJson(path: string) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    stat.size > 1024 * 1024
  )
    throw new VisualPilotError("PILOT_PRIVATE_FILE_REQUIRED");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.size !== stat.size
    )
      throw new VisualPilotError("PILOT_PRIVATE_FILE_REQUIRED");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}
async function atomicPrivateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.part`,
    file = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  const directory = await open(dirname(path), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function humanReview(message: string, digest: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new VisualPilotError("PILOT_INTERACTIVE_HUMAN_REQUIRED");
  process.stdout.write(
    message +
      "\nAucune approbation n’est déduite du manifeste. Après revue réelle, saisissez exactement :\n" +
      digest +
      "\n",
  );
  const tty = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await tty.question("Validation humaine : ")).trim();
  } finally {
    tty.close();
  }
}
function productionApi(session: PilotSession, storeId: string): VisualPilotApi {
  const api = new ApiClient("https://fl-copilot.vercel.app"),
    scope = { storeId, actorId: session.user.id, deviceId: session.deviceId };
  return {
    snapshot: () => api.visualLibrarySnapshot(session.accessToken, storeId),
    push: (commands) =>
      api.pushSync(session.accessToken, pilotPushPacket(scope, commands)),
    init: (assetId) =>
      api.initVisualFile(session.accessToken, storeId, assetId),
    complete: (assetId, uploadId) =>
      api.completeVisualFile(session.accessToken, storeId, assetId, uploadId),
    manifest: (assetId) =>
      api.visualFileManifest(session.accessToken, storeId, assetId),
    download: (manifest, variant) =>
      api.downloadVisualFile(session.accessToken, storeId, manifest, variant),
    async put(url, bytes, headers) {
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: Buffer.from(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok)
        throw new VisualPilotError("PILOT_BLOB_UPLOAD_UNCERTAIN");
    },
  };
}
export async function visualPilotCli(argv: string[]) {
  const [mode, inputName, ...rest] = argv;
  if (
    !["inspect", "import", "mobile-review"].includes(mode ?? "") ||
    !inputName
  )
    throw new VisualPilotError(
      "PILOT_USAGE: inspect|import|mobile-review manifest.json [--session file --store UUID --state directory --item visualKey --screenshot file]",
    );
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !["--session", "--store", "--state", "--item", "--screenshot"].includes(
        rest[i] ?? "",
      ) ||
      !rest[i + 1] ||
      flags.has(rest[i]!)
    )
      throw new VisualPilotError("PILOT_ARGUMENT_INVALID");
    flags.set(rest[i]!, rest[i + 1]!);
  }
  const inputPath = resolve(inputName),
    root = dirname(inputPath),
    input = pilotInputSchema.parse(
      JSON.parse(await readFile(inputPath, "utf8")),
    );
  if (mode === "inspect") {
    process.stdout.write(
      JSON.stringify(await inspectPilot(root, input), null, 2) + "\n",
    );
    return;
  }
  const sessionPath = flags.get("--session");
  if (!sessionPath || !flags.get("--store"))
    throw new VisualPilotError("PILOT_APPLICATION_SESSION_REQUIRED");
  const storeId = z.uuid().parse(flags.get("--store"));
  const session = pilotSessionSchema.parse(
    await privateJson(resolve(sessionPath)),
  );
  if (
    Date.parse(session.accessTokenExpiresAt) <= Date.now() ||
    !session.stores.some((s) => s.storeId === storeId && s.role === "MANAGER")
  )
    throw new VisualPilotError("PILOT_APPLICATION_SESSION_REQUIRED");
  const stateRoot = resolve(
    flags.get("--state") ??
      join(homedir(), ".local", "state", "fl-copilot", "visual-pilot"),
  );
  if (stateRoot === root || stateRoot.startsWith(root + sep))
    throw new VisualPilotError("PILOT_STATE_MUST_BE_OUTSIDE_UNTRUSTED_BUNDLE");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const stateStat = await lstat(stateRoot),
    canonicalState = await realpath(stateRoot),
    canonicalRoot = await realpath(root);
  if (
    stateStat.isSymbolicLink() ||
    !stateStat.isDirectory() ||
    (stateStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      stateStat.uid !== process.getuid()) ||
    canonicalState === canonicalRoot ||
    canonicalState.startsWith(canonicalRoot + sep)
  )
    throw new VisualPilotError("PILOT_PRIVATE_STATE_REQUIRED");
  const lockPath = join(stateRoot, "pilot.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
  } catch {
    throw new VisualPilotError("PILOT_STATE_LOCKED_REVIEW_REQUIRED");
  }
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        pilotId: input.pilotId,
        at: new Date().toISOString(),
      }),
    );
    await lock.sync();
    const scope = {
        storeId,
        actorId: session.user.id,
        deviceId: session.deviceId,
      },
      api = productionApi(session, storeId);
    const statePath = (name: string) =>
      join(stateRoot, `${input.pilotId}-${name}.json`);
    const maybe = async (path: string) => {
      try {
        return await privateJson(path);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      }
    };
    const firstRaw = await maybe(statePath("tomato_round")),
      firstRun = firstRaw ? pilotRunSchema.parse(firstRaw) : undefined;
    if (mode === "mobile-review") {
      if (!firstRun) throw new VisualPilotError("PILOT_FIRST_IMPORT_REQUIRED");
      const screenshot = flags.get("--screenshot");
      if (!screenshot)
        throw new VisualPilotError("PILOT_MOBILE_SCREENSHOT_REQUIRED");
      const evidencePath = resolve(screenshot);
      const review = await recordPilotMobileReview({
        api,
        run: firstRun,
        scope,
        screenshotRoot: dirname(evidencePath),
        screenshotFile: basename(evidencePath),
        confirm: (digest) =>
          humanReview(
            "Sur le vrai mobile : vérifiez le produit synchronisé et son image, puis sa consultation hors connexion. La capture doit provenir de cette recette réelle ; l’outil ne peut pas observer votre téléphone.",
            digest,
          ),
      });
      await atomicPrivateJson(statePath("mobile-review"), review);
      process.stdout.write(
        "Attestation humaine et empreinte de la capture consignées. Aucune vérification automatique du téléphone n’est revendiquée.\n",
      );
      return;
    }
    const visualKey = z
      .enum(["tomato_round", "banana_cavendish", "avocado_hass"])
      .parse(flags.get("--item") ?? "tomato_round");
    const mobileRaw = await maybe(statePath("mobile-review")),
      mobileReview = mobileRaw
        ? pilotMobileReviewSchema.parse(mobileRaw)
        : undefined;
    const old = await maybe(statePath(visualKey));
    const run = old
      ? pilotRunSchema.parse(old)
      : await createPilotRun({
          root,
          input,
          visualKey,
          scope,
          api,
          firstRun,
          mobileReview,
          review: async (draft) =>
            humanReview(
              JSON.stringify(draft, null, 2) +
                "\nOuvrez et examinez ce PNG individuel, son alpha, le rapprochement exact et les justificatifs de provenance. L’aperçu actuel sera un JPEG sur fond blanc. Cette validation approuve l’image et l’association pour ce magasin.",
              draft.digest,
            ),
        });
    const result = await runPilotImport({
      root,
      input,
      scope,
      api,
      run,
      firstRun,
      mobileReview,
      persist: (r) => atomicPrivateJson(statePath(visualKey), r),
    });
    process.stdout.write(
      JSON.stringify(
        {
          status: result.phase,
          visualKey: result.visualKey,
          productId: result.productId,
          assetId: result.asset.id,
          contentHash: result.fileHash,
          manifest: result.manifest,
          mobileVerified: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  visualPilotCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      (error instanceof VisualPilotError
        ? error.code
        : "PILOT_STOPPED_REVIEW_REQUIRED") + "\n",
    );
    process.exitCode = 1;
  });
}
