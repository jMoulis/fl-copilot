import {
  CopilotToolError,
  CopilotFormError,
  type CopilotForm,
  type CopilotFormAnswers,
  type CopilotToolScope,
} from "@fl-copilot/domain";
import type { CopilotFormCardAction } from "./inline-form-card";
import { CopilotFormRepository } from "./form-repository";
import { CopilotFormSubmissionService } from "./form-submission-service";
export class CopilotFormCardActionError extends Error {
  constructor(
    readonly form: CopilotForm | null,
    readonly original: unknown,
  ) {
    super(
      original instanceof Error
        ? original.message
        : "La réponse n’a pas pu être enregistrée.",
    );
  }
  get issues() {
    return this.original instanceof CopilotFormError
      ? this.original.issues
      : [];
  }
}
/** Host invokes this only from the user's action and refreshes displayed state from its result. */
export class CopilotFormCardController {
  constructor(
    private repo: CopilotFormRepository,
    private submission: CopilotFormSubmissionService,
    private getCurrentBasis: () => Promise<string>,
  ) {}
  async perform(
    action: CopilotFormCardAction,
    form: CopilotForm,
    answers: CopilotFormAnswers,
    scope: CopilotToolScope,
    ctx: { deviceId: string; canSubmitForm: boolean },
    signal?: AbortSignal,
  ) {
    if (action === "SUBMIT" && !ctx.canSubmitForm)
      throw new CopilotToolError("FORBIDDEN");
    try {
      const basis = await this.getCurrentBasis(),
        edited = await this.repo.edit(
          {
            id: form.definition.id,
            expectedVersion: form.version,
            action:
              action === "CANCEL"
                ? "CANCEL"
                : action === "POSTPONE"
                  ? "POSTPONE"
                  : "SAVE",
            answers,
          },
          scope,
          basis,
          signal,
        );
      if (action !== "SUBMIT" || edited.form.status !== "READY")
        return { ...edited, submission: null };
      const submitted = await this.submission.submit(
        {
          formId: edited.form.definition.id,
          expectedVersion: edited.form.version,
        },
        {
          ...scope,
          deviceId: ctx.deviceId,
          canSubmitForm: ctx.canSubmitForm,
          confirmedFormId: edited.form.definition.id,
          confirmedFormVersion: edited.form.version,
          currentBasisToken: await this.getCurrentBasis(),
        },
        signal,
      );
      return { form: submitted.form, issues: [], submission: submitted };
    } catch (error) {
      const current = await this.repo
        .get(form.definition.id, scope)
        .catch(() => null);
      throw new CopilotFormCardActionError(current, error);
    }
  }
}
