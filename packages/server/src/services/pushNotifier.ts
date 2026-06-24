import type { AskRequestSnapshot, PushSubscriptionPayload, SessionSnapshot } from "@pi-postbox/protocol";
import type { RequestOptions as WebPushRequestOptions } from "web-push";
import webPush from "web-push";
import type { PushStore } from "./pushStore.js";
import type { SessionStore } from "./sessionStore.js";

export interface PushSender {
  sendNotification(subscription: PushSubscriptionPayload, payload: string, options?: WebPushRequestOptions): Promise<unknown>;
}

export class PushNotifier {
  constructor(
    private readonly pushStore: PushStore,
    private readonly sessionStore: SessionStore,
    private readonly pushSender: PushSender = webPush
  ) {}

  async notifyNewPendingAsk(request: AskRequestSnapshot): Promise<void> {
    if (request.status !== "pending") return;

    const subscriptions = this.pushStore.listSubscriptions();
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify(this.buildNewAskPayload(request, this.findSession(request.sessionId)));
    const sendOptions: WebPushRequestOptions = {
      vapidDetails: this.pushStore.getVapidDetails()
    };

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.pushSender.sendNotification(subscription, payload, sendOptions);
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

function isGonePushError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = "statusCode" in error ? (error as { statusCode?: unknown }).statusCode : undefined;
  return statusCode === 404 || statusCode === 410;
}
