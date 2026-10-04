# ADR 0005 — OpenAI Vision for waste receipt extraction

## Status

Accepted on 2026-10-04.

## Context

M4 requires structured extraction from normalized waste-receipt images. The result is an untrusted draft that must retain uncertainty and pass schema, arithmetic, product-matching and human-validation stages before publication.

The pilot already has a server-side API and private Vercel Blob storage. Receipt images must never be sent from the mobile application directly to an AI provider, and a model response must never become domain state without application validation.

## Decision

Use the OpenAI Responses API behind a provider-neutral receipt Vision adapter. Vercel deployments route the request to OpenAI through Vercel AI Gateway with the Function's automatically injected OIDC token; local development calls OpenAI directly with a dedicated project key.

- Send only the normalized extraction JPEG; keep the immutable original in private Vercel Blob storage.
- Do not send product catalogs, user identity, authentication data or unrelated store data.
- Use `store: false` and no conversation, file-upload, background-processing or remote-tool state.
- Require strict Structured Outputs and validate the returned object again with the same local Zod schema before MongoDB persistence.
- Treat all image text as untrusted document data. It cannot override the extraction instructions or schema.
- Preserve nullable unreadable values and per-field confidence. Do not infer facts outside the image.
- Persist provider, requested and resolved model, schema/prompt version, response ID and extraction timestamp.
- Keep the model configurable through `WASTE_RECEIPT_VISION_MODEL`; the pilot default is `gpt-5.6-luna`.
- Keep all credentials server-side. Production uses short-lived `VERCEL_OIDC_TOKEN`; local development uses `OPENAI_API_KEY`, and `AI_GATEWAY_API_KEY` remains an optional non-Vercel fallback.

The OpenAI API does not use API inputs and outputs for model training by default. With the project’s current standard data controls, request content may still be retained in abuse-monitoring logs for up to 30 days. `store: false` avoids Responses application-state storage but is not equivalent to approved Zero Data Retention. AI Gateway logs request metadata and usage but does not log prompt or completion content by default. The pilot has not enabled OpenAI EU data residency or Zero Data Retention.

## Consequences

- A normalized receipt image leaves the Vercel environment for processing by OpenAI after the user-authorized upload workflow.
- Provider failures and schema-invalid responses remain retryable processing failures; they do not create extraction evidence.
- Valid extraction evidence remains a draft with `TO_VALIDATE` status. Later M4 tasks perform arithmetic validation, product matching and explicit human approval.
- A production privacy review must decide whether the pilot needs a DPA, EU data residency, Modified Abuse Monitoring or Zero Data Retention before broader rollout.
- Replacing the provider does not change the stored extraction contract or downstream validation stages.

## References

- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Vercel AI Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok)
- [Vercel AI Gateway SDKs and APIs](https://vercel.com/docs/ai-gateway/sdks-and-apis)
