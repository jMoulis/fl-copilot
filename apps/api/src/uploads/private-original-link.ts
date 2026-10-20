import { issueSignedToken, presignUrl } from "@vercel/blob";
import { getVercelOidcToken } from "../vercel-request-context.js";

/** Internal immutable object key only; never an input supplied by the caller. */
export async function signPrivateOriginal(
  pathname: string,
  validUntil: number,
) {
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
    oidcToken: getVercelOidcToken() ?? process.env.VERCEL_OIDC_TOKEN,
  });
  return (
    await presignUrl(token, {
      operation: "get",
      access: "private",
      pathname,
      validUntil,
      useCache: true,
    })
  ).presignedUrl;
}
