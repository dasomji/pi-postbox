import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  discriminatorValues,
  listProtocolSourceModules,
  readServerPackageVersion
} from "./android-contract-inputs.mjs";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const protocol = await import(pathToFileURL(resolve(root, "packages/protocol/dist/index.js")));
const {
  PROTOCOL_VERSION,
  HealthResponseSchema,
  VersionedStateSnapshotSchema,
  AskResultSchema,
  AskModeSchema,
  AskOptionProvenanceSchema,
  AskStatusSchema,
  SemanticStateSchema,
  PresenceStateSchema,
  QuestionChatStateSchema,
  QuestionChatAvailabilityCodeSchema,
  QuestionChatAssistantStatusSchema,
  QuestionChatToolStateSchema,
  QuestionChatRepositoryToolNameSchema,
  QuestionChatPostboxToolNameSchema,
  QuestionChatModelSourceSchema,
  QuestionChatSendModeSchema,
  VersionedAskMutationResponseSchema,
  VersionedRequestErrorResponseSchema,
  VersionedQuestionChatActivationResponseSchema,
  VersionedQuestionChatSnapshotHttpResponseSchema,
  VersionedQuestionChatSendHttpResponseSchema,
  VersionedQuestionChatStopHttpResponseSchema,
  VersionedQuestionChatStreamEventSchema,
  ProtocolMessageMetadataSchema,
  FcmPostboxDataSchema
} = protocol;

const androidBuild = await readFile(resolve(root, "apps/android/app/build.gradle.kts"), "utf8");
const androidVersionName = androidBuild.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
const androidVersionCode = Number(androidBuild.match(/versionCode\s*=\s*(\d+)/)?.[1]);
if (!androidVersionName || !Number.isInteger(androidVersionCode)) throw new Error("Unable to read Android version identity");

const contractSources = await listProtocolSourceModules(root);
const sourceText = await Promise.all(contractSources.map((file) => readFile(resolve(root, "packages/protocol/src", file), "utf8")));
const fingerprint = createHash("sha256")
  .update(contractSources.map((file, index) => `${file}\n${sourceText[index]}`).join("\n---\n"))
  .digest("hex");

const wireValues = {
  semanticStates: SemanticStateSchema.options,
  presenceStates: PresenceStateSchema.options,
  askModes: AskModeSchema.options,
  askStatuses: AskStatusSchema.options,
  askResultStatuses: discriminatorValues(AskResultSchema, "status"),
  askOptionProvenances: [AskOptionProvenanceSchema.value],
  questionChatStates: QuestionChatStateSchema.options,
  questionChatAvailabilityCodes: QuestionChatAvailabilityCodeSchema.options,
  questionChatAssistantStatuses: QuestionChatAssistantStatusSchema.options,
  questionChatToolStates: QuestionChatToolStateSchema.options,
  questionChatToolNames: [...QuestionChatRepositoryToolNameSchema.options, QuestionChatPostboxToolNameSchema.value],
  questionChatEventTypes: discriminatorValues(VersionedQuestionChatStreamEventSchema, "type"),
  questionChatModelSources: QuestionChatModelSourceSchema.options,
  questionChatSendModes: QuestionChatSendModeSchema.options,
  fcmTypes: discriminatorValues(FcmPostboxDataSchema, "type")
};

const owner = { harness: "pi", ownerId: "11111111-1111-4111-8111-111111111111" };
const baseRequest = {
  requestId: "ask-contract-1", sessionId: "session-contract-1", revision: 2, ownerRevision: 1,
  creator: owner, owner, mode: "single", question: { prompt: "Choose a contract fixture", ambiguity: "Which branch should Android decode?" },
  options: [{ value: "yes", label: "Yes", provenance: AskOptionProvenanceSchema.value }], status: "pending", createdAt: "2026-08-25T12:00:00.000Z",
  parentQuestionId: "ask-parent-1", repository: { repositoryId: "repo-1" },
  worktree: { worktreeId: "worktree-1", machineId: "machine-1", path: "/repo" }, feature: { featureId: "feature-1", name: "Protocol" }
};
const sessionFor = (semanticState, presence = "live") => ({
  sessionId: `session-${semanticState}`, machineId: "machine-1", machineName: "Workstation", hostname: "host",
  projectId: "project-1", projectName: "Postbox", cwd: "/repo", semanticState, presence,
  updatedAt: "2026-08-25T12:00:00.000Z", repository: { repositoryId: "repo-1" },
  worktree: { worktreeId: "worktree-1", machineId: "machine-1", path: "/repo" }, feature: { featureId: "feature-1", name: "Protocol" }
});
const stateFixtures = wireValues.semanticStates.map((semanticState, index) => ({
  protocolVersion: PROTOCOL_VERSION,
  sessions: [sessionFor(semanticState, wireValues.presenceStates[index % wireValues.presenceStates.length])],
  requests: wireValues.askStatuses.map((status, requestIndex) => ({
    ...baseRequest,
    requestId: `ask-${status}`,
    ...(requestIndex === 0 ? { images: [{ imageId: "12345678-1234-4123-8123-123456789abc", mediaType: "image/png", byteSize: 128, width: 32, height: 16, alt: "Contract screenshot", caption: "First evidence" }, { imageId: "12345678-1234-4123-8123-123456789abd", mediaType: "image/webp", byteSize: 96, width: 16, height: 32, alt: "Second evidence" }] } : {}),
    mode: wireValues.askModes[requestIndex % wireValues.askModes.length],
    status
  })),
  timestamp: "2026-08-25T12:00:00.000Z"
}));
stateFixtures.forEach((fixture) => VersionedStateSnapshotSchema.parse(fixture));

const serverVersion = await readServerPackageVersion(root);
const health = {
  ok: true, service: "pi-postbox", version: serverVersion, buildId: `${serverVersion}+contract`, protocolVersion: PROTOCOL_VERSION,
  profile: { kind: "production", id: "production" }, uptimeMs: 123, timestamp: "2026-08-25T12:00:00.000Z"
};
HealthResponseSchema.parse(health);

const chatSnapshot = {
  requestId: "ask-contract-1", state: "ready", forkKind: "exact", model: { id: "test/model", source: "originating" }, sequence: 0,
  messages: [
    { id: "user-1", role: "user", text: "Explain this", status: "final" },
    ...wireValues.questionChatAssistantStatuses.map((status) => ({ id: `assistant-${status}`, role: "assistant", text: "Explanation", status }))
  ],
  tools: wireValues.questionChatToolStates.map((state, index) => ({
    id: `tool-${state}`, tool: wireValues.questionChatToolNames[index], target: "/repo/file", state
  }))
};
const unavailable = { status: "unavailable", error: { code: "extension_offline", message: "Extension is offline." } };
const questionChatHttp = [
  { kind: "activation.ready", payload: { protocolVersion: PROTOCOL_VERSION, status: "ready", snapshot: chatSnapshot } },
  { kind: "activation.unavailable", payload: { protocolVersion: PROTOCOL_VERSION, ...unavailable } },
  { kind: "snapshot.ready", payload: { protocolVersion: PROTOCOL_VERSION, status: "ready", snapshot: { ...chatSnapshot, model: { id: "test/default", source: "pi-default", fallbackReason: "Originating model unavailable" } } } },
  { kind: "snapshot.unavailable", payload: { protocolVersion: PROTOCOL_VERSION, ...unavailable } },
  { kind: "send.turn", payload: { protocolVersion: PROTOCOL_VERSION, status: "accepted", clientCommandId: "cmd-turn", mode: "turn" } },
  { kind: "send.steer", payload: { protocolVersion: PROTOCOL_VERSION, status: "accepted", clientCommandId: "cmd-steer", mode: "steer" } },
  { kind: "send.unavailable", payload: { protocolVersion: PROTOCOL_VERSION, ...unavailable } },
  { kind: "stop.accepted", payload: { protocolVersion: PROTOCOL_VERSION, status: "accepted", clientCommandId: "cmd-stop" } },
  { kind: "stop.unavailable", payload: { protocolVersion: PROTOCOL_VERSION, ...unavailable } }
];
for (const fixture of questionChatHttp) {
  if (fixture.kind.startsWith("activation")) VersionedQuestionChatActivationResponseSchema.parse(fixture.payload);
  else if (fixture.kind.startsWith("snapshot")) VersionedQuestionChatSnapshotHttpResponseSchema.parse(fixture.payload);
  else if (fixture.kind.startsWith("send")) VersionedQuestionChatSendHttpResponseSchema.parse(fixture.payload);
  else VersionedQuestionChatStopHttpResponseSchema.parse(fixture.payload);
}

const questionChatAvailability = wireValues.questionChatAvailabilityCodes.map((code) => ({
  protocolVersion: PROTOCOL_VERSION,
  status: "unavailable",
  error: { code, message: `Canonical ${code} response.` }
}));
questionChatAvailability.forEach((fixture) => VersionedQuestionChatActivationResponseSchema.parse(fixture));

let sequence = 0;
const versionEvent = (event) => ({ protocolVersion: PROTOCOL_VERSION, ...event });
const questionChatEvents = [
  ...wireValues.questionChatStates.map((state) => versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "lifecycle", state })),
  versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "message.started", message: { id: "user-start", role: "user", text: "Hello", status: "final" } }),
  ...wireValues.questionChatAssistantStatuses.map((status) => versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "message.started", message: { id: `assistant-start-${status}`, role: "assistant", text: "", status } })),
  versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "assistant.text.delta", messageId: "assistant-1", text: "delta" }),
  ...["final", "stopped", "interrupted"].map((status) => versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "message.finished", messageId: `assistant-${status}`, text: "done", status })),
  ...wireValues.questionChatToolNames.map((tool) => versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "tool.started", activity: { id: `running-${tool}`, tool, target: "/repo", state: "running" } })),
  ...["success", "error", "stale"].map((state) => versionEvent({ requestId: "ask-contract-1", sequence: ++sequence, type: "tool.finished", activity: { id: `finished-${state}`, tool: "repository_read", target: "/repo", state } })),
  versionEvent({ requestId: "ask-contract-1", type: "transport", state: "online" }),
  versionEvent({ requestId: "ask-contract-1", type: "transport", state: "offline" })
];
questionChatEvents.forEach((fixture) => VersionedQuestionChatStreamEventSchema.parse(fixture));

const answerCancel = [
  { kind: "answer.success", payload: { protocolVersion: PROTOCOL_VERSION, result: { status: "answered", requestId: "ask-contract-1", selectedValues: ["yes"], resolvedAt: "2026-08-25T12:01:00.000Z" }, request: { ...baseRequest, status: "answered", resolvedAt: "2026-08-25T12:01:00.000Z" } } },
  { kind: "cancel.success", payload: { protocolVersion: PROTOCOL_VERSION, result: { status: "cancelled", requestId: "ask-contract-1", resolvedAt: "2026-08-25T12:01:00.000Z" }, request: { ...baseRequest, status: "cancelled", resolvedAt: "2026-08-25T12:01:00.000Z" } } },
  { kind: "result.expired", payload: { protocolVersion: PROTOCOL_VERSION, result: { status: "expired", requestId: "ask-contract-1", resolvedAt: "2026-08-25T12:01:00.000Z" } } },
  { kind: "result.unavailable", payload: { protocolVersion: PROTOCOL_VERSION, result: { status: "unavailable", requestId: "ask-contract-1", resolvedAt: "2026-08-25T12:01:00.000Z" } } },
  { kind: "request.error", payload: { protocolVersion: PROTOCOL_VERSION, error: "request_already_resolved", message: "Already resolved." } }
];
answerCancel.forEach(({ kind, payload }) => {
  ProtocolMessageMetadataSchema.parse(payload);
  if (payload.result) AskResultSchema.parse(payload.result);
  if (kind.endsWith(".success")) VersionedAskMutationResponseSchema.parse(payload);
  if (kind === "request.error") VersionedRequestErrorResponseSchema.parse(payload);
});

const fcm = wireValues.fcmTypes.map((type) => {
  switch (type) {
    case "ask.created":
      return { protocolVersion: PROTOCOL_VERSION, type, requestId: "ask-contract-1", sessionId: "session-contract-1", title: "New Postbox question", body: "Postbox needs your input." };
    case "ask.resolved":
      return { protocolVersion: PROTOCOL_VERSION, type, requestId: "ask-contract-1" };
    default:
      throw new Error(`Missing canonical FCM fixture mapping for ${type}`);
  }
});
fcm.forEach((fixture) => FcmPostboxDataSchema.parse(fixture));

const contract = {
  protocolVersion: PROTOCOL_VERSION,
  fingerprint,
  androidVersionName,
  androidVersionCode,
  wireValues,
  fixtures: { health, states: stateFixtures, answerCancel, questionChatHttp, questionChatAvailability, questionChatEvents, fcm }
};
const jsonOutput = `${JSON.stringify(contract, null, 2)}\n`;
const kotlinList = (values) => `listOf(${values.map((value) => JSON.stringify(value)).join(", ")})`;
const kotlinOutput = `package dev.pi.postbox.protocol

/** Generated by scripts/generate-android-protocol-contract.mjs. Do not edit. */
object GeneratedPostboxProtocolContract {
    const val SUPPORTED_PROTOCOL_VERSION: String = ${JSON.stringify(PROTOCOL_VERSION)}
    const val CONTRACT_FINGERPRINT: String = ${JSON.stringify(fingerprint)}
    val SEMANTIC_STATES: List<String> = ${kotlinList(wireValues.semanticStates)}
    val PRESENCE_STATES: List<String> = ${kotlinList(wireValues.presenceStates)}
    val ASK_MODES: List<String> = ${kotlinList(wireValues.askModes)}
    val ASK_STATUSES: List<String> = ${kotlinList(wireValues.askStatuses)}
    val ASK_RESULT_STATUSES: List<String> = ${kotlinList(wireValues.askResultStatuses)}
    val ASK_OPTION_PROVENANCES: List<String> = ${kotlinList(wireValues.askOptionProvenances)}
    val QUESTION_CHAT_STATES: List<String> = ${kotlinList(wireValues.questionChatStates)}
    val QUESTION_CHAT_AVAILABILITY_CODES: List<String> = ${kotlinList(wireValues.questionChatAvailabilityCodes)}
    val QUESTION_CHAT_ASSISTANT_STATUSES: List<String> = ${kotlinList(wireValues.questionChatAssistantStatuses)}
    val QUESTION_CHAT_TOOL_STATES: List<String> = ${kotlinList(wireValues.questionChatToolStates)}
    val QUESTION_CHAT_TOOL_NAMES: List<String> = ${kotlinList(wireValues.questionChatToolNames)}
    val QUESTION_CHAT_EVENT_TYPES: List<String> = ${kotlinList(wireValues.questionChatEventTypes)}
    val QUESTION_CHAT_MODEL_SOURCES: List<String> = ${kotlinList(wireValues.questionChatModelSources)}
    val QUESTION_CHAT_SEND_MODES: List<String> = ${kotlinList(wireValues.questionChatSendModes)}
    val FCM_TYPES: List<String> = ${kotlinList(wireValues.fcmTypes)}
}
`;

const fixturePath = resolve(root, "packages/protocol/fixtures/android/contract.json");
const kotlinPath = resolve(root, "apps/android/app/src/main/java/dev/pi/postbox/protocol/GeneratedPostboxProtocolContract.kt");
let committedFixture;
try {
  committedFixture = JSON.parse(execFileSync("git", ["show", "HEAD:packages/protocol/fixtures/android/contract.json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }));
} catch {
  committedFixture = undefined;
}
if (!check && committedFixture && committedFixture.protocolVersion === PROTOCOL_VERSION && committedFixture.fingerprint !== fingerprint) {
  throw new Error(`Android-facing contract changed under protocol ${PROTOCOL_VERSION}; bump PROTOCOL_VERSION before regeneration.`);
}

if (check) {
  const mismatches = [];
  for (const [path, expected] of [[fixturePath, jsonOutput], [kotlinPath, kotlinOutput]]) {
    const actual = existsSync(path) ? await readFile(path, "utf8") : "";
    if (actual !== expected) mismatches.push(path.slice(root.length + 1));
  }
  const docs = await readFile(resolve(root, "docs/protocol.md"), "utf8");
  if (!docs.includes(PROTOCOL_VERSION) || !docs.includes(androidVersionName)) mismatches.push("docs/protocol.md compatibility identity");
  if (mismatches.length > 0) throw new Error(`Stale Android protocol contract:\n- ${mismatches.join("\n- ")}\nRun npm run generate:android-protocol-contract.`);
  console.log(`Android protocol contract ${PROTOCOL_VERSION} (${fingerprint}) is current.`);
} else {
  await mkdir(resolve(root, "packages/protocol/fixtures/android"), { recursive: true });
  await writeFile(fixturePath, jsonOutput);
  await writeFile(kotlinPath, kotlinOutput);
  console.log(`Generated Android protocol contract ${PROTOCOL_VERSION} (${fingerprint}).`);
}
