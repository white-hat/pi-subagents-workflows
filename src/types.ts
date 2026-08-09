export type WorkflowScope = "package" | "user" | "project";

export type WorkflowParameterType = "string" | "number" | "boolean" | "string[]" | "object";

export interface WorkflowParameterDefinition {
  type: WorkflowParameterType;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface WorkflowManifest {
  name: string;
  description: string;
  script?: string;
  parameters?: Record<string, WorkflowParameterDefinition>;
}

export interface SavedWorkflow {
  name: string;
  description: string;
  scope: WorkflowScope;
  directory: string;
  manifestPath: string;
  scriptPath: string;
  parameters: Record<string, WorkflowParameterDefinition>;
}

export interface WorkflowDiscoveryResult {
  workflows: Map<string, SavedWorkflow>;
  diagnostics: string[];
}

export type WorkflowArguments = Record<string, unknown>;
