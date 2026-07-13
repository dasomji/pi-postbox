import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FcmSendError, HttpV1FcmSender, isUnregisteredFcmError } from "../src/services/fcmSender.js";

let dir: string;
let serviceAccountPath: string;
let publicKeyPem: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-postbox-fcm-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  serviceAccountPath = join(dir, "service-account.json");
  await writeFile(
    serviceAccountPath,
    JSON.stringify({
      project_id: "postbox-test",
      client_email: "sender@postbox-test.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    })
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function oauthAndFcmFetch(fcmResponses: Array<() => Response> = []): ReturnType<typeof vi.fn> {
  let fcmCall = 0;
  return vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return jsonResponse(200, { access_token: "test-access-token", expires_in: 3600 });
    }
    const respond = fcmResponses[fcmCall] ?? (() => jsonResponse(200, { name: "projects/postbox-test/messages/1" }));
    fcmCall += 1;
    return respond();
  });
}

describe("HttpV1FcmSender", () => {
  it("exchanges a signed service-account JWT for an access token and sends a data message", async () => {
    const fetchImpl = oauthAndFcmFetch();
    const sender = new HttpV1FcmSender(serviceAccountPath, fetchImpl as unknown as typeof fetch, () => 1_700_000_000_000);

    await sender.send("device-token-1", { data: { type: "ask.created", requestId: "ask-1" } });

    const oauthCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("oauth2"));
    expect(oauthCall).toBeDefined();
    const oauthBody = new URLSearchParams(String((oauthCall?.[1] as RequestInit).body));
    expect(oauthBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const assertion = oauthBody.get("assertion") ?? "";
    const [header, claims, signature] = assertion.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "sender@postbox-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_000_000 + 3600
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKeyPem, Buffer.from(signature, "base64url"))).toBe(true);

    const fcmCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("fcm.googleapis.com"));
    expect(String(fcmCall?.[0])).toBe("https://fcm.googleapis.com/v1/projects/postbox-test/messages:send");
    const fcmInit = fcmCall?.[1] as RequestInit;
    expect((fcmInit.headers as Record<string, string>).authorization).toBe("Bearer test-access-token");
    expect(JSON.parse(String(fcmInit.body))).toEqual({
      message: {
        token: "device-token-1",
        android: { priority: "HIGH" },
        data: { type: "ask.created", requestId: "ask-1" }
      }
    });
  });

  it("reuses the cached access token for subsequent sends", async () => {
    const fetchImpl = oauthAndFcmFetch();
    const sender = new HttpV1FcmSender(serviceAccountPath, fetchImpl as unknown as typeof fetch, () => 1_700_000_000_000);

    await sender.send("device-token-1", { data: { type: "ask.created", requestId: "ask-1" } });
    await sender.send("device-token-2", { data: { type: "ask.created", requestId: "ask-2" } });

    const oauthCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes("oauth2"));
    expect(oauthCalls).toHaveLength(1);
  });

  it("throws an FcmSendError carrying the FCM error code on failure responses", async () => {
    const fetchImpl = oauthAndFcmFetch([
      () =>
        jsonResponse(404, {
          error: {
            code: 404,
            status: "NOT_FOUND",
            details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }]
          }
        })
    ]);
    const sender = new HttpV1FcmSender(serviceAccountPath, fetchImpl as unknown as typeof fetch, () => 1_700_000_000_000);

    const failure = sender.send("stale-token", { data: { type: "ask.created", requestId: "ask-1" } });

    await expect(failure).rejects.toBeInstanceOf(FcmSendError);
    await expect(failure).rejects.toMatchObject({ statusCode: 404, errorCode: "UNREGISTERED" });
    await failure.catch((error: unknown) => expect(isUnregisteredFcmError(error)).toBe(true));
  });

  it("rejects service-account files missing required fields", async () => {
    await writeFile(serviceAccountPath, JSON.stringify({ project_id: "postbox-test" }));
    const sender = new HttpV1FcmSender(serviceAccountPath, oauthAndFcmFetch() as unknown as typeof fetch);

    await expect(sender.send("device-token-1", { data: {} })).rejects.toThrow(/missing project_id, client_email, or private_key/);
  });
});
