import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { parseWorkflowCommand } from "./src/command.ts";
import { completeWorkflowArguments } from "./src/completion.ts";
import { discoverWorkflows, type WorkflowRoots } from "./src/registry.ts";
import { executeWorkflowRequest, type WorkflowRequest } from "./src/service.ts";

export interface WorkflowExtensionOptions {
  packageRoot?: string;
  userRoot?: string;
}

function projectWorkflowRoot(cwd: string): string | undefined {
  const candidate = join(realpathSync(cwd), CONFIG_DIR_NAME, "subagent-workflows");
  return existsSync(candidate) ? candidate : undefined;
}

function rootsForContext(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  options: WorkflowExtensionOptions,
): WorkflowRoots {
  const packageDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = ctx.isProjectTrusted() ? projectWorkflowRoot(ctx.cwd) : undefined;
  return {
    packageRoot: options.packageRoot ?? join(packageDirectory, "workflows"),
    userRoot: options.userRoot ?? join(getAgentDir(), "subagent-workflows"),
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  };
}

function registryForContext(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  options: WorkflowExtensionOptions,
) {
  return discoverWorkflows(rootsForContext(ctx, options));
}

function requestFromTool(params: {
  action: "list" | "show" | "run";
  name?: string;
  args?: Record<string, unknown>;
  cwd?: string;
}): WorkflowRequest {
  return {
    action: params.action,
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.args !== undefined ? { args: params.args } : {}),
    ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
  };
}

export default function registerWorkflowExtension(
  pi: ExtensionAPI,
  options: WorkflowExtensionOptions = {},
): void {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.registerTool({
    name: "pi_subagent_workflow",
    label: "Pi Subagent Workflow",
    description: "List, inspect, or run a saved workflow through pi-subagents. Run starts a detached async workflow and returns its pi-subagents run details.",
    promptSnippet: "List, inspect, or run saved pi-subagents workflows",
    promptGuidelines: [
      "Use pi_subagent_workflow when the user asks to run a saved pi-subagents workflow by name; inspect it first when required arguments are unknown.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "show", "run"] as const, { description: "Registry action" }),
      name: Type.Optional(Type.String({ description: "Workflow name for show or run" })),
      args: Type.Optional(Type.Unsafe<Record<string, unknown>>({
        type: "object",
        additionalProperties: true,
        description: "Workflow arguments validated against workflow.json",
      })),
      cwd: Type.Optional(Type.String({ description: "Run cwd; relative paths resolve from the current Pi cwd" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await executeWorkflowRequest(requestFromTool(params), {
        cwd: ctx.cwd,
        ...(signal !== undefined ? { signal } : {}),
        registry: registryForContext(ctx, options),
        events: pi.events,
      });
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });

  let completionContext: Pick<ExtensionContext, "cwd" | "isProjectTrusted"> | undefined;
  pi.on("session_start", (_event, ctx) => {
    completionContext = { cwd: ctx.cwd, isProjectTrusted: () => ctx.isProjectTrusted() };
  });

  pi.registerCommand("workflow", {
    description: "List, inspect, or run saved pi-subagents workflows",
    getArgumentCompletions: (argumentPrefix) => {
      if (!completionContext) return null;
      try {
        const { workflows } = registryForContext(completionContext, options);
        return completeWorkflowArguments(argumentPrefix, [...workflows.values()]);
      } catch {
        return null;
      }
    },
    handler: async (rawArguments, ctx) => {
      completionContext = { cwd: ctx.cwd, isProjectTrusted: () => ctx.isProjectTrusted() };
      try {
        const request = parseWorkflowCommand(rawArguments);
        const result = await executeWorkflowRequest(request, {
          cwd: ctx.cwd,
          registry: registryForContext(ctx, options),
          events: pi.events,
        });
        ctx.ui.notify(result.text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
