import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface FcmDataMessage {
  data: Record<string, string>;
}

export interface FcmSender {
  send(token: string, message: FcmDataMessage): Promise<void>;
}

export class FcmSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode?: string
  ) {
    super(message);
    this.name = "FcmSendError";
  }
}

export function isUnregisteredFcmError(error: unknown): boolean {
  if (!(error instanceof FcmSendError)) return false;
  // 404/UNREGISTERED: token no longer valid. 403/SENDER_ID_MISMATCH: token belongs to another Firebase project.
  return error.statusCode === 404 || error.errorCode === "UNREGISTERED" || error.errorCode === "SENDER_ID_MISMATCH";
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface CachedAccessToken {
  value: string;
  expiresAtMs: number;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

export class HttpV1FcmSender implements FcmSender {
  private serviceAccountPromise?: Promise<ServiceAccount>;
  private cachedAccessToken?: CachedAccessToken;

  constructor(
    private readonly serviceAccountPath: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  async send(token: string, message: FcmDataMessage): Promise<void> {
    const serviceAccount = await this.loadServiceAccount();
    const accessToken = await this.getAccessToken(serviceAccount);

    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          android: { priority: "HIGH" },
          data: message.data
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new FcmSendError(`FCM send failed with HTTP ${response.status}`, response.status, parseFcmErrorCode(body));
    }
  }

  private loadServiceAccount(): Promise<ServiceAccount> {
    this.serviceAccountPromise ??= readFile(this.serviceAccountPath, "utf8").then((contents) => {
      const parsed = JSON.parse(contents) as Partial<ServiceAccount>;
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new Error(`FCM service account file ${this.serviceAccountPath} is missing project_id, client_email, or private_key.`);
      }
      return parsed as ServiceAccount;
    });
    return this.serviceAccountPromise;
  }

  private async getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
    const nowMs = this.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - ACCESS_TOKEN_REFRESH_MARGIN_MS > nowMs) {
      return this.cachedAccessToken.value;
    }

    const issuedAtSeconds = Math.floor(nowMs / 1000);
    const assertion = signServiceAccountJwt(serviceAccount, issuedAtSeconds);

    const response = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`FCM OAuth token exchange failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const tokenResponse = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!tokenResponse.access_token) {
      throw new Error("FCM OAuth token exchange returned no access_token.");
    }

    this.cachedAccessToken = {
      value: tokenResponse.access_token,
      expiresAtMs: nowMs + (tokenResponse.expires_in ?? ACCESS_TOKEN_LIFETIME_SECONDS) * 1000
    };
    return this.cachedAccessToken.value;
  }
}

function signServiceAccountJwt(serviceAccount: ServiceAccount, issuedAtSeconds: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + ACCESS_TOKEN_LIFETIME_SECONDS
    })
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(serviceAccount.private_key).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function parseFcmErrorCode(responseBody: string): string | undefined {
  try {
    const parsed = JSON.parse(responseBody) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    };
    const fcmErrorCode = parsed.error?.details?.find((detail) => detail.errorCode)?.errorCode;
    return fcmErrorCode ?? parsed.error?.status;
  } catch {
    return undefined;
  }
}

export function createFcmSenderFromServiceAccountPath(serviceAccountPath: string | undefined): FcmSender | undefined {
  if (!serviceAccountPath) return undefined;
  return new HttpV1FcmSender(serviceAccountPath);
}
