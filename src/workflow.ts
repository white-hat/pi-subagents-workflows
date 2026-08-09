import type {
  SavedWorkflow,
  WorkflowArguments,
  WorkflowParameterDefinition,
  WorkflowParameterType,
} from "./types.ts";

function matchesType(value: unknown, type: WorkflowParameterType): boolean {
  if (type === "string[]") return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function copyJsonValue(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function validateParameterDefinition(name: string, definition: WorkflowParameterDefinition): void {
  if (!matchesTypeName(definition.type)) {
    throw new Error(`Parameter '${name}' has unsupported type '${String(definition.type)}'.`);
  }
  if (definition.description !== undefined && typeof definition.description !== "string") {
    throw new Error(`Parameter '${name}' description must be a string.`);
  }
  if (definition.required !== undefined && typeof definition.required !== "boolean") {
    throw new Error(`Parameter '${name}' required must be a boolean.`);
  }
  if (definition.default !== undefined && !matchesType(definition.default, definition.type)) {
    throw new Error(`Parameter '${name}' default must be ${definition.type}.`);
  }
  if (definition.required === true && definition.default !== undefined) {
    throw new Error(`Parameter '${name}' cannot be required and define a default.`);
  }
}

function matchesTypeName(value: unknown): value is WorkflowParameterType {
  return value === "string" || value === "number" || value === "boolean" || value === "string[]" || value === "object";
}

export function resolveWorkflowArguments(
  workflow: Pick<SavedWorkflow, "name" | "parameters">,
  rawArguments: WorkflowArguments | undefined,
): WorkflowArguments {
  const input = rawArguments ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Workflow '${workflow.name}' arguments must be an object.`);
  }

  const unknown = Object.keys(input).find((name) => !Object.hasOwn(workflow.parameters, name));
  if (unknown) throw new Error(`Workflow '${workflow.name}' received unknown argument '${unknown}'.`);

  const resolved: WorkflowArguments = {};
  for (const [name, definition] of Object.entries(workflow.parameters)) {
    validateParameterDefinition(name, definition);
    const supplied = Object.hasOwn(input, name);
    if (!supplied) {
      if (definition.default !== undefined) resolved[name] = copyJsonValue(definition.default);
      else if (definition.required) throw new Error(`Workflow '${workflow.name}' argument '${name}' is required.`);
      continue;
    }

    const value = input[name];
    if (!matchesType(value, definition.type)) {
      throw new Error(`Workflow '${workflow.name}' argument '${name}' must be ${definition.type}.`);
    }
    resolved[name] = copyJsonValue(value);
  }
  return resolved;
}

export function buildWorkflowScript(
  script: string,
  input: { args: WorkflowArguments; cwd: string },
): string {
  const encodedArguments = JSON.stringify(JSON.stringify(input.args));
  const encodedCwd = JSON.stringify(input.cwd);
  return [
    `const args = Object.freeze(JSON.parse(${encodedArguments}));`,
    `const cwd = ${encodedCwd};`,
    script,
  ].join("\n");
}
