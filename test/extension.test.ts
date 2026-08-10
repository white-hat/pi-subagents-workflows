import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerWorkflowExtension from "../index.ts";
import { parseWorkflowCommand } from "../src/command.ts";

class Events {
  handlers = new Map<string, Set<(value: unknown) => void>>();
  emitted: Array<{ event: string; value: unknown }> = [];
  on(event: string, handler: (value: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }
  emit(event: string, value: unknown): void {
    this.emitted.push({ event, value });
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }
}

function createWorkflow(root: string): void {
  const directory = join(root, "review");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "workflow.json"), JSON.stringify({
    name: "review",
    description: "Review a target",
    parameters: { target: { type: "string", required: true } },
  }));
  writeFileSync(join(directory, "script.js"), "return args.target;");
}

test("command parser accepts list, show, and JSON run arguments", () => {
  assert.deepEqual(parseWorkflowCommand("list"), { action: "list" });
  assert.deepEqual(parseWorkflowCommand("show review"), { action: "show", name: "review" });
  assert.deepEqual(parseWorkflowCommand('run review {"target":"src"}'), {
    action: "run",
    name: "review",
    args: { target: "src" },
  });
  assert.deepEqual(parseWorkflowCommand("run review target=src/auth"), {
    action: "run",
    name: "review",
    args: { target: "src/auth" },
  });
  assert.deepEqual(
    parseWorkflowCommand(`run review target="src/my auth" depth=3 strict=true note='a=b'`),
    {
      action: "run",
      name: "review",
      args: { target: "src/my auth", depth: 3, strict: true, note: "a=b" },
    },
  );
  assert.throws(() => parseWorkflowCommand("run review nope"), /key=value/i);
});

test("registered tool discovers and launches a saved workflow through pi-subagents RPC", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-extension-"));
  const userRoot = join(root, "user");
  createWorkflow(userRoot);
  const events = new Events();
  let registeredTool: { execute: (...args: any[]) => Promise<any> } | undefined;
  const commands: string[] = [];
  const pi = {
    events,
    registerTool(tool: typeof registeredTool) { registeredTool = tool; },
    registerCommand(name: string) { commands.push(name); },
    on() {},
  };
  events.on("subagents:rpc:v1:request", (raw) => {
    const request = raw as { requestId: string };
    events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success: true,
      data: { text: "Async workflow started", details: { runId: "run-1" } },
    });
  });

  registerWorkflowExtension(pi as never, { packageRoot: join(root, "package"), userRoot });

  assert.ok(registeredTool);
  assert.deepEqual(commands, ["workflow"]);
  const ctx = {
    cwd: join(root, "project"),
    isProjectTrusted: () => true,
  };
  mkdirSync(ctx.cwd);
  const result = await registeredTool!.execute(
    "tool-1",
    { action: "run", name: "review", args: { target: "src" } },
    new AbortController().signal,
    undefined,
    ctx,
  );

  assert.equal(result.content[0].text, "Async workflow started");
  const rpc = events.emitted.find((entry) => entry.event === "subagents:rpc:v1:request")?.value as {
    params: { workflowScript: string; cwd: string };
  };
  assert.match(rpc.params.workflowScript, /const args = Object\.freeze/);
  assert.match(rpc.params.workflowScript, /target\\\":\\\"src/);
  assert.equal(rpc.params.cwd, realpathSync(ctx.cwd));
});

test("project discovery does not walk into an unverified ancestor", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-trust-"));
  const projectWorkflows = join(root, ".pi", "subagent-workflows");
  createWorkflow(projectWorkflows);
  const nestedCwd = join(root, "nested");
  mkdirSync(nestedCwd);
  const events = new Events();
  let registeredTool: { execute: (...args: any[]) => Promise<any> } | undefined;
  registerWorkflowExtension({
    events,
    registerTool(tool: typeof registeredTool) { registeredTool = tool; },
    registerCommand() {},
    on() {},
  } as never, { packageRoot: join(root, "package"), userRoot: join(root, "user") });

  const result = await registeredTool!.execute(
    "tool-list",
    { action: "list" },
    new AbortController().signal,
    undefined,
    { cwd: nestedCwd, isProjectTrusted: () => true },
  );

  assert.match(result.content[0].text, /No saved/);
  assert.doesNotMatch(result.content[0].text, /review/);
});

test("slash command completes workflow names and parameters after session start", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-workflows-complete-"));
  const userRoot = join(root, "user");
  createWorkflow(userRoot);
  let command: { getArgumentCompletions?: (prefix: string) => unknown } | undefined;
  let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
  registerWorkflowExtension({
    events: new Events(),
    registerTool() {},
    registerCommand(_name: string, options: typeof command) { command = options; },
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as never, { packageRoot: join(root, "package"), userRoot });

  assert.equal(command?.getArgumentCompletions?.("run "), null, "no cwd before session start");
  sessionStart?.({}, { cwd: root, isProjectTrusted: () => false });
  assert.deepEqual(command?.getArgumentCompletions?.("run rev"), [
    { value: "run review ", label: "review", description: "user: Review a target" },
  ]);
  assert.deepEqual(command?.getArgumentCompletions?.("run review "), [
    { value: "run review target=", label: "target=", description: "string · required" },
  ]);
});

test("extension does not register inside a pi-subagents child", () => {
  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = "1";
  const calls: string[] = [];
  try {
    registerWorkflowExtension({
      events: new Events(),
      registerTool() { calls.push("tool"); },
      registerCommand() { calls.push("command"); },
      on() {},
    } as never);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }
  assert.deepEqual(calls, []);
});
