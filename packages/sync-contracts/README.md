# sync-contracts

Versioned offline-first synchronization contracts.

The package owns the Zod schemas shared by the mobile and API runtimes for
authentication, push, pull and bootstrap transport envelopes. Bootstrap domain
entities remain opaque JSON objects until their canonical schemas are added to
their owning domain packages.
