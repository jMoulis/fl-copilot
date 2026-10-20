# Source-bound implantation illustration preparation — 20 October 2026

## Scope and architecture

M7 workstream 6 / T28: implement the deterministic input compiler and a disabled, isolated remote image adapter. This is an increment toward the complete illustration flow, not a delivered image-generation feature. There is no new agent, global Copilot instruction, model-selection change, route, provider activation, environment lookup, datastore, native module or paid test request.

The existing immutable private scenario card and its historical adopted physical revision are the inputs. The caller must load the persisted visible card and revision under current authorization; the compiler also checks store/owner/conversation scope, revision/version, target identity/label and the recomputed canonical geometry summary. It never substitutes a newer plan. Canonical source hashes bind the private card identity, full scenario (including sources/qualifications/assumptions), full physical revision and renderer version. These are derived outputs, not a new syncable entity; durable request/result contracts, migrations and serializers must precede their later persistence.

The source PNG is a deterministic numbered top view of the existing geometry report, including group outlines and actual furniture. Two islands of eight fixed elements and three TGs remain nineteen furniture objects; upper-shelf identities and optional mobile/host associations remain distinct in the structured input. Mobiles are dashed/transparent overlays, not extra full islands or a collision exemption. The complete original scenario, room/furniture/surface qualifications and stated limitations accompany the pixels. Products, reason text and labels are untrusted data.

Missing room dimensions or element X/Y/rotation/width/depth return targeted requirements and no PNG/provider request. Island-envelope drawing fallbacks never become source geometry. Known collisions block image generation. Unknown heights, loads, obstacles, passages and capacities are not invented, and a complete floor drawing is not a feasibility/compliance/execution certificate. The first adapter requests a top view, with numbered callouts for vertically overlapping surfaces; it does not pretend to reconstruct an exact 3D fixture.

## Provider boundary

The explicit adapter configuration requires both text/image model names and an existing supplied credential; disabled/unconfigured/cancelled/foreign/incomplete sources make no request. No default or fallback model is selected. The existing installed `ai`/`@ai-sdk/openai` Responses adapter sends actual canonical PNG bytes and bounded structured context to one forced image tool. Source JSON over 128 KiB is refused whole, never silently truncated. One requested low-quality 1536×1024 PNG, one tool call, one SDK step, no partial images, no parallel calls and `maxRetries: 0` bound this adapter; these are **not a monetary budget or an exactly-once billing guarantee**.

The pinned packages resolve different provider-utils schema symbols. Preserve the OpenAI factory's provider type/ID/args, while expressing the documented empty input and `{ result: string }` output schemas through the installed ai package. No type weakening, package update or alternate SDK is introduced. An intercepted real SDK request verifies the wire format. Use the current file/image content part rather than the deprecated image-content form.

The result must contain exactly one valid bounded base64 PNG of the requested dimensions, without multiple frames. Reject URLs, malformed/oversized data, a non-PNG, wrong dimensions or multiple/missing image results. Retain the original returned PNG bytes and hash separately from a metadata-stripped PNG, plus source pixels/hash, source binding, configured models, prompt version, response ID and token usage. None are written to chat text or logged. A failure after provider submission is exposed only as `LAYOUT_ILLUSTRATION_OUTCOME_UNKNOWN`, without provider body, source, image/base64 or exception cause. A future durable caller must not automatically repeat such an attempt.

## Evidence

- 24 focused cases exercise canonical nineteen-object rendering, pixel dimensions, surface identities, unknown geometry, private scope, wrong source/version/draft, target/summary tampering, known collision, deterministic source/frame hashes, retained historical inputs and input immutability.
- The installed SDK transport is intercepted locally: actual PNG pixels and precise scenario references are present; the forced single image tool, privacy/retry limits and model selection are verified. No real provider/AI network call or image generation occurs.
- Invalid output, 503/429/network/cancellation and input-size failures are tested with no automatic repeat or provider request where refused before submission. Synthetic returned PNGs are solid-color fixtures, not claimed AI images.
- A canonical nineteen-fixture PNG/SVG was rendered and visually inspected at 1536×1024. The two islands, their eight divisions and three TGs, numbered assignments and qualification footer are visible. Artifacts under the task directory are explicitly synthetic, not a measured pilot plan or production data.
- Full local checks pass with 2,824 tests / 594 skipped; 24 targeted cases also pass. Lint, all ten TypeScript projects, formatting and API bundle import pass; exact-head CI evidence is recorded with the PR. Native behavior is unchanged by this adapter-only increment; no extra EAS build is requested for it.

Official provider reference consulted: https://developers.openai.com/api/docs/guides/tools-image-generation . Implementation also follows the exact installed SDK source/docs. The requested physical constraints remain application facts; attractive generated pixels do not prove that the model obeyed them.

## Remaining complete T28 / V1 gates

Persist a deliberate local-first request with canonical Outbox/sync and immutable source binding; implement authorized private source/result retrieval and cross-device/offline cache restoration. Include deliberately selected original store-photo references with their checksums/provenance without replacing recorded measurements. Add durable per-attempt reservation/budget and conservative uncertain-outcome handling before exposing generation. Provide the native source/proposal comparison, retained historical image and changed-reference review. Decide activation/model/budget with the owner only after this complete flow is reviewable; use the already authorized existing key without exposing or changing it. Exercise one real constrained pilot and one unknown/impossible case after approved activation. A user-confirmed physical/commercial reference and an actual field execution remain separate actions.

This increment does not close workstream 6, any other workstream, L10/L11 or M8.
