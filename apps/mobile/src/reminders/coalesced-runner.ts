export class CoalescedReminderRunner {
  private pending: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  run(job: () => Promise<void>): Promise<void> {
    this.pending = job;
    if (this.running) return this.running;
    this.running = Promise.resolve()
      .then(async () => {
        while (this.pending) {
          const next = this.pending;
          this.pending = undefined;
          await next();
        }
      })
      .finally(() => {
        this.running = undefined;
        if (this.pending) void this.run(this.pending).catch(() => undefined);
      });
    return this.running;
  }
}
