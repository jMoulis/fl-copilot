# Commercial planning week — 30 October 2026

The owner receives the next week's commercial PDF on Friday and commonly prepares that week on Sunday. Import time and the current clock must not silently select the planning period.

The existing document-header calendar projection now exposes its uniquely identified week. The native visual reading defaults to that document week and provides the existing date selector to choose another week. A source-bound explicit selection survives foreground/calendar refreshes; changing source drops the previous source's selection. Ambiguous headers remain explicit and the selector allows future weeks. This changes presentation, not extraction, stored source content, approval or offer applicability rules.

The existing TG confirmation card shows the ISO week number and year alongside its dates. The existing preparation tool description locally clarifies that its explicit Monday is the planning week requested in the conversation/document, including a future week, not today's week. No global prompt rule, tool, model, agent, schema, writer or paid extraction is added.

Mounted-component tests exercise Friday opening of a week-44 document, choosing week 45, Sunday foreground refresh, source replacement, uncertain header and future-week selection. Existing commercial week and controlled SDK tests remain applicable. These tests do not establish that every real model generation will select the right period: the long conversation's week-43 error still needs a real grouped-device acceptance exercise. Earlier truncated extractions are not rewritten, and no paid model test or extraction is triggered.

Code, CI, release and actual phone acceptance remain separate. No EAS build or production release is performed by this lot.

Local validation: `pnpm check` passed (4,500 tests, 729 skipped because transactional MongoDB tests were not enabled in this run); all ten strict TypeScript projects, formatting, API build/import and free iOS/Android exports passed. Exact-head transactional GitHub CI remains required before merge.
