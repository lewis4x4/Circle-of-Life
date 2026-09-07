export type PendingLifecycleRequest = { path: string; method: string; body?: string; key: string; terminal?: boolean };

/** Keep the exact operation identity through network uncertainty and 202 receipts. */
export class LifecycleRequestClient {
  pending: PendingLifecycleRequest | null = null;
  constructor(private readonly onChange: (pending: PendingLifecycleRequest | null) => void,
    private readonly send: typeof fetch = fetch) {}

  acknowledgeTerminal() {
    if (!this.pending?.terminal) return;
    this.pending = null;
    this.onChange(null);
  }

  async request(path: string, init: { method: string; body?: string }): Promise<Response> {
    const prior = this.pending;
    if (prior?.terminal) throw new Error("Review current access before submitting a replacement account change.");
    if (prior && (prior.path !== path || prior.method !== init.method || prior.body !== init.body)) {
      throw new Error("Resolve the pending account change before starting a different change.");
    }
    const pending = prior ?? { path, ...init, key: crypto.randomUUID() };
    this.pending = pending;
    this.onChange(pending);
    const response = await this.send(path, {
      ...init, headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key },
    });
    if (response.status === 202) {
      const receipt = await response.clone().json().catch(() => null);
      if (receipt?.sync_status === "action_required" || receipt?.data?.sync_status === "action_required") {
        this.pending = { ...pending, terminal: true };
        this.onChange(this.pending);
        throw new Error("The account change needs review. Check current access before submitting a replacement request.");
      }
    }
    if ((response.ok && response.status !== 202) || [400, 422].includes(response.status)) {
      this.pending = null;
      this.onChange(null);
    }
    return response;
  }
}
