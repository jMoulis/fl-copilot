# M0-T01 Status — Create monorepo

## Delivered

- root monorepo scaffold;
- `apps/mobile`;
- `apps/api`;
- required shared packages;
- pnpm workspace declaration;
- Turborepo task graph configuration;
- strict base TypeScript configuration;
- canonical specs copied under `docs/specs`;
- repository-level `AGENTS.md`;
- structural verification script.

## Deliberately not implemented in M0-T01

- Expo runtime initialization (`M0-T02`);
- native design system (`M0-T03`);
- Fastify runtime (`M0-T04`);
- MongoDB connection (`M0-T05`);
- SQLite/Drizzle schema (`M0-T06`);
- device identity (`M0-T07`);
- authentication (`M0-T08`);
- EAS environments (`M0-T09`);
- observability runtime (`M0-T10`).

## Validation

The scaffold was checked for:

- required directories;
- canonical specification presence;
- native/offline-first terminology;
- absence of superseded client architecture terminology.

The next implementation ticket is:

```text
M0-T02 — Initialize Expo application
```
