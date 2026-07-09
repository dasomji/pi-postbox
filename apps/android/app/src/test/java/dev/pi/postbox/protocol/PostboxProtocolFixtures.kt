package dev.pi.postbox.protocol

internal fun representativeStateJson(
    timestamp: String = "2026-06-25T12:00:00.000Z",
    requestId: String = "ask-protocol-1",
    requestStatus: String = "pending",
    resolvedAt: String? = null,
    resultJson: String? = null
): String = """
    {
      "sessions": [
        {
          "sessionId": "session-1",
          "title": "Native Android protocol client",
          "machineId": "machine-1",
          "machineName": "Studio Mac",
          "hostname": "studio.local",
          "projectId": "project-1",
          "projectName": "Postbox",
          "projectDetectedName": "pi-postbox",
          "projectDescription": "Tailnet-private decision dashboard",
          "projectIcon": {
            "hash": "sha256:test-icon",
            "dataUrl": "data:image/svg+xml;base64,PHN2Zy8+",
            "mediaType": "image/svg+xml",
            "sizeBytes": 6,
            "futureIconField": "ignored"
          },
          "cwd": "/workspaces/postbox",
          "gitRoot": "/workspaces/postbox",
          "repoName": "pi-postbox",
          "branch": "feature/native-android",
          "headSha": "abc123",
          "isDirty": true,
          "worktreePath": "/worktrees/native-android",
          "semanticState": "blocked",
          "presence": "live",
          "lastHeartbeatAt": "2026-06-25T11:59:59.000Z",
          "connectedAt": "2026-06-25T11:55:00.000Z",
          "updatedAt": "2026-06-25T12:00:00.000Z",
          "unknownSessionField": { "must": "not fail parsing" }
        }
      ],
      "requests": [
        {
          "requestId": "$requestId",
          "sessionId": "session-1",
          "mode": "multi",
          "question": {
            "prompt": "Choose protocol client behavior",
            "context": "Native app needs to match the server contract.",
            "relevance": "Android users need live decisions.",
            "decisionImpact": "Defines the first public client boundary.",
            "futureQuestionField": "ignored"
          },
          "options": [
            {
              "value": "kotlinx",
              "label": "Use Kotlin serialization",
              "description": "Generate small DTOs backed by kotlinx.serialization.",
              "meaning": "Stay idiomatic on Android.",
              "context": "Existing project already has the dependency.",
              "futureOptionField": "ignored"
            },
            {
              "value": "manual",
              "label": "Manual parsing"
            }
          ],
          "context": {
            "codebaseContext": "Fastify server with shared protocol schemas.",
            "problemContext": "Remote asks must preserve decision context for a future interviewer.",
            "additionalInfo": [
              {
                "kind": "code",
                "title": "Route",
                "content": "POST /api/requests/:id/answer",
                "language": "ts",
                "futureContextField": "ignored"
              }
            ],
            "futureHandoffField": "ignored"
          },
          "forkReference": {
            "agentSessionId": "native-session-1",
            "agentSessionPath": "/tmp/native-session.jsonl",
            "leafId": "leaf-1",
            "cwd": "/workspaces/postbox",
            "model": "test-model",
            "futureForkField": "ignored"
          },
          "status": "$requestStatus",
          "createdAt": "2026-06-25T11:58:00.000Z",
          "expiresAt": "2026-06-25T12:30:00.000Z"${resolvedAt?.let { ",\n          \"resolvedAt\": \"$it\"" }.orEmpty()}${resultJson?.let { ",\n          \"result\": $it" }.orEmpty()},
          "unknownRequestField": ["ignored"]
        }
      ],
      "timestamp": "$timestamp",
      "unknownTopLevel": { "newServerField": true }
    }
""".trimIndent()

internal fun compactJson(json: String): String = json.lineSequence().joinToString(separator = "") { it.trim() }
