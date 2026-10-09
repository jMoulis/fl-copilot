# Product Copilot skill contract — Directed substitutions

Status: M6-T03 deterministic preparation/persistence implemented. Conversational registration is M7; regular product UI is M6-T04. This is an application skill contract, not a Codex development skill.

Given authenticated store products, customer needs and prior relationships, prepare specific ordered replacement candidates. A → B means B is a candidate when the customer initially wanted A. Never mirror the relation automatically, treat complementary products as replacements, or assume that shared membership proves substitutability.

`substitutionBatchToolRequestSchema` accepts 1–100 ordered source/substitute/need tuples with explicit need/usage compatibility and nullable price/packaging compatibility. It does not accept human confirmation, version overrides, origin or learned metrics. `prepareProductSubstitutionBatch` receives trusted parent/existing snapshots, actor, decision, consent, revision bases, clock and digest separately. AI can only propose; human/manual/rejected decisions are preserved. No missing compatibility is converted to zero and no observed evidence is fabricated.

The future authenticated executor must bind explicit human approval to the displayed candidate IDs and versions, prepare the selected batch using USER authority, persist through `ProductSubstitutionRepository.saveBatch` and the normal Outbox. A proposal is not an execution. Rejecting preserves history; reactivation requires a new explicit user decision. Learned metrics remain authoritative remote data and cannot be overwritten by this tool.

The final journey is file upload and Copilot discussion, with a concise proposal summary and only meaningful ambiguities requiring attention. Product screens provide optional inspection/correction. Report proposed, validated, rejected, pending sync and observed evidence separately. Explain missing prices/units/evidence without inventing conversion, margin, stock or uplift.
