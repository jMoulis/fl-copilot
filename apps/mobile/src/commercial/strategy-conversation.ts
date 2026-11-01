import { z } from "zod";
import { contextWeekQuerySchema } from "@fl-copilot/domain";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import type { CopilotLocalChatController } from "../copilot/local-chat-controller";
import { formatFrenchCalendarDate } from "../dates/calendar";

export function strategyWeek(weekStart?: string, now = new Date()) {
  const explicit = contextWeekQuerySchema.safeParse({ weekStart });
  if (explicit.success)
    return currentCommercialWeek(
      new Date(`${explicit.data.weekStart}T12:00:00Z`),
    );
  const next = new Date(`${currentCommercialWeek(now).start}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  return currentCommercialWeek(next);
}

/** Local draft only: retained original, canonical history/Outbox, no model call. */
export class CommercialStrategyConversation {
  private conversationId?: string;
  private prepared = false;
  private opening?: Promise<string>;
  constructor(
    private readonly controller: CopilotLocalChatController,
    private readonly sourceDocumentId: string,
    private readonly weekStart: string,
  ) {
    z.uuid().parse(sourceDocumentId);
    contextWeekQuerySchema.parse({ weekStart });
  }
  open() {
    if (this.opening) return this.opening;
    this.opening = this.prepare().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private async prepare() {
    const week = strategyWeek(this.weekStart);
    if (!this.conversationId) {
      const conversation = await this.controller.create(
        `Stratégie semaine ${week.number} · ${week.year}`,
      );
      this.conversationId = conversation.id;
    }
    await this.controller.open(this.conversationId);
    if (!this.prepared) {
      await this.controller.attachPdf(
        this.conversationId,
        this.sourceDocumentId,
      );
      await this.controller.appendIntakeQuestion(
        this.conversationId,
        `Préparons la semaine ${week.number} de ${week.year}, du ${formatFrenchCalendarDate(week.start)} au ${formatFrenchCalendarDate(week.end)}, à partir de ce pense-bête. Examine les TG à thème proposées par l’enseigne, les Dramat, le prospectus, les lots permanents et dégressifs. Conseille-moi les TG à garder ou adapter, leur présentation et les éventuelles contre-promos, en croisant les chiffres disponibles et le contexte de mon magasin. Commençons par une proposition commerciale dont on discute, sans enregistrer de décision.`,
      );
      this.prepared = true;
    }
    return this.conversationId;
  }
}
