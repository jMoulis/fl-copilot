# M7 — réalisation commerciale déclarée (PR 256)

Code acceptance uses shared schemas, actual SQLite transactions and disposable transactional MongoDB. No paid model requests or EAS builds. Real iPhone/model-dialogue acceptance awaits grouped API-before-native delivery.

## Automated evidence

- Real dates are nullable Paris business dates, with end after start and no future declaration. Missing price/unit must be paired; zero remains known; decimal strings have at most two places. Unit/location are never inferred from an offer.
- Chat declaration writes task, actuals, history, operation result and Outbox atomically. A failed transaction/invalid future date leaves no partial task/command. Restart retains actual details and the unsent command. Replay is idempotent; omitted updates/subfields preserve details and explicit null removes the selected field or all actuals while retaining history.
- Mongo push/replay, bootstrap, pull and conflict responses project the original task shape for legacy clients. Canonical history always retains full details. An older-client status update preserves new details even when reopening a task. Competing details require the existing version conflict/review; explicit removal is a new revision, and replay of an old command cannot restore the old canonical head.
- API-client negotiation appends arguments; native bootstrap adoption is separate from prior execution adoption. SDK parameters expose actuals only with capability; transport is mocked, no real model call.
- Commercial review cites actual details, flags incompatible exposure windows and keeps selected periods and canonical numbers unchanged. Existing private recommendation links retain the original task snapshot projection and still validate historical versions.

## Pending grouped iPhone acceptance

1. Ask the chat to declare a particular saved task done with real dates, a price/unit and location. Inspect all values in the card before confirming; correct in conversation if necessary. No default price, unit or date should be invented.
2. Confirm offline, close and reopen. Find the same task/details pending sync; reconnect, sync once and check another compatible client.
3. In the task sheet, edit French-calendar dates, price and location without changing status. Check invalid end/begin, future dates, missing unit and comma price. Leave without saving and verify the warning. Explicitly clear details, save and ensure history stays available.
4. Ask for a before/during/after review. It must separate declared details from plan values, flag a window outside declared dates, and never claim causal effect or change CA/margin from a declared price.
5. Reopen a task / compare conflicting changes on two devices. The prior real details remain unless explicitly removed; no silent overwrite or reassignment of decision links.

Seven-workstream status: 1 ongoing, 2 code ready, 3 ongoing, 4 ongoing, 5 ongoing (this lot ready in code), 6 not started, 7 ongoing. Code ready, production delivery and user acceptance are distinct.
