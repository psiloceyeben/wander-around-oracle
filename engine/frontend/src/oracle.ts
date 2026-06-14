// Oracle HTTP client wrapper. Re-exports the engine's HttpOracleClient
// with sane defaults for browser usage + a quick-check method that
// reports availability to the HUD.

import { HttpOracleClient } from "@engine/features/agentPlayer/index.js";
import type { OracleClient } from "@engine/features/agentPlayer/index.js";

export interface OracleConfig {
  endpoint: string;
  timeoutMs?: number;
}

export class FrontendOracle {
  client: OracleClient;
  endpoint: string;
  available = false;

  constructor(cfg: OracleConfig) {
    this.endpoint = cfg.endpoint;
    this.client = new HttpOracleClient(this.endpoint);
  }

  async probe(): Promise<{ ok: boolean; step?: number; checkpoint?: string }> {
    try {
      const r = await this.client.healthz();
      this.available = !!r.ok;
      return r;
    } catch {
      this.available = false;
      return { ok: false };
    }
  }
}
