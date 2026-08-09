import type { WorkflowArguments } from "./types.ts";

export type WorkflowCommand =
  | { action: "list" }
  | { action: "show"; name: string }
  | { action: "run"; name: string; args?: WorkflowArguments };

function splitHead(value: string): [string, string] {
  const trimmed = value.trim();
  const boundary = trimmed.search(/\s/);
  return boundary === -1
    ? [trimmed, ""]
    : [trimmed.slice(0, boundary), trimmed.slice(boundary).trim()];
}

export function parseWorkflowCommand(input: string): WorkflowCommand {
  const [action, rest] = splitHead(input);
  if (action === "list" && !rest) return { action: "list" };
  if (action === "show") {
    const [name, extra] = splitHead(rest);
    if (!name || extra) throw new Error("Usage: /subagent-workflow show <name>");
    return { action: "show", name };
  }
  if (action === "run") {
    const [name, rawArguments] = splitHead(rest);
    if (!name) throw new Error("Usage: /subagent-workflow run <name> [JSON object]");
    if (!rawArguments) return { action: "run", name };
    let args: unknown;
    try {
      args = JSON.parse(rawArguments);
    } catch {
      throw new Error("Workflow arguments must be a JSON object.");
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Workflow arguments must be a JSON object.");
    }
    return { action: "run", name, args: args as WorkflowArguments };
  }
  throw new Error("Usage: /subagent-workflow list | show <name> | run <name> [JSON object]");
}
