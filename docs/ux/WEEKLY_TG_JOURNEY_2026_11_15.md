# Ma semaine → TG → installation

The owner accepted the interactive Marché solaire prototype at
https://fl-copilot-audit-ux-novembre-2026.safeyak15.chatgpt.site/semaine/.
Its fixed demonstration values and simulated declarations are not production
data. Native implementation reuses existing preparations, confirmed plans and
execution declarations.

## Approved presentation

- Full-width TG cards, with the short placement label as heading, proportional
  surface maps and complete product legends. Long instructions and reasoning
  are available on demand. A missing distribution is explicit, never invented.
- The week summary distinguishes a saved draft, a confirmed plan and installation
  declarations. The count uses canonical execution progress on matching TG tasks;
  no declaration is inherited from a different plan revision.
- A real Stack push opens a selected TG through the existing commercial-plan
  route and explicit week/placement context. Back restores the previous page;
  an isolated detail replaces itself with its week. Unknown targets remain
  unavailable, rather than selecting another TG. A draft link remains read-only
  even if that draft disappears while a confirmed plan has the same placement ID.
- A fixed action opens the existing declaration sheet. The initial installation
  confirmation is concise; optional actual dates, price/unit, location and note
  remain collapsed. No date, price or unit is inferred. Existing declaration
  statuses, actual end date, clear controls, conflicts and history stay available.
- Opening/closing a screen or panel does not save. Only explicit confirmation
  invokes the canonical local repository and Outbox. Source offers, original
  documents, physical allocation, non-TG tasks and prior plan versions remain
  reachable through secondary disclosures.

## Implementation boundaries

Reuse TgPresentationView and CommercialExecutionView. The existing compact
presentation remains available to chat/manual editing. The former unreferenced
installation-only rendering branch is replaced by the new selected-TG detail;
existing mode=installation and Journal task deep links remain supported.
The AppScreen footer slot fixes the action outside scrolling content without a
new navigation/animation framework. No database model, migration, sync contract,
AI instruction/tool/model or API deployment is added.

The accepted product/backdrop fixes from PR 526 are grouped into the next local
native release. M0–M8 pilot acceptance and the Atlas/PA/implantation/M9 reserves
remain unchanged.
