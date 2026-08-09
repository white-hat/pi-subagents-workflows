import assert from "node:assert/strict";
import test from "node:test";

import { callSubagentRpc } from "../src/rpc.ts";

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

test("RPC client subscribes before spawning and returns the correlated reply", async () => {
  const events = new Events();
  events.on("subagents:rpc:v1:request", (raw) => {
    const request = raw as { requestId: string };
    events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success: true,
      data: { text: "Async workflow started", details: { runId: "run-1" } },
    });
  });

  const reply = await callSubagentRpc(events, "spawn", {
    workflowScript: "return null;",
    cwd: "/tmp/project",
  });

  assert.equal(reply.text, "Async workflow started");
  assert.equal((reply.details as { runId: string }).runId, "run-1");
  const request = events.emitted.find((entry) => entry.event === "subagents:rpc:v1:request")?.value as Record<string, unknown>;
  assert.equal(request.version, 1);
  assert.equal(request.method, "spawn");
});

test("RPC client reports pi-subagents errors", async () => {
  const events = new Events();
  events.on("subagents:rpc:v1:request", (raw) => {
    const request = raw as { requestId: string };
    events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success: false,
      error: { code: "invalid_params", message: "bad workflow" },
    });
  });

  await assert.rejects(() => callSubagentRpc(events, "spawn", {}), /invalid_params.*bad workflow/i);
});
