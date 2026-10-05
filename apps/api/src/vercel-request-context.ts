import { AsyncLocalStorage } from "node:async_hooks";

type VercelRequestContext = {
  oidcToken?: string;
};

const requestContext = new AsyncLocalStorage<VercelRequestContext>();

export function runWithVercelOidcToken<T>(
  oidcToken: string | undefined,
  callback: () => T,
): T {
  return requestContext.run({ oidcToken }, callback);
}

export function getVercelOidcToken(): string | undefined {
  return requestContext.getStore()?.oidcToken;
}
