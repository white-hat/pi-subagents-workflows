import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverWorkflows } from "../src/registry.ts";

function workflow(root: string, directory: string, description: string, script = "return args;"): void {
  const path = join(root, directory);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "workflow.json"), JSON.stringify({
    name: directory,
    description,
    parameters: {
      target: { type: "string", required: true },
      count: { type: "number", default: 2 },
    },
  }));
  writeFileSync(join(path, "script.js"), script);
}

test("project workflows override user and package workflows", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  const packageRoot = join(root, "package");
  const userRoot = join(root, "user");
  const projectRoot = join(root, "project");
  workflow(packageRoot, "review", "package");
  workflow(userRoot, "review", "user");
  workflow(projectRoot, "review", "project");
  workflow(userRoot, "research", "research");

  const result = discoverWorkflows({ packageRoot, userRoot, projectRoot });

  assert.equal(result.workflows.get("review")?.description, "project");
  assert.equal(result.workflows.get("review")?.scope, "project");
  assert.equal(result.workflows.get("research")?.scope, "user");
  assert.deepEqual(result.diagnostics, []);
});

test("an invalid higher-precedence workflow blocks fallback to a lower scope", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  const userRoot = join(root, "user");
  const projectRoot = join(root, "project");
  workflow(userRoot, "review", "user");
  workflow(projectRoot, "review", "project");
  writeFileSync(join(projectRoot, "review", "workflow.json"), "{broken");

  const result = discoverWorkflows({ userRoot, projectRoot });

  assert.equal(result.workflows.has("review"), false);
  assert.match(result.diagnostics[0] ?? "", /project.*review.*workflow\.json/i);
});

test("rejects oversized workflow scripts before loading them", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  workflow(root, "huge", "oversized", "x".repeat(1_048_577));

  const result = discoverWorkflows({ userRoot: root });

  assert.equal(result.workflows.has("huge"), false);
  assert.match(result.diagnostics[0] ?? "", /script.*1 MiB/i);
});

test("rejects prototype-mutating parameter names", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  workflow(root, "unsafe", "unsafe parameters");
  writeFileSync(
    join(root, "unsafe", "workflow.json"),
    '{"name":"unsafe","description":"unsafe","parameters":{"__proto__":{"type":"string"}}}',
  );

  const result = discoverWorkflows({ userRoot: root });

  assert.equal(result.workflows.has("unsafe"), false);
  assert.match(result.diagnostics[0] ?? "", /parameter.*__proto__.*reserved/i);
});

test("rejects manifests larger than 64 KiB", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  workflow(root, "huge-manifest", "small");
  writeFileSync(
    join(root, "huge-manifest", "workflow.json"),
    JSON.stringify({ name: "huge-manifest", description: "x".repeat(65_536) }),
  );

  const result = discoverWorkflows({ userRoot: root });

  assert.equal(result.workflows.has("huge-manifest"), false);
  assert.match(result.diagnostics[0] ?? "", /manifest.*64 KiB/i);
});

test("caps each discovery scope at 256 workflow directories", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-"));
  for (let index = 0; index < 257; index += 1) {
    workflow(root, `workflow-${String(index).padStart(3, "0")}`, "bounded");
  }

  const result = discoverWorkflows({ userRoot: root });

  assert.equal(result.workflows.size, 256);
  assert.match(result.diagnostics.at(-1) ?? "", /user.*256.*ignored/i);
});
