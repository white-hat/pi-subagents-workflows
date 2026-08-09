import assert from "node:assert/strict";
import test from "node:test";

import { executeWorkflowRequest } from "../src/service.ts";
import type { SavedWorkflow } from "../src/types.ts";

const events = { on() {}, emit() {} };

test("list output and details stay bounded", async () => {
  const workflows = new Map<string, SavedWorkflow>();
  for (let index = 0; index < 300; index += 1) {
    const name = `workflow-${String(index).padStart(3, "0")}`;
    workflows.set(name, {
      name,
      description: "x".repeat(1_000),
      scope: "user",
      directory: `/tmp/${name}`,
      manifestPath: `/tmp/${name}/workflow.json`,
      scriptPath: `/tmp/${name}/script.js`,
      parameters: {},
    });
  }

  const result = await executeWorkflowRequest(
    { action: "list" },
    { cwd: "/tmp", events, registry: { workflows, diagnostics: [] } },
  );

  assert.ok(Buffer.byteLength(result.text) < 52_000);
  assert.match(result.text, /Output truncated/);
  assert.equal((result.details.workflows as unknown[]).length, 256);
});
