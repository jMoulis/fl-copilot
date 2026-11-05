export type ChatPushState = {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  error?: string;
};
/** Serializes device preference/registration so a late enable cannot undo disable. */
export class ChatPushRegistration {
  private tail = Promise.resolve();
  constructor(
    private ports: {
      current(): boolean;
      read(): Promise<string | null>;
      write(value: string): Promise<void>;
      permission(request: boolean): Promise<boolean>;
      token(): Promise<string>;
      save(token: string | null): Promise<unknown>;
      publish(state: ChatPushState): void;
    },
  ) {}
  private run(work: () => Promise<void>) {
    const task = this.tail.then(async () => {
      if (!this.ports.current()) return;
      try {
        await work();
      } catch {
        if (!this.ports.current()) return;
        const preference = await this.ports.read().catch(() => null);
        this.publish(
          preference === "1",
          false,
          preference === "pending-disable"
            ? "La désactivation attend une connexion. Réessaie la vérification, ou coupe les notifications dans les réglages du téléphone."
            : "Vérifie l’autorisation de notifications et ta connexion, puis réessaie. Tes réponses restent accessibles dans le chat.",
        );
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  private publish(enabled: boolean, busy: boolean, error?: string) {
    if (this.ports.current())
      this.ports.publish({ enabled, ready: true, busy, error });
  }
  private async register(enabled: boolean) {
    const allowed = await this.ports.permission(false);
    if (!this.ports.current()) return;
    const token = enabled && allowed ? await this.ports.token() : null;
    if (!this.ports.current()) return;
    await this.ports.save(token);
    if (enabled && !token) throw Error("CHAT_PUSH_PERMISSION_DENIED");
  }
  refresh() {
    return this.run(async () => {
      const value = await this.ports.read();
      if (!this.ports.current()) return;
      this.publish(value === "1", false);
      if (value === "1") await this.register(true);
      if (value === "pending-disable") {
        await this.register(false);
        if (this.ports.current()) await this.ports.write("0");
      }
    });
  }
  setEnabled(enabled: boolean) {
    return this.run(async () => {
      const previous = await this.ports.read();
      this.publish(previous === "1", true);
      if (enabled && !(await this.ports.permission(true)))
        throw Error("CHAT_PUSH_PERMISSION_DENIED");
      if (!this.ports.current()) return;
      await this.ports.write(enabled ? "1" : "pending-disable");
      if (!this.ports.current()) return;
      this.publish(enabled, true);
      await this.register(enabled);
      if (!this.ports.current()) return;
      if (!enabled) await this.ports.write("0");
      this.publish(enabled, false);
    });
  }
}
