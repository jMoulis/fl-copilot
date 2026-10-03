# ADR 0003 — Private source-file storage

Date: 2026-10-03

Status: Accepted for implementation

## Context

The mobile application retains original Mercalys XLSX files and later ticket
images as immutable source evidence. Files must survive offline capture, upload
without passing their full contents through the Fastify process, and remain
unreadable without application authorization. The native client must never
contain a permanent storage credential.

The initial architecture named Google Cloud Storage. The project owner selected
Vercel storage before the remote upload flow was implemented.

## Decision

Use a private Vercel Blob store for original source files.

- The local file remains in application-owned storage until remote confirmation.
- Fastify authenticates the user, validates the store and source-document scope,
  and issues a short-lived client upload token.
- The native client uploads the file directly to Vercel Blob and then confirms
  the resulting pathname, checksum and metadata through the API.
- The Blob read-write credential remains server-side.
- MongoDB Atlas retains business metadata, authorization and source lineage; the
  Blob store contains the immutable binary.
- Downloads pass through an authenticated server route when a user must retrieve
  a private source.

## Consequences

- M2-T13 uses `@vercel/blob` server-side and validates its client-upload path on
  the target iPhone before accepting the native implementation.
- Offline retries remain idempotent by source-document ID and checksum.
- Blob pathnames must not be treated as authorization. Access remains scoped by
  the application and MongoDB records.
- Storage usage and retention must be monitored in Vercel; local cleanup still
  waits for confirmed remote durability.

## Primary references

- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Client uploads](https://vercel.com/docs/vercel-blob/client-upload)
- [Private storage](https://vercel.com/docs/vercel-blob/private-storage)
