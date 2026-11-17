import { describe, it, expect } from "vitest";
import {
  parseNationalRestrictions,
  parseNationalSocial,
} from "./national-news";
const rss = (body: string) => `<rss><channel>${body}</channel></rss>`;
const road = `<item><title>Fermeture de l'A13 : quelles mesures ?</title><description>Du 16 novembre 2026 jusqu’à fin août 2027, l’autoroute est fermée.</description><link>https://www.ecologie.gouv.fr/actualites/fermeture</link><pubDate>Thu, 12 Nov 2026 10:54:06 +0100</pubDate></item>`;
const social = (
  title = "Le 17 novembre, dans le public et le privé : grève nationale",
) =>
  `<h3><a href="/comm-de-presse/appel">${title}</a></h3><div><p>Appel interprofessionnel à la mobilisation.</p></div><time datetime="2026-11-09T15:28:46+01:00">09 Nov. 2026</time>`;
describe("bounded national source adapters", () => {
  it("preserves publication separately and never invents an approximate end or event year", () => {
    const a = parseNationalRestrictions(rss(road)).items[0]!;
    expect(a.publishedAt).toBe("2026-11-12T09:54:06.000Z");
    expect(a.startDate).toBeNull();
    expect(a.endDate).toBeNull();
    expect(a.summary).toContain("fin août 2027");
    expect(parseNationalSocial(social()).items[0]!.startDate).toBeNull();
    expect(
      parseNationalSocial(social("Grève nationale le 17 novembre 2026"))
        .items[0]!.endDate,
    ).toBe("2026-11-17");
  });
  it("filters unrelated policy, deduplicates URLs and refuses foreign URLs", () => {
    expect(
      parseNationalRestrictions(
        rss(
          road +
            road +
            `<item><title>Interdiction des airbags d'occasion</title></item>`,
        ),
      ).items,
    ).toHaveLength(1);
    expect(() =>
      parseNationalRestrictions(
        rss(
          road.replace(
            "https://www.ecologie.gouv.fr/actualites/fermeture",
            "https://attacker.example/path",
          ),
        ),
      ),
    ).toThrow("SOURCE_INVALID");
    expect(
      parseNationalSocial(
        social("Congrès").replace(
          "Appel interprofessionnel à la mobilisation.",
          "Débat interne.",
        ),
      ).items,
    ).toHaveLength(0);
  });
  it("does not treat international news as a national call or attach another card's timestamp", () => {
    expect(
      parseNationalSocial(
        social("Mobilisation internationale").replace(
          "Appel interprofessionnel à la mobilisation.",
          "Grève internationale.",
        ),
      ).items,
    ).toEqual([]);
    expect(() =>
      parseNationalSocial(
        '<h3><a href="/premier">Appel national</a></h3>' + social(),
      ),
    ).toThrow("FORMAT_CHANGED");
    expect(
      parseNationalSocial(
        social("Grève nationale reconductible le 17 novembre 2026"),
      ).items[0]!.endDate,
    ).toBeNull();
  });
  it("fails closed on changed markup, malformed XML, entities and oversized lists", () => {
    expect(() => parseNationalSocial("<html>Maintenance</html>")).toThrow();
    expect(() =>
      parseNationalRestrictions("<html>Maintenance</html>"),
    ).toThrow();
    expect(() =>
      parseNationalRestrictions("<!DOCTYPE rss>" + rss(road)),
    ).toThrow();
    expect(() => parseNationalRestrictions(rss(road.repeat(101)))).toThrow();
  });
});
