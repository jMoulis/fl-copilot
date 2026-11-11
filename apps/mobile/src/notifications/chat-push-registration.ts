import type { PushChannels } from "@fl-copilot/sync-contracts";
export type ChatPushState = {
  enabled: boolean;
  emailEnabled?: boolean;
  documentsEnabled?: boolean;
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
      email?: {
        read(): Promise<string | null>;
        write(value: string): Promise<void>;
      };
      documents?: {
        read(): Promise<string | null>;
        write(value: string): Promise<void>;
      };
      permission(request: boolean): Promise<boolean>;
      token(): Promise<string>;
      save(token: string | null, channels?: PushChannels): Promise<unknown>;
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
        const values = await this.read().catch(() => ({
          chat: null,
          email: null,
          documents: null,
        }));
        if (!this.ports.current()) return;
        this.publish(
          values,
          false,
          Object.values(values).includes("pending-disable")
            ? "La désactivation attend une connexion. Réessaie la vérification, ou coupe les notifications dans les réglages du téléphone."
            : "Vérifie l’autorisation de notifications et ta connexion, puis réessaie. Tes résultats restent accessibles dans l’app.",
        );
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async read() {
    const [chat, email, documents] = await Promise.all([
      this.ports.read(),
      this.ports.email?.read() ?? null,
      this.ports.documents?.read() ?? null,
    ]);
    return { chat, email, documents };
  }
  private publish(
    values: {
      chat: string | null;
      email: string | null;
      documents: string | null;
    },
    busy: boolean,
    error?: string,
  ) {
    if (this.ports.current())
      this.ports.publish({
        enabled: values.chat === "1",
        ...(this.ports.email ? { emailEnabled: values.email === "1" } : {}),
        ...(this.ports.documents
          ? { documentsEnabled: values.documents === "1" }
          : {}),
        ready: true,
        busy,
        error,
      });
  }
  private async register(values: {
    chat: string | null;
    email: string | null;
    documents: string | null;
  }) {
    const allowed = await this.ports.permission(false);
    if (!this.ports.current()) return;
    const channels = {
      chat: values.chat === "1",
      email: values.email === "1",
      ...(this.ports.documents ? { documents: values.documents === "1" } : {}),
    };
    const enabled = Object.values(channels).some(Boolean);
    const token = enabled && allowed ? await this.ports.token() : null;
    if (!this.ports.current()) return;
    if (this.ports.email || this.ports.documents)
      await this.ports.save(token, channels);
    else await this.ports.save(token);
    if (enabled && !token) throw Error("PUSH_PERMISSION_DENIED");
  }
  refresh() {
    return this.run(async () => {
      const values = await this.read();
      if (!this.ports.current()) return;
      this.publish(values, false);
      if (
        Object.values(values).some((v) => v === "1" || v === "pending-disable")
      )
        await this.register(values);
      if (!this.ports.current()) return;
      if (values.chat === "pending-disable") await this.ports.write("0");
      if (values.email === "pending-disable")
        await this.ports.email?.write("0");
      if (values.documents === "pending-disable")
        await this.ports.documents?.write("0");
    });
  }
  setEnabled(enabled: boolean) {
    return this.setChannel("chat", enabled);
  }
  setEmailEnabled(enabled: boolean) {
    return this.setChannel("email", enabled);
  }
  setDocumentsEnabled(enabled: boolean) {
    return this.setChannel("documents", enabled);
  }
  private setChannel(
    channel: "chat" | "email" | "documents",
    enabled: boolean,
  ) {
    return this.run(async () => {
      const port = channel === "chat" ? this.ports : this.ports[channel];
      if (!port) return;
      const values = await this.read();
      if (!this.ports.current()) return;
      this.publish(values, true);
      if (enabled && !(await this.ports.permission(true)))
        throw Error("PUSH_PERMISSION_DENIED");
      if (!this.ports.current()) return;
      values[channel] = enabled ? "1" : "pending-disable";
      await port.write(values[channel]);
      if (!this.ports.current()) return;
      this.publish(values, true);
      await this.register(values);
      if (!this.ports.current()) return;
      if (!enabled) await port.write("0");
      this.publish(values, false);
    });
  }
}
