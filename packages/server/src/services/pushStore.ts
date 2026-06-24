import { PushSubscriptionPayloadSchema, type PushConfigResponse, type PushSubscriptionPayload } from "@pi-postbox/protocol";
import webPush from "web-push";
import type { SqliteDatabase } from "../db/database.js";

interface VapidKeyRow {
  public_key: string;
  private_key: string;
  source: "generated";
}

interface PushSubscriptionRow {
  subscription_json: string;
}

export interface PushStoreOptions {
  publicKey?: string;
  privateKey?: string;
}

export interface PushVapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export class PushStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
    private readonly options: PushStoreOptions = {}
  ) {}

  getConfig(): PushConfigResponse {
    const configured = this.getConfiguredKeys();
    if (configured) {
      return {
        available: true,
        publicKey: configured.publicKey,
        source: "configured"
      };
    }

    const generated = this.getOrCreateGeneratedKeys();
    return {
      available: true,
      publicKey: generated.public_key,
      source: "generated",
      message: "Generated local VAPID keys are persisted in this Postbox database; configure stable production keys before depending on long-lived browser subscriptions."
    };
  }

  upsertSubscription(subscription: PushSubscriptionPayload): void {
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, expiration_time, p256dh, auth, subscription_json, created_at, updated_at)
         VALUES (@endpoint, @expirationTime, @p256dh, @auth, @subscriptionJson, @nowIso, @nowIso)
         ON CONFLICT(endpoint) DO UPDATE SET
           expiration_time = excluded.expiration_time,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           subscription_json = excluded.subscription_json,
           updated_at = excluded.updated_at`
      )
      .run({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        subscriptionJson: JSON.stringify(subscription),
        nowIso
      });
  }

  deleteSubscription(endpoint: string): void {
    this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  listSubscriptions(): PushSubscriptionPayload[] {
    const rows = this.db
      .prepare("SELECT subscription_json FROM push_subscriptions ORDER BY created_at ASC, endpoint ASC")
      .all() as PushSubscriptionRow[];
    return rows.flatMap((row) => {
      const subscription = PushSubscriptionPayloadSchema.safeParse(JSON.parse(row.subscription_json));
      return subscription.success ? [subscription.data] : [];
    });
  }

  getVapidDetails(): PushVapidDetails {
    const configured = this.getConfiguredKeys();
    if (configured) {
      return {
        subject: "mailto:pi-postbox@example.invalid",
        publicKey: configured.publicKey,
        privateKey: configured.privateKey
      };
    }

    const generated = this.getOrCreateGeneratedKeys();
    return {
      subject: "mailto:pi-postbox@example.invalid",
      publicKey: generated.public_key,
      privateKey: generated.private_key
    };
  }

  private getConfiguredKeys(): { publicKey: string; privateKey: string } | undefined {
    const publicKey = this.options.publicKey ?? process.env.PI_POSTBOX_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
    const privateKey = this.options.privateKey ?? process.env.PI_POSTBOX_VAPID_PRIVATE_KEY ?? process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return undefined;
    return { publicKey, privateKey };
  }

  private getOrCreateGeneratedKeys(): VapidKeyRow {
    const existing = this.db.prepare("SELECT public_key, private_key, source FROM push_vapid_keys WHERE id = 'default'").get() as
      | VapidKeyRow
      | undefined;
    if (existing) return existing;

    const keys = webPush.generateVAPIDKeys();
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO push_vapid_keys (id, public_key, private_key, source, created_at, updated_at)
         VALUES ('default', @publicKey, @privateKey, 'generated', @nowIso, @nowIso)`
      )
      .run({ publicKey: keys.publicKey, privateKey: keys.privateKey, nowIso });

    return {
      public_key: keys.publicKey,
      private_key: keys.privateKey,
      source: "generated"
    };
  }
}
