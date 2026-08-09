import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkflowScript, resolveWorkflowArguments } from "../src/workflow.ts";
import type { SavedWorkflow } from "../src/types.ts";

const workflow: SavedWorkflow = {
  name: "review",
  description: "Review a target",
  scope: "user",
  directory: "/tmp/review",
  manifestPath: "/tmp/review/workflow.json",
  scriptPath: "/tmp/review/script.js",
  parameters: {
    target: { type: "string", required: true },
    count: { type: "number", default: 2 },
    verbose: { type: "boolean", default: false },
  },
};

test("workflow arguments apply defaults and reject unknown or mistyped values", () => {
  assert.deepEqual(resolveWorkflowArguments(workflow, { target: "src" }), {
    target: "src",
    count: 2,
    verbose: false,
  });
  assert.throws(() => resolveWorkflowArguments(workflow, {}), /target.*required/i);
  assert.throws(() => resolveWorkflowArguments(workflow, { target: "src", count: "2" }), /count.*number/i);
  assert.throws(() => resolveWorkflowArguments(workflow, { target: "src", surprise: true }), /unknown.*surprise/i);
  assert.throws(() => resolveWorkflowArguments(workflow, { target: "src", toString: "shadow" }), /unknown.*toString/i);
});

test("workflow script injects JSON-safe args and cwd without interpolation", () => {
  const script = buildWorkflowScript("return { args, cwd };", {
    args: { target: "`); throw new Error('escape') //", count: 2, verbose: false },
    cwd: "/tmp/project",
  });

  assert.match(script, /^const args = Object\.freeze\(/);
  assert.match(script, /const cwd = "\/tmp\/project";/);
  assert.match(script, /return \{ args, cwd \};/);
  assert.doesNotMatch(script, /const args = Object\.freeze\(`\)/);
});
