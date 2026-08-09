import {
  existsSync,
  readFileSync,
  opendirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  SavedWorkflow,
  WorkflowDiscoveryResult,
  WorkflowManifest,
  WorkflowParameterDefinition,
  WorkflowScope,
} from "./types.ts";
import { validateParameterDefinition } from "./workflow.ts";

const WORKFLOW_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const RESERVED_PARAMETER_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export interface WorkflowRoots {
  packageRoot?: string;
  userRoot?: string;
  projectRoot?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function parseParameters(value: unknown): Record<string, WorkflowParameterDefinition> {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("parameters must be an object");
  if (Object.keys(value).length > 128) throw new Error("parameters exceed the 128 entry limit");

  const parameters = Object.create(null) as Record<string, WorkflowParameterDefinition>;
  for (const [name, rawDefinition] of Object.entries(value)) {
    if (!PARAMETER_NAME.test(name)) throw new Error(`parameter name '${name}' is invalid`);
    if (RESERVED_PARAMETER_NAMES.has(name)) throw new Error(`parameter name '${name}' is reserved`);
    if (!record(rawDefinition) || typeof rawDefinition.type !== "string") {
      throw new Error(`parameter '${name}' must be an object with a type`);
    }
    const definition = rawDefinition as unknown as WorkflowParameterDefinition;
    validateParameterDefinition(name, definition);
    parameters[name] = definition;
  }
  return parameters;
}

function loadWorkflow(directory: string, expectedName: string, scope: WorkflowScope): SavedWorkflow {
  const manifestPath = join(directory, "workflow.json");
  if (!existsSync(manifestPath)) throw new Error(`workflow.json is missing at ${manifestPath}`);
  if (statSync(manifestPath).size > 65_536) {
    throw new Error(`workflow manifest exceeds the 64 KiB limit at ${manifestPath}`);
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(rawManifest)) throw new Error(`${manifestPath} must contain an object`);

  const manifest = rawManifest as unknown as WorkflowManifest;
  if (typeof manifest.name !== "string" || !WORKFLOW_NAME.test(manifest.name)) {
    throw new Error(`${manifestPath} name must match ${WORKFLOW_NAME}`);
  }
  if (manifest.name !== expectedName) {
    throw new Error(`${manifestPath} name '${manifest.name}' must match directory '${expectedName}'`);
  }
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    throw new Error(`${manifestPath} description must be a non-empty string`);
  }
  if (manifest.description.length > 1_000) {
    throw new Error(`${manifestPath} description exceeds the 1000 character limit`);
  }
  if (manifest.script !== undefined && (typeof manifest.script !== "string" || !manifest.script.trim())) {
    throw new Error(`${manifestPath} script must be a non-empty relative path`);
  }

  const scriptRelative = manifest.script ?? "script.js";
  if (isAbsolute(scriptRelative)) throw new Error(`${manifestPath} script must be relative`);
  const scriptCandidate = resolve(directory, scriptRelative);
  const realDirectory = realpathSync(directory);
  if (!existsSync(scriptCandidate) || !statSync(scriptCandidate).isFile()) {
    throw new Error(`workflow script is missing at ${scriptCandidate}`);
  }
  const scriptSize = statSync(scriptCandidate).size;
  if (scriptSize === 0) throw new Error(`workflow script must not be empty at ${scriptCandidate}`);
  if (scriptSize > 1_048_576) {
    throw new Error(`workflow script exceeds the 1 MiB limit at ${scriptCandidate}`);
  }
  const scriptPath = realpathSync(scriptCandidate);
  if (!within(realDirectory, scriptPath)) throw new Error(`${manifestPath} script escapes the workflow directory`);

  const parameters = parseParameters(manifest.parameters);
  return {
    name: manifest.name,
    description: manifest.description.trim(),
    scope,
    directory: realDirectory,
    manifestPath,
    scriptPath,
    parameters,
  };
}

function scopeEntries(root: string | undefined): { names: string[]; truncated: boolean } {
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) return { names: [], truncated: false };
  const names: string[] = [];
  let truncated = false;
  const directory = opendirSync(root);
  try {
    let entry;
    while ((entry = directory.readSync()) !== null) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || !WORKFLOW_NAME.test(entry.name)) continue;
      if (names.length >= 256) {
        truncated = true;
        break;
      }
      names.push(entry.name);
    }
  } finally {
    try {
      directory.closeSync();
    } catch {
      // Node may close an exhausted directory handle automatically.
    }
  }
  return { names: names.sort(), truncated };
}

export function discoverWorkflows(roots: WorkflowRoots): WorkflowDiscoveryResult {
  const workflows = new Map<string, SavedWorkflow>();
  const diagnostics: string[] = [];
  const scopes: Array<[WorkflowScope, string | undefined]> = [
    ["package", roots.packageRoot],
    ["user", roots.userRoot],
    ["project", roots.projectRoot],
  ];

  for (const [scope, root] of scopes) {
    const entries = scopeEntries(root);
    if (entries.truncated) diagnostics.push(`[${scope}] workflow directory limit is 256; remaining entries were ignored.`);
    for (const name of entries.names) {
      try {
        workflows.set(name, loadWorkflow(join(root!, name), name, scope));
      } catch (error) {
        workflows.delete(name);
        diagnostics.push(`[${scope}] ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { workflows, diagnostics };
}
