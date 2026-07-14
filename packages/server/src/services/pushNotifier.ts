import type { AskRequestSnapshot, AskResult, PushSubscriptionPayload, SessionSnapshot } from "@pi-postbox/protocol";
import type { RequestOptions as WebPushRequestOptions } from "web-push";
import webPush from "web-push";
import { isUnregisteredFcmError, type FcmSender } from "./fcmSender.js";
import type { PushStore } from "./pushStore.js";
import type { SessionStore } from "./sessionStore.js";

export interface PushSender {
  sendNotification(subscription: PushSubscriptionPayload, payload: string, options?: WebPushRequestOptions): Promise<unknown>;
}

export class PushNotifier {
  constructor(
    private readonly pushStore: PushStore,
    private readonly sessionStore: SessionStore,
    private readonly pushSender: PushSender = webPush,
    private readonly fcmSender?: FcmSender
  ) {}

  async notifyNewPendingAsk(request: AskRequestSnapshot): Promise<void> {
    if (request.status !== "pending") return;

    const payload = this.buildNewAskPayload(request, this.findSession(request.sessionId));
    await Promise.all([this.notifyWebPushSubscriptions(payload), this.notifyFcmTokens(buildFcmData(payload))]);
  }

  /**
   * Data-only fanout after an ask leaves the pending state (answered, cancelled, or expired) so
   * clients can dismiss any still-visible notification for it. Never renders a user-facing alert.
   */
  async notifyAskResolved(result: AskResult): Promise<void> {
    const payload: ResolvedAskPushPayload = {
      data: { type: "ask.resolved", requestId: result.requestId }
    };
    await Promise.all([this.notifyWebPushSubscriptions(payload), this.notifyFcmTokens(payload.data)]);
  }

  private async notifyWebPushSubscriptions(payload: NewAskPushPayload | ResolvedAskPushPayload): Promise<void> {
    const subscriptions = this.pushStore.listSubscriptions();
    if (subscriptions.length === 0) return;

    const serializedPayload = JSON.stringify(payload);
    const sendOptions: WebPushRequestOptions = {
      vapidDetails: this.pushStore.getVapidDetails()
    };

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.pushSender.sendNotification(subscription, serializedPayload, sendOptions);
        } catch (error) {
          if (isGonePushError(error)) {
            this.pushStore.deleteSubscription(subscription.endpoint);
            return;
          }
          throw error;
        }
      })
    );
  }

  private async notifyFcmTokens(data: Record<string, string>): Promise<void> {
    if (!this.fcmSender) return;

    const tokens = this.pushStore.listFcmTokens();
    if (tokens.length === 0) return;

    const fcmSender = this.fcmSender;

    await Promise.all(
      tokens.map(async ({ token }) => {
        try {
          await fcmSender.send(token, { data });
        } catch (error) {
          if (isUnregisteredFcmError(error)) {
            this.pushStore.deleteFcmToken(token);
            return;
          }
          throw error;
        }
      })
    );
  }

  private findSession(sessionId: string): SessionSnapshot | undefined {
    return this.sessionStore.snapshot().sessions.find((session) => session.sessionId === sessionId);
  }

  private buildNewAskPayload(request: AskRequestSnapshot, session: SessionSnapshot | undefined): NewAskPushPayload {
    const projectName = session?.projectName;
    const sessionTitle = session?.title;
    const contextLabel = [projectName, sessionTitle].filter(Boolean).join(" · ");

    return {
      title: "New Postbox question",
      body: contextLabel ? `${contextLabel} needs your input.` : "A Postbox session needs your input.",
      data: {
        type: "ask.created",
        requestId: request.requestId,
        sessionId: request.sessionId,
        projectId: session?.projectId,
        projectName,
        sessionTitle
      }
    };
  }
}

interface NewAskPushPayload {
  title: string;
  body: string;
  data: {
    type: "ask.created";
    requestId: string;
    sessionId: string;
    projectId?: string;
    projectName?: string;
    sessionTitle?: string;
  };
}

interface ResolvedAskPushPayload {
  data: {
    type: "ask.resolved";
    requestId: string;
  };
}

// FCM data messages only carry string values; the Android app rebuilds the notification from these keys.
function buildFcmData(payload: NewAskPushPayload): Record<string, string> {
  const data: Record<string, string> = {
    type: payload.data.type,
    requestId: payload.data.requestId,
    sessionId: payload.data.sessionId,
    title: payload.title,
    body: payload.body
  };
  if (payload.data.projectId) data.projectId = payload.data.projectId;
  if (payload.data.projectName) data.projectName = payload.data.projectName;
  if (payload.data.sessionTitle) data.sessionTitle = payload.data.sessionTitle;
  return data;
}

function isGonePushError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = "statusCode" in error ? (error as { statusCode?: unknown }).statusCode : undefined;
  return statusCode === 404 || statusCode === 410;
}
