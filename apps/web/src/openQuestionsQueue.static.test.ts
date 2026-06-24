import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(resolve(srcDir, relativePath), "utf8");
}

describe("open questions queue", () => {
  it("uses the main empty selection state for an open question queue grouped by project", () => {
    const main = readSource("components/MainView.svelte");
    const queuePath = resolve(srcDir, "components/OpenQuestionsQueue.svelte");
    const queue = existsSync(queuePath) ? readFileSync(queuePath, "utf8") : "";

    expect({
      queueComponentExists: existsSync(queuePath),
      mainRendersQueueWhenNothingSelected: /import\s+OpenQuestionsQueue/.test(main) && /<OpenQuestionsQueue\s*\/>/.test(main),
      groupsByProject: /Map<string, QuestionProjectGroup>/.test(queue) && /projectId/.test(queue) && /projectName/.test(queue),
      usesPendingRequests: /store\.pendingRequests/.test(queue),
      rendersProjectSections: /{#each groups as group/.test(queue) && /<section/.test(queue),
      selectingQuestionOpensDetail: /onclick=\{\(\)\s*=>\s*store\.selectRequest\(item\.request\.requestId\)\}/.test(queue)
    }).toEqual({
      queueComponentExists: true,
      mainRendersQueueWhenNothingSelected: true,
      groupsByProject: true,
      usesPendingRequests: true,
      rendersProjectSections: true,
      selectingQuestionOpensDetail: true
    });
  });
});
