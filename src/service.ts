import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";

import type { EventBus } from "./rpc.ts";
import { callSubagentRpc } from "./rpc.ts";
import type { WorkflowDiscoveryResult, WorkflowArguments } from "./types.ts";
import { buildWorkflowScript, resolveWorkflowArguments } from "./workflow.ts";

export type WorkflowAction = "list" | "show" | "run";

export interface WorkflowRequest {
  action: WorkflowAction;
  name?: string;
  args?: WorkflowArguments;
  cwd?: string;
}

export interface WorkflowServiceContext {
  cwd: string;
  signal?: AbortSignal;
  registry: WorkflowDiscoveryResult;
  events: EventBus;
}

export interface WorkflowServiceResult {
  text: string;
  details: Record<string, unknown>;
}

function diagnosticsText(registry: WorkflowDiscoveryResult): string {
  if (registry.diagnostics.length === 0) return "";
  const shown = registry.diagnostics.slice(0, 20);
  const omitted = registry.diagnostics.length - shown.length;
  return `\n\nDiagnostics:\n${shown.map((entry) => `- ${entry}`).join("\n")}${omitted > 0 ? `\n- ${omitted} more omitted` : ""}`;
}

function boundedToolText(value: string): string {
  const truncated = truncateHead(value, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  return truncated.truncated
    ? `${truncated.content}\n\n[Output truncated. Use action='show' for one workflow.]`
    : truncated.content;
}

function listWorkflows(registry: WorkflowDiscoveryResult): WorkflowServiceResult {
  const workflows = [...registry.workflows.values()].sort((left, right) => left.name.localeCompare(right.name));
  const text = workflows.length === 0
    ? "No saved pi-subagents workflows found."
    : ["Saved pi-subagents workflows:", ...workflows.map((workflow) => `- ${workflow.name} (${workflow.scope}): ${workflow.description}`)].join("\n");
  return {
    text: boundedToolText(text + diagnosticsText(registry)),
    details: {
      action: "list",
      workflows: workflows.slice(0, 256).map(({ name, description, scope, manifestPath }) => ({ name, description, scope, manifestPath })),
      diagnostics: registry.diagnostics.slice(0, 20),
    },
  };
}

function requireWorkflow(registry: WorkflowDiscoveryResult, name: string | undefined) {
  if (!name) throw new Error("A workflow name is required.");
  const workflow = registry.workflows.get(name);
  if (!workflow) throw new Error(`Saved workflow '${name}' was not found.${diagnosticsText(registry)}`);
  return workflow;
}

function showWorkflow(registry: WorkflowDiscoveryResult, name: string | undefined): WorkflowServiceResult {
  const workflow = requireWorkflow(registry, name);
  const parameters = Object.entries(workflow.parameters);
  const lines = [
    `${workflow.name} (${workflow.scope})`,
    workflow.description,
    `Manifest: ${workflow.manifestPath}`,
    `Script: ${workflow.scriptPath}`,
  ];
  if (parameters.length > 0) {
    lines.push("Parameters:");
    for (const [parameterName, definition] of parameters) {
      const requirement = definition.required ? "required" : definition.default !== undefined ? `default=${JSON.stringify(definition.default)}` : "optional";
      lines.push(`- ${parameterName}: ${definition.type}, ${requirement}${definition.description ? ` — ${definition.description}` : ""}`);
    }
  } else {
    lines.push("Parameters: none");
  }
  return {
    text: boundedToolText(lines.join("\n") + diagnosticsText(registry)),
    details: {
      action: "show",
      workflow: {
        name: workflow.name,
        description: workflow.description,
        scope: workflow.scope,
        manifestPath: workflow.manifestPath,
        scriptPath: workflow.scriptPath,
        parameters: workflow.parameters,
      },
      diagnostics: registry.diagnostics.slice(0, 20),
    },
  };
}

function resolveRunCwd(baseCwd: string, requested: string | undefined): string {
  const candidate = resolve(baseCwd, requested ?? ".");
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`Workflow cwd is not a directory: ${candidate}`);
  }
  return realpathSync(candidate);
}

async function runWorkflow(
  registry: WorkflowDiscoveryResult,
  request: WorkflowRequest,
  context: Pick<WorkflowServiceContext, "cwd" | "signal" | "events">,
): Promise<WorkflowServiceResult> {
  const workflow = requireWorkflow(registry, request.name);
  const args = resolveWorkflowArguments(workflow, request.args);
  const cwd = resolveRunCwd(context.cwd, request.cwd);
  const script = readFileSync(workflow.scriptPath, "utf8");
  if (!script.trim()) throw new Error(`Workflow script must not be empty: ${workflow.scriptPath}`);
  const workflowScript: string = buildWorkflowScript(script, { args, cwd });
  const reply = await callSubagentRpc<{ text: string; details?: unknown }>(
    context.events,
    "spawn",
    { workflowScript, cwd },
    context.signal ? { signal: context.signal } : {},
  );
  return {
    text: reply.text,
    details: {
      action: "run",
      workflow: workflow.name,
      scope: workflow.scope,
      cwd,
      args,
      rpc: reply.details,
    },
  };
}

export async function executeWorkflowRequest(
  request: WorkflowRequest,
  context: WorkflowServiceContext,
): Promise<WorkflowServiceResult> {
  if (request.action === "list") return listWorkflows(context.registry);
  if (request.action === "show") return showWorkflow(context.registry, request.name);
  return runWorkflow(context.registry, request, context);
}
