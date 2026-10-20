import { expect, it } from "vitest";
import { visualLibraryFixture } from "../../../../scripts/test-visual-library-fixtures";
import { visualConflictSummary } from "./visual-conflict-presentation";
it("compares image provenance, identity and product association without exposing raw IDs or debug JSON", () => {
  const f = visualLibraryFixture();
  const labels = {
    [f.product.id]: f.product.label,
    [f.identity.id]: f.identity.canonicalName,
  };
  expect(visualConflictSummary(f.asset, labels)).toEqual([
    "Image approuvée",
    "Photo ajoutée par le magasin · droits déclarés",
    "500 × 500 px",
  ]);
  expect(visualConflictSummary(f.identity, labels)).toEqual([
    f.identity.canonicalName,
    "Visuel générique",
  ]);
  expect(visualConflictSummary(f.link, labels)).toContain(f.product.label);
  expect(
    visualConflictSummary(
      {
        ...f.asset,
        review: { status: "REVOKED", actorId: f.actorId, at: f.at },
        deletedAt: f.at,
      },
      labels,
    ),
  ).toContain("Élément supprimé · original conservé pour examen");
  for (const value of [f.asset, f.identity, f.link])
    expect(visualConflictSummary(value, labels).join(" ")).not.toContain(
      value.id,
    );
});
