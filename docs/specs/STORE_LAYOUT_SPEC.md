## Owner arbitration — 1 November 2026: declared merchandising zones

Users may qualify named TGs, island faces and other department locations as HOT, INTERMEDIATE, COLD or UNKNOWN, with optional position and observation. These are manager-declared commercial observations, not measured footfall or a ranking inferred from sales. UNKNOWN is not COLD. They inform weekly TG/counter-promotion advice with circulation and available analytics, without requiring measured geometry.

The minimal context is stored in the existing versioned store settings: optional merchandising context, active produce-TG count (null unknown, zero explicit), implantation/family notes, main circulation and up to 32 distinct stable named locations. Known active TG locations must not exceed a declared count; incomplete location lists do not establish a complete physical inventory. Non-TG locations have no active-TG flag. These semantic location IDs/text are not automatically physical furniture/surface IDs or validated geometric allocation targets. No parallel geometry or new collection is created.

Pilot facts explicitly supplied by Julien: two TGs are for fruits and vegetables; TG1 is first encountered; the main customer route is the central aisle between the two islands. The third physical TG is not counted as a produce TG. TG2's exact position and heat classifications remain unspecified. These statements guide acceptance; they are not hardcoded application defaults or evidence of an actual synchronized write.

## Owner arbitration — 1 November 2026: minimum context for weekly strategy

Weekly commercial advice first needs active TGs and their positions, department/family implantation and the declared habitual main customer circulation. This is store-owned reusable context. Physical furniture count is not active TG availability; neither flow nor active status may be inferred from coordinates. Detailed dimensions/2D editing remain separate and must not block qualitative strategy. The existing layout has physical inventory/geometry, not active flags or circulation; these missing fields require an explicit backward-compatible canonical contract before implementation, not text hidden in geometry labels or private conversation memory.

# Store plan and furniture specification

Product decisions confirmed with Julien on 19 October 2026. This specification governs M7-T27/T28 and the store settings entry for physical layout. It replaces the earlier assumption that each chat should supply its own complete furniture geometry. The detailed interaction rules below remain to be implemented and accepted on the native app. This specification does not change the canonical native, local-first or synchronization architecture.

## Purpose and ownership

The physical plan belongs to the store and produce department. Open it from **Fiche magasin → Plan et mobilier**. Every authorized conversation and commercial preparation reuses that store reference. Furniture geometry is distinct from weekly product allocation, an illustrative image and a report of actual execution.

Furniture positions are fixed by default. The Copilot normally recommends which products to present on existing selling surfaces. Moving furniture is a separate, explicit request, never an implicit prerequisite for a weekly proposal.

## Confirmed pilot inventory and vocabulary

An **îlot** is an assembly of physical elements, not one elementary piece of furniture. The pilot has two islands. Each contains eight fixed elements: four on Face A and four on Face B. There are therefore sixteen island elements and three additional elements used as TGs: nineteen principal elements before counting mobiles. The three physical TGs must not become four because a source document offers four merchandising ideas.

Each fixed island element has its own aluminium **bac** and its own upper **étagère**. Adjacent upper shelves look continuous when assembled, but remain distinct physical surfaces. An individual fixed element belongs to one face; it does not itself contain both faces. Do not duplicate its upper shelf under two faces, or collapse all upper shelves into one indivisible island-wide surface.

**Mobiles** are additional furniture used to present products for sale. They exist beneath only some fixed elements and generally keep the same position. They are not reserve stock, and their number is not inferred from the number of fixed elements. Give each mobile its own identity, dimensions and habitual placement, with an explicit association to its host fixed element where applicable. A missing mobile association does not create a mobile automatically. Occasional relocation is possible through deliberate plan editing.

Use the manager's terms **îlot, face, élément, bac, étagère supérieure, mobile, TG** in French. “Niveau” is not a compulsory generic navigation concept for these known surfaces.

## Physical model

The store plan describes the department outline, reference orientation, entrances, passages and obstacles where known. Island assemblies group fixed elements by face and order. Each fixed element preserves a stable identity, its physical dimensions and placement, and the identities of its selling surfaces. Standalone TGs retain their own identity and composition. Mobiles are separate furniture, not additional shelves of the fixed structure.

Use this conceptual navigation hierarchy:

- Store and department plan.
- Island assembly, then Face A or Face B, then the fixed element.
- The element's aluminium bac and upper shelf.
- Associated mobiles, each with its own selling surface and habitual placement.
- Standalone TGs, with their own furniture/surface details.

A mobile-to-host association supports navigation and usual placement; it is not proof of dimensions, clearance or load compatibility. Derived assembly outlines must not be counted again as additional physical furniture. A commercial allocation references exact furniture/surface identities and the physical plan revision it used.

Distinguish floor footprint from usable selling dimensions. Shelf depth is not the island floor depth; neither determines display quantity or kg capacity. Define dimension labels in the furniture's local orientation, then use explicit position and rotation to place it on the plan. Display user-friendly units and normalize conversions deterministically. Missing height, dimensions, clearance, load limits and inventory remain unknown, not zero.

## Reuse of fleg

Start from the pilot reference in [jMoulis/fleg](https://github.com/jMoulis/fleg/tree/8ea2ab98241bf0680b99bbe8adf6cbdd0af633ea/src/domain/space). Its [reference plan](https://github.com/jMoulis/fleg/blob/8ea2ab98241bf0680b99bbe8adf6cbdd0af633ea/schemas/reference-layout.json) and [editor](https://github.com/jMoulis/fleg/blob/8ea2ab98241bf0680b99bbe8adf6cbdd0af633ea/src/components/space/layout-editor.tsx) provide a starting point, not a live dependency or a measured survey.

The reference already describes two islands, four modules per face, three TGs, upper shelves and versioned store layouts. Adapt those concepts to physical elements with separate selling surfaces. Check mapping explicitly; do not mistake one face module for a complete two-faced island. Existing web components are not a drop-in native editor.

The reference marks its geometry as needing confirmation. Retain source provenance and this qualification when importing it. In particular, the reference 11.5 × 8.5 m department, 4.1 × 1.77 m island envelopes and 0.45 m shelf depth are starting values to verify, not newly confirmed store measurements. Preserve external IDs as lineage; do not adopt another repository's database, authorization or identifier scheme as the native canonical store.

## Native interaction

### Everyday consultation

Open a top-down 2D plan from the store page, without adding another primary navigation tab. Show the islands, element divisions, TGs and selected furniture. Pan and pinch/zoom explore the plan; these gestures never move furniture in consultation mode. Provide a selectable furniture list as an accessible alternative for small targets.

Touching a fixed element opens a dismissible bottom sheet without losing the map position, zoom or selection. Show its identity and useful dimensions. A compact front view distinguishes the bac, upper shelf and associated mobile when present. Selecting a surface opens that surface's details. A mobile may sit below another footprint in projection; never imply that a top-down image shows every surface simultaneously.

Assembly and face navigation give context without hiding individual elements. Names such as **Îlot 1 · Face A · Élément 2 · Étagère supérieure** identify the target unambiguously. Face orientation is labelled consistently on the reference plan; do not silently swap A/B with screen rotation.

### Deliberate editing

Enter **Modifier le plan** explicitly. Changes form a draft based on an identified reference revision. Editing supports furniture identity/dimensions, supported placement/orientation, addition/duplication and removal, and association/relocation of existing mobiles. Use precise numeric entry alongside manipulation; distinguish dragging an object from panning the map. Provide cancellation and undo within the draft.

The manager can save incomplete work without declaring all measurements confirmed. Show targeted missing information or geometric issues at the affected object. Do not require purchase costs, product metadata or guessed kg loads merely to maintain the plan. Required dimensions for a specific feasibility check remain a separate gate.

Before adopting a changed reference, display the relevant differences and unresolved constraints. Removing an element from the current reference preserves prior versions and historical allocations; affected current proposals need review rather than silent reassignment. Restoring an older plan creates a new revision instead of rewriting history.

The plan and saved drafts remain usable offline and after restart. Normal background synchronization preserves the map, selected element and unsaved edits. Loading, local save, pending synchronization, conflict, unknown dimensions and confirmed reference are understandable French states, not internal codes.

## Versions and synchronization

Store-scoped physical layouts and drafts are separate from conversation-private messages and from weekly commercial plans. Stable IDs identify assemblies, elements, surfaces and mobiles across revisions. An adopted revision records its base revision, provenance, actor, time, changed content and measurement qualifications.

Before implementing repositories, define shared Zod contracts, local/remote storage, migrations, serializers, capability negotiation and domain-specific conflict rules. User mutations must use one SQLite transaction with history and Outbox, then authorized idempotent Mongo push and incremental pull. No direct model-controlled remote write, universal last-write-wins or parallel geometry datastore.

On concurrent changes, preserve both intentions and compare against the common base. Do not silently pick one store plan or replace newer local edits with an old acknowledgement. Cached current and historical revisions must restore with their referenced furniture/surfaces. A conflict does not erase the original plan or its commercial references.

## Geometry and selling surfaces

Validate individual elements, group membership, IDs, supported dimensions/orientations, bounds and lateral collisions. Preserve the distinction between a group envelope, the furniture it contains and a selling surface attached to it.

Physical levels matter: a mobile positioned underneath fixed furniture is not automatically a collision just because their 2D projections overlap. Conversely, a host association alone does not prove that the mobile fits. Use declared height/clearance and footprint constraints when available; otherwise qualify the under-furniture fit as unverified. Do not disable collision checking globally to accommodate mobiles.

Keep load checks conditional on known limits and actual declared loads. Do not derive load or stock from shelf area, or sum kg and pieces. Passage requirements are declared constraints; the application does not invent regulatory minima or guarantee escape-route connectivity or stability.

The PR 264 flat rectangular preflight is reusable calculation groundwork, not the store model. Its eight-fixture limit does not cover nineteen elementary fixed/TG objects plus mobiles, and its 2D collision rules cannot validate all nested surfaces. Adapt the shared checks to the canonical hierarchy before claiming full pilot validation. Do not split the plan into unchecked batches or substitute hypothetical chat rectangles for the store reference.

## Copilot and illustration contract

The assistant retrieves the authorized store reference and its revision, measurement status, usable surfaces and relevant unknowns. Reuse known values across chats. Ask only for information needed for the current request, with targeted forms or links opening the exact furniture/surface. A photo can help interpret an arrangement, not silently establish exact dimensions.

Commercial proposals allocate to existing selling surfaces while keeping furniture positions unchanged by default. Distinguish proposed allocation, approved commercial plan and actual field execution. Discussing an assignment or rendering an image performs none of those writes implicitly. The assistant may prepare supported physical-plan edits when explicitly requested, using the same native review, permission and synchronization rules.

A canonical schematic and any later generated illustration bind to the same physical revision, allocation scenario, source/constraint references and declared assumptions. A physically changed reference marks affected proposals/illustrations for review. Keep historical sources and images with their original revision. Attractive pixels do not confirm measurements or execution. Image-provider activation and cost approval remain separate from this specification.

## Delivery sequence and acceptance

1. Define shared physical hierarchy and migrations. Map the fleg reference to stable native identities, retaining unconfirmed measurements; test the two eight-element islands and three TGs without inventing mobiles.
2. Deliver store-owned local repositories, version/draft history and canonical bidirectional synchronization. Verify offline restart, replay, concurrent edits and restoration before relying on remote Copilot reads.
3. Deliver the interactive top-down plan and element front-view sheet, deliberate editing and targeted measurement confirmation. Preserve map position and drafts through background updates.
4. Expose scoped reads and reviewed mutations to the Copilot. Verify that routine commercial proposals reuse the plan without moving furniture, and an explicit physical change preserves history and authority.
5. Build the canonical schematic and linked illustration, then accept a measured pilot case and an impossible/unknown case. Group paid EAS testing only when a substantial native acceptance is needed.

Acceptance includes optional mobiles present only where recorded; no duplicated upper shelf; independent surface identities; projected overlap below a fixture distinguished from a proven physical collision; current proposals invalidated after relevant reference changes; no silent fourth TG; and no unit, capacity or measurement invented by the model. These are M7 workstream 6 gates, not additional milestones or claims of completed implementation.

## Remaining field details

The following are values or focused design details to collect progressively, not reasons to invent a new architecture or start a full data-entry campaign:

- Exact confirmed room/furniture dimensions, entrances, obstacles and passages.
- Mobile count, dimensions, host associations and clearance at their usual positions.
- TG surface composition, and any deviations from the island-element structure.
- Usable bac/shelf dimensions, relevant load limits and practical product-allocation granularity within a surface.
- A/B orientation labels, element names and precise placement after comparing the reference with the actual rayon.

The physical inventory structure, store ownership, mobile purpose/habitual placement and interactive-plan direction are settled. Detailed native visual acceptance and the field measurements remain to be completed during delivery.
