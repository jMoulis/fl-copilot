import { createHash } from "node:crypto";
import sharp from "sharp";
import { type CopilotMessage, type StoreLayout } from "@fl-copilot/domain";
import {
  bindLayoutIllustrationSource,
  type StoreLayoutIllustrationSource,
} from "@fl-copilot/commercial-core";

export { LAYOUT_ILLUSTRATION_RENDERER } from "@fl-copilot/domain";
export const layoutIllustrationHash = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const xml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** No external resources, scripts, labels interpreted as XML, or drawing-fallback measurements. */
export function layoutIllustrationSvg(source: StoreLayoutIllustrationSource) {
  if (source.status !== "READY") throw Error("LAYOUT_ILLUSTRATION_NOT_READY");
  const { layout, scenario, geometry } = source,
    c = layout.content,
    width = 1536,
    factor = Math.min(1400 / c.room.width.mm!, 850 / c.room.depth.mm!),
    ox = (width - c.room.width.mm! * factor) / 2,
    oy = 90,
    n = (v: number) => Number(v.toFixed(3));
  const layer = (kind: string) =>
    kind === "ASSEMBLY" ? 0 : kind === "MOBILE" ? 2 : 1;
  const shapes = [...geometry.footprints]
    .sort((a, b) => layer(a.kind) - layer(b.kind))
    .map((f) => {
      const assignments = scenario.assignments.flatMap((a, i) =>
        a.furnitureId === f.id ? [String(i + 1)] : [],
      );
      const mobile = f.kind === "MOBILE",
        group = f.kind === "ASSEMBLY";
      return `<g><rect x="${n(ox + f.x * factor)}" y="${n(oy + f.y * factor)}" width="${n(f.width * factor)}" height="${n(f.depth * factor)}" fill="${group ? "none" : mobile ? "#e9b765" : assignments.length ? "#b2d3b8" : "#eef1ed"}" fill-opacity="${mobile ? "0.5" : "1"}" stroke="#235b3e" stroke-width="${group ? "3" : "1.5"}"${mobile ? ' stroke-dasharray="5 3"' : ""}/>${assignments.length ? `<text x="${n(ox + (f.x + f.width / 2) * factor)}" y="${n(oy + (f.y + f.depth / 2) * factor)}" text-anchor="middle" font-size="20" fill="#142e20">${xml(assignments.join(" · "))}</text>` : ""}</g>`;
    });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><rect width="1536" height="1024" fill="#ffffff"/><text x="40" y="35" font-family="sans-serif" font-size="22" fill="#142e20">Schéma source · semaine du ${xml(scenario.weekStart)} · plan v${layout.version}</text><text x="40" y="62" font-family="sans-serif" font-size="16" fill="#49584b">Vue de dessus · repères d’affectation · proportions issues du plan, mesures à qualifier</text><g font-family="sans-serif"><rect x="${n(ox)}" y="${oy}" width="${n(c.room.width.mm! * factor)}" height="${n(c.room.depth.mm! * factor)}" fill="none" stroke="#142e20" stroke-width="4"/>${shapes.join("")}</g><text x="40" y="1000" font-family="sans-serif" font-size="16" fill="#49584b">Schéma de travail : ne confirme ni passage, capacité, conformité, stock ni mise en place.</text></svg>`;
}
export type LayoutIllustrationScope = {
  storeId: string;
  ownerId: string;
  conversationId: string;
};
/** Caller must load the persisted, visible private card and historical revision under current authorization. */
export async function compileLayoutIllustrationSource(
  scope: LayoutIllustrationScope,
  rawCard: CopilotMessage,
  layout: StoreLayout,
) {
  const { source, binding } = await bindLayoutIllustrationSource(
    scope,
    rawCard,
    layout,
    async (text) => layoutIllustrationHash(text),
  );
  if (source.status !== "READY") return { source, binding, frame: null };
  const svg = layoutIllustrationSvg(source),
    bytes = new Uint8Array(
      await sharp(Buffer.from(svg), { limitInputPixels: 2_000_000 })
        .png()
        .toBuffer(),
    );
  return {
    source,
    binding,
    frame: {
      bytes,
      contentHash: layoutIllustrationHash(bytes),
      width: 1536,
      height: 1024,
      mimeType: "image/png" as const,
    },
  };
}
export type CompiledLayoutIllustrationSource = Awaited<
  ReturnType<typeof compileLayoutIllustrationSource>
>;
