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

const PAIR = /^([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)(\s+|$)/;

function coerce(value: string): unknown {
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parsePairs(input: string): WorkflowArguments {
  const args: WorkflowArguments = Object.create(null);
  let rest = input;
  while (rest) {
    const match = PAIR.exec(rest);
    if (!match) {
      throw new Error("Workflow arguments must be a JSON object or key=value pairs.");
    }
    args[match[1] as string] = coerce(match[2] as string);
    rest = rest.slice(match[0].length);
  }
  return { ...args };
}

export function parseWorkflowCommand(input: string): WorkflowCommand {
  const [action, rest] = splitHead(input);
  if (action === "list" && !rest) return { action: "list" };
  if (action === "show") {
    const [name, extra] = splitHead(rest);
    if (!name || extra) throw new Error("Usage: /workflow show <name>");
    return { action: "show", name };
  }
  if (action === "run") {
    const [name, rawArguments] = splitHead(rest);
    if (!name) throw new Error("Usage: /workflow run <name> [key=value ... | JSON object]");
    if (!rawArguments) return { action: "run", name };
    if (!rawArguments.startsWith("{")) {
      return { action: "run", name, args: parsePairs(rawArguments) };
    }
    let args: unknown;
    try {
      args = JSON.parse(rawArguments);
    } catch {
      throw new Error("Workflow arguments must be a JSON object or key=value pairs.");
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Workflow arguments must be a JSON object or key=value pairs.");
    }
    return { action: "run", name, args: args as WorkflowArguments };
  }
  throw new Error(
    "Usage: /workflow list | show <name> | run <name> [key=value ... | JSON object]",
  );
}
