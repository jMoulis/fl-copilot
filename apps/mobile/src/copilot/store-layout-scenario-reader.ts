import {
  readStoreLayoutScenarioCard,
  layoutScenarioInput,
  validateStoreLayoutReadSnapshot,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { prepareStoreLayoutScenario } from "@fl-copilot/commercial-core";
import { StoreLayoutRepository } from "../store/layout-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CommercialChoiceRepository } from "../commercial/offer-choice-repository";
import { verifyPrivateToolRecord } from "./private-tool-record";
import { joinedProductToolDatabase } from "./product-tool-transaction";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class CopilotStoreLayoutScenarioReader {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private scope: { storeId: string; ownerId: string },
  ) {}
  async open(raw: CopilotMessage) {
    const { message, content } = readStoreLayoutScenarioCard(raw),
      scenario = content.scenario;
    type Plan = NonNullable<
      Awaited<ReturnType<StoreLayoutRepository["getRevision"]>>
    >;
    let state:
      | {
          message: CopilotMessage;
          scenario: typeof scenario;
          layout: Plan | null;
          freshness: "CURRENT" | "REVIEW_REQUIRED" | "UNVERIFIABLE";
          issues: string[];
        }
      | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await verifyPrivateToolRecord(
        tx,
        this.scope,
        message,
        content.assistantMessageId,
      );
      const repo = new StoreLayoutRepository(
        joinedProductToolDatabase(tx),
        () => {
          throw Error("READ_ONLY");
        },
      );
      const source = await repo.getRevision(
          this.scope.storeId,
          scenario.physicalRevisionId,
        ),
        current = await repo.get(this.scope.storeId);
      if (source) {
        validateStoreLayoutReadSnapshot(this.scope.storeId, {
          head: source,
          reference: source,
        });
        if (source.version !== scenario.physicalVersion)
          throw Error("LAYOUT_SCENARIO_SOURCE_INVALID");
      }
      const issues: string[] = [],
        review: string[] = [];
      if (!source)
        issues.push(
          "Le plan historique source manque sur cet appareil. Synchronisez avant d’afficher le schéma ; la proposition d’origine reste conservée.",
        );
      if (!current)
        issues.push(
          "La référence actuelle n’est pas disponible localement. Sa fraîcheur ne peut pas être confirmée.",
        );
      else {
        if (
          current.entity.storeId !== this.scope.storeId ||
          current.entity.id !== this.scope.storeId
        )
          throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
        if (current.entity.referenceRevisionId !== scenario.physicalRevisionId)
          review.push(
            "La référence physique adoptée a changé. Cette proposition utilise toujours son plan d’origine ; ses affectations sont à revoir.",
          );
        if (["ERROR", "CONFLICT"].includes(current.syncState))
          review.push(
            "Le plan actuel nécessite une résolution de synchronisation.",
          );
      }
      const products = new ProductMasterRepository(
          joinedProductToolDatabase(tx),
        ),
        offers = new CommercialChoiceRepository(
          joinedProductToolDatabase(tx),
          async () => {
            throw Error("READ_ONLY");
          },
        );
      const rows = await Promise.all(
        [...new Set(scenario.items.map((i) => i.productId))].map((id) =>
          products.getProduct(id),
        ),
      );
      const choices = await Promise.all(
        scenario.items
          .filter((i) => i.kind === "OFFER")
          .map((i) => offers.get(this.scope.storeId, i.id)),
      );
      if (
        [...rows, ...choices].some(
          (r) => r && r.entity.storeId !== this.scope.storeId,
        )
      )
        throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
      if ([...rows, ...choices].some((r) => !r))
        issues.push(
          "Certaines références produits/offres ne sont pas disponibles sur cet appareil. L’absence locale n’indique pas leur suppression.",
        );
      if (
        [...rows, ...choices].some(
          (r) => r && ["ERROR", "CONFLICT"].includes(r.syncState),
        )
      )
        review.push(
          "Un produit ou une offre nécessite une résolution de synchronisation.",
        );
      if (source && ![...rows, ...choices].some((r) => !r)) {
        const checked = prepareStoreLayoutScenario(
          this.scope.storeId,
          layoutScenarioInput(scenario),
          {
            layout: { head: source, reference: source },
            products: rows.map((r) => r!.entity),
            choices: choices.map((r) => r!.entity),
          },
        );
        if (
          checked.status !== "READY" ||
          JSON.stringify(checked.scenario) !== JSON.stringify(scenario)
        )
          review.push(
            "Une référence produit/offre, sa version ou son applicabilité a changé. Relisez la proposition avant de l’utiliser.",
          );
      }
      state = {
        message,
        scenario,
        layout: source,
        freshness: review.length
          ? "REVIEW_REQUIRED"
          : issues.length
            ? "UNVERIFIABLE"
            : "CURRENT",
        issues: [...review, ...issues],
      };
    });
    if (!state) throw Error("LAYOUT_SCENARIO_UNAVAILABLE");
    return state;
  }
}
