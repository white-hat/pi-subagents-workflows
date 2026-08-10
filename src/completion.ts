import type { SavedWorkflow } from "./types.ts";

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

const ACTIONS: Array<{ name: string; description: string }> = [
  { name: "list", description: "List saved workflows" },
  { name: "show", description: "Show a workflow and its parameters" },
  { name: "run", description: "Run a workflow with key=value arguments" },
];

const NAME_PATTERN = /^[A-Za-z_][\w.-]*$/;

function item(value: string, label: string, description?: string): CompletionItem {
  return description === undefined ? { value, label } : { value, label, description };
}

function limited(items: CompletionItem[]): CompletionItem[] | null {
  return items.length > 0 ? items.slice(0, 50) : null;
}

function completeAction(prefix: string): CompletionItem[] | null {
  return limited(
    ACTIONS.filter((action) => action.name.startsWith(prefix)).map((action) =>
      item(action.name === "list" ? "list" : `${action.name} `, action.name, action.description),
    ),
  );
}

function completeName(
  action: string,
  prefix: string,
  workflows: SavedWorkflow[],
): CompletionItem[] | null {
  return limited(
    workflows
      .filter((workflow) => workflow.name.startsWith(prefix))
      .map((workflow) =>
        item(
          `${action} ${workflow.name}${action === "run" ? " " : ""}`,
          workflow.name,
          `${workflow.scope}: ${workflow.description}`,
        ),
      ),
  );
}

function completeParameter(
  head: string,
  prefix: string,
  workflow: SavedWorkflow,
  used: Set<string>,
): CompletionItem[] | null {
  return limited(
    Object.entries(workflow.parameters)
      .filter(([name]) => name.startsWith(prefix) && !used.has(name))
      .map(([name, parameter]) =>
        item(
          `${head}${name}=`,
          `${name}=`,
          [
            parameter.type,
            parameter.required ? "required" : "optional",
            parameter.description,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
  );
}

/**
 * Completes the argument text of `/workflow`. Pi replaces the whole
 * argument prefix with the selected value, so every value is a full argument
 * string rather than just the token under the cursor.
 */
export function completeWorkflowArguments(
  argumentPrefix: string,
  workflows: SavedWorkflow[],
): CompletionItem[] | null {
  if (/^\s/.test(argumentPrefix)) return null;
  const quotes = argumentPrefix.match(/["']/g);
  if (quotes && quotes.length % 2 === 1) return null;
  const tokens = argumentPrefix.split(/\s+/);
  const action = tokens[0] ?? "";
  if (tokens.length === 1) return completeAction(action);
  if (action !== "show" && action !== "run") return null;
  if (tokens.length === 2) return completeName(action, tokens[1] as string, workflows);
  if (action !== "run") return null;

  const workflow = workflows.find((candidate) => candidate.name === tokens[1]);
  if (!workflow) return null;
  const last = tokens[tokens.length - 1] as string;
  if (last.includes("=") || !NAME_PATTERN.test(last === "" ? "_" : last)) return null;

  const used = new Set(
    tokens.slice(2, -1).flatMap((token) => {
      const key = token.slice(0, token.indexOf("="));
      return key ? [key] : [];
    }),
  );
  const head = argumentPrefix.slice(0, argumentPrefix.length - last.length);
  return completeParameter(head, last, workflow, used);
}
