import type { StoreLayoutContent } from "@fl-copilot/domain";
import { placeStoreLayoutObject } from "@fl-copilot/commercial-core";
import type { LayoutViewport, LayoutRect } from "./layout-view-model";
export type LayoutMapFrame = {
  width: number;
  height: number;
  factor: number;
  ox: number;
  oy: number;
};
function validFrame(frame: LayoutMapFrame, viewport: LayoutViewport) {
  if (
    ![
      frame.width,
      frame.height,
      frame.factor,
      frame.ox,
      frame.oy,
      viewport.scale,
      viewport.x,
      viewport.y,
    ].every(Number.isFinite) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.factor <= 0 ||
    viewport.scale < 1 ||
    viewport.scale > 4
  )
    throw Error("Le repère du plan a changé. Reprenez le déplacement.");
}
/** Inverts the native map's centre-based scale and screen translation, never its schematic furniture coordinates. */
export function layoutMapPoint(
  frame: LayoutMapFrame,
  viewport: LayoutViewport,
  x: number,
  y: number,
) {
  validFrame(frame, viewport);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw Error("Geste de placement invalide.");
  return {
    x:
      ((x - frame.width / 2 - viewport.x * frame.width) / viewport.scale +
        frame.width / 2 -
        frame.ox) /
      frame.factor,
    y:
      ((y - frame.height / 2 - viewport.y * frame.height) / viewport.scale +
        frame.height / 2 -
        frame.oy) /
      frame.factor,
  };
}
export function layoutDragHit(
  rectangles: readonly LayoutRect[],
  id: string,
  frame: LayoutMapFrame,
  viewport: LayoutViewport,
  x: number,
  y: number,
) {
  const rect = rectangles.find((r) => r.id === id);
  if (!rect) return false;
  const p = layoutMapPoint(frame, viewport, x, y);
  const pad = 8 / (frame.factor * viewport.scale);
  return (
    p.x >= rect.x - pad &&
    p.x <= rect.x + rect.width + pad &&
    p.y >= rect.y - pad &&
    p.y <= rect.y + rect.height + pad
  );
}
/** Screen delta becomes a declared translation from recorded coordinates. No fallback, guessed measure, persistence or undo step. */
export function dragStoreLayoutObject(
  content: StoreLayoutContent,
  id: string,
  dx: number,
  dy: number,
  frame: LayoutMapFrame,
  viewport: LayoutViewport,
) {
  validFrame(frame, viewport);
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw Error("Geste de placement invalide.");
  const assembly = content.assemblies.find((a) => a.id === id);
  const object = assembly ?? content.furniture.find((f) => f.id === id);
  if (!object) throw Error("Choisissez un îlot ou un meuble du brouillon.");
  if (object.x.mm === null || object.y.mm === null)
    throw Error(
      "Précisez d’abord les positions X et Y dans la fiche de cet élément. Son repère schématique ne sera pas enregistré comme position.",
    );
  const x = Math.round(dx / (frame.factor * viewport.scale)),
    y = Math.round(dy / (frame.factor * viewport.scale));
  if (!x && !y) return content;
  const nextX = object.x.mm + x,
    nextY = object.y.mm + y;
  if (nextX < 0 || nextY < 0 || nextX > 100000 || nextY > 100000)
    throw Error(
      "Le déplacement dépasse le repère autorisé : X et Y doivent rester entre 0 et 10 000 cm.",
    );
  return placeStoreLayoutObject(
    content,
    assembly ? "ASSEMBLY" : "FURNITURE",
    id,
    {
      x: x ? { mm: nextX, quality: "DECLARED" } : object.x,
      y: y ? { mm: nextY, quality: "DECLARED" } : object.y,
      rotation: object.rotation,
    },
  );
}
