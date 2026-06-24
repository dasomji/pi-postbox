import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

type SourceFile = {
  exists: boolean;
  text: string;
};

function readSource(relativePath: string): SourceFile {
  const path = resolve(srcDir, relativePath);
  if (!existsSync(path)) return { exists: false, text: "" };
  return { exists: true, text: readFileSync(path, "utf8") };
}

function hasNotificationPermissionRequest(source: string): boolean {
  return /Notification\s*\.\s*requestPermission\s*\(/.test(source);
}

describe("Unit 04 client notification subscription UI static contract", () => {
  it("mounts a notification subscription control in app chrome without requesting permission during startup", () => {
    const app = readSource("App.svelte").text;
    const sidebar = readSource("components/Sidebar.svelte").text;
    const main = readSource("main.ts").text;
    const notificationControl = readSource("components/NotificationSubscriptionControl.svelte");
    const startupSource = [main, app, sidebar].join("\n");
    const chromeSource = [app, sidebar].join("\n");

    expect({
      notificationControlComponentExists: notificationControl.exists,
      notificationControlImportedInChrome: /import\s+NotificationSubscriptionControl\s+from\s+["'][^"']*NotificationSubscriptionControl\.svelte["']/.test(
        chromeSource
      ),
      notificationControlRenderedInChrome: /<NotificationSubscriptionControl\b/.test(chromeSource),
      startupDoesNotRequestNotificationPermission: !hasNotificationPermissionRequest(startupSource)
    }).toEqual({
      notificationControlComponentExists: true,
      notificationControlImportedInChrome: true,
      notificationControlRenderedInChrome: true,
      startupDoesNotRequestNotificationPermission: true
    });
  });

  it("exposes user-visible states for unsupported, unavailable, permission denied, subscribed, and unsubscribed notifications", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;
    const helper = readSource("lib/pushNotifications.ts").text;
    const source = [component, helper].join("\n");

    expect({
      showsUnsupportedState: /unsupported/i.test(source),
      showsUnavailableState: /unavailable/i.test(source),
      showsPermissionDeniedState: /permission\s*denied|permission-denied|denied/i.test(source),
      showsSubscribedState: /\bsubscribed\b/i.test(source),
      showsUnsubscribedState: /\bunsubscribed\b/i.test(source)
    }).toEqual({
      showsUnsupportedState: true,
      showsUnavailableState: true,
      showsPermissionDeniedState: true,
      showsSubscribedState: true,
      showsUnsubscribedState: true
    });
  });

  it("explains dismissed notification permission instead of silently showing the same unsubscribed state", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;

    expect({
      handlesDefaultPermission: /permission\s*!==\s*["']granted["']/.test(component),
      explainsChooseAllow: /Permission was not granted\. Tap Enable and choose Allow to subscribe\./.test(component)
    }).toEqual({
      handlesDefaultPermission: true,
      explainsChooseAllow: true
    });
  });

  it("requests notification permission only from an explicit enable action", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;
    const helper = readSource("lib/pushNotifications.ts").text;
    const source = [component, helper].join("\n");
    const enableHandlerName =
      source.match(/(?:async\s+)?function\s+(\w*(?:enable|subscribe|request)\w*)\s*\([^)]*\)\s*[:\w\s<>]*\{[\s\S]*?Notification\s*\.\s*requestPermission\s*\(/i)?.[1] ??
      source.match(/const\s+(\w*(?:enable|subscribe|request)\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>[\s\S]*?Notification\s*\.\s*requestPermission\s*\(/i)?.[1] ??
      "";

    expect({
      rendersExplicitEnableButtonOrToggle: /<(?:button|input)\b[\s\S]*?(?:Enable notifications|Turn on notifications|aria-label=["'][^"']*(?:enable|turn on|notifications)|role=["']switch["'])/i.test(
        component
      ),
      requestsBrowserPermission: hasNotificationPermissionRequest(source),
      requestPermissionOutsideMountLifecycle: !/onMount\s*\([\s\S]*?Notification\s*\.\s*requestPermission\s*\(/.test(source),
      enableActionRequestsPermission: Boolean(enableHandlerName) && new RegExp(`on(?:click|change)=\\{${enableHandlerName}\\}`).test(component)
    }).toEqual({
      rendersExplicitEnableButtonOrToggle: true,
      requestsBrowserPermission: true,
      requestPermissionOutsideMountLifecycle: true,
      enableActionRequestsPermission: true
    });
  });

  it("subscribes with the VAPID public key from /api/push/config and POSTs the resulting browser subscription", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;
    const helper = readSource("lib/pushNotifications.ts").text;
    const api = readSource("api/postboxApi.ts").text;
    const source = [component, helper, api].join("\n");

    expect({
      fetchesPushConfig: /fetchPushConfig/.test(source) && /\/api\/push\/config/.test(api),
      waitsForServiceWorkerRegistration: /navigator\s*\.\s*serviceWorker\s*\.\s*ready|ServiceWorkerRegistration/i.test(source),
      callsPushManagerSubscribe: /\.pushManager\s*\.\s*subscribe\s*\(/.test(source),
      requiresUserVisibleNotifications: /userVisibleOnly\s*:\s*true/.test(source),
      passesApplicationServerKeyFromPublicKey: /applicationServerKey\s*:/i.test(source) && /publicKey/i.test(source) && /Uint8Array|urlBase64ToUint8Array|base64/i.test(source),
      postsSubscriptionToServer: /savePushSubscription/.test(source) && /\/api\/push\/subscriptions/.test(api)
    }).toEqual({
      fetchesPushConfig: true,
      waitsForServiceWorkerRegistration: true,
      callsPushManagerSubscribe: true,
      requiresUserVisibleNotifications: true,
      passesApplicationServerKeyFromPublicKey: true,
      postsSubscriptionToServer: true
    });
  });

  it("rolls back a browser subscription if saving it on the server fails", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;
    const helper = readSource("lib/pushNotifications.ts").text;
    const source = [component, helper].join("\n");

    expect({
      componentUsesSaveWithRollback: /savePushSubscriptionWithBrowserRollback\s*\(\s*subscription\s*,\s*savePushSubscription\s*\)/.test(component),
      helperRollsBackOnSaveFailure:
        /catch\s*\([^)]*\)\s*\{[\s\S]*rollbackSubscription\s*\(\s*\)[\s\S]*throw\s+error\s*;[\s\S]*\}/.test(helper),
      rollbackUnsubscribesBrowserSubscription: /unsubscribeFromBrowserPush/.test(source) && /\.unsubscribe\s*\(/.test(helper)
    }).toEqual({
      componentUsesSaveWithRollback: true,
      helperRollsBackOnSaveFailure: true,
      rollbackUnsubscribesBrowserSubscription: true
    });
  });

  it("announces async notification status changes to assistive technology", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;

    expect({
      statusMessageIsLiveRegion: /\{message\}[\s\S]*<\/p>/.test(component) && /role=["']status["']/.test(component) && /aria-live=["']polite["']/.test(component)
    }).toEqual({
      statusMessageIsLiveRegion: true
    });
  });

  it("unsubscribes the current browser subscription and DELETEs it from the server", () => {
    const component = readSource("components/NotificationSubscriptionControl.svelte").text;
    const helper = readSource("lib/pushNotifications.ts").text;
    const api = readSource("api/postboxApi.ts").text;
    const source = [component, helper, api].join("\n");

    expect({
      readsExistingSubscription: /\.pushManager\s*\.\s*getSubscription\s*\(/.test(source),
      callsBrowserUnsubscribe: /\.unsubscribe\s*\(/.test(source),
      deletesSubscriptionOnServer: /deletePushSubscription/.test(source) && /method\s*:\s*["']DELETE["']/.test(api),
      deletesByEndpoint: /endpoint/.test(source) && /JSON\.stringify\s*\(\s*\{\s*endpoint\s*\}/.test(api)
    }).toEqual({
      readsExistingSubscription: true,
      callsBrowserUnsubscribe: true,
      deletesSubscriptionOnServer: true,
      deletesByEndpoint: true
    });
  });
});
