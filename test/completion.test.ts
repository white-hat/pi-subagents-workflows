import assert from "node:assert/strict";
import test from "node:test";

import { completeWorkflowArguments } from "../src/completion.ts";
import type { SavedWorkflow } from "../src/types.ts";

const review: SavedWorkflow = {
  name: "review",
  description: "Review a target",
  scope: "project",
  directory: "/workflows/review",
  manifestPath: "/workflows/review/workflow.json",
  scriptPath: "/workflows/review/script.js",
  parameters: {
    target: { type: "string", required: true },
    depth: { type: "number", description: "Fan-out depth" },
  },
};
const research: SavedWorkflow = { ...review, name: "research", parameters: {} };
const workflows = [review, research];

function values(prefix: string): string[] | null {
  const items = completeWorkflowArguments(prefix, workflows);
  return items === null ? null : items.map((entry) => entry.value);
}

test("completes actions", () => {
  assert.deepEqual(values(""), ["list", "show ", "run "]);
  assert.deepEqual(values("r"), ["run "]);
});

test("completes workflow names for show and run", () => {
  assert.deepEqual(values("show re"), ["show review", "show research"]);
  assert.deepEqual(values("run rev"), ["run review "]);
  assert.equal(values("list "), null);
});

test("completes parameter names, skipping ones already supplied", () => {
  assert.deepEqual(values("run review "), ["run review target=", "run review depth="]);
  assert.deepEqual(values("run review d"), ["run review depth="]);
  assert.deepEqual(values("run review target=src "), ["run review target=src depth="]);
  assert.deepEqual(values("run research "), null);
});

test("stays quiet where a value, not a key, is being typed", () => {
  assert.equal(values("run review target=sr"), null);
  assert.equal(values('run review target="src my'), null);
  assert.equal(values("run review {"), null);
  assert.equal(values("run unknown "), null);
});

test("parameter items describe type and requiredness", () => {
  const items = completeWorkflowArguments("run review ", workflows) ?? [];
  assert.deepEqual(items[0], {
    value: "run review target=",
    label: "target=",
    description: "string · required",
  });
  assert.equal(items[1]?.description, "number · optional · Fan-out depth");
});
