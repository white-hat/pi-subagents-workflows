# pi-subagents-workflows

Save multi-agent orchestration scripts to disk and run them by name.

## What this is

[`pi-subagents`](https://github.com/nicobailon/pi-subagents) is a Pi extension that runs a `workflowScript`: a small JavaScript program that launches several subagents, coordinates them, and returns their combined output. Normally you write that script inline each time you want it, and it disappears with the session.

This extension is the missing filing cabinet. A workflow is a directory holding a manifest and a script:

```text
review/
├── workflow.json   # name, description, typed parameters
└── script.js       # the workflowScript body
```

Drop that anywhere the registry looks — alongside this package, in your home directory, or in a repository — and it becomes callable by name, by you or by the agent:

```text
/workflow run review target=src/auth
```

Arguments are validated against the manifest before anything launches, so a typo fails immediately instead of halfway through a fan-out. Project-scoped workflows live in the repository they serve, which means an orchestration your team relies on — a review panel, a migration sweep, a research fan-out — is version-controlled and reviewable like the rest of the code.

Execution stays with pi-subagents: this package stores workflows, validates their inputs, and hands them over. See [Limits](#limits) for what it deliberately does not do.

## Requirements

- Node 22.19 or newer
- Pi 0.83 or newer
- pi-subagents 0.43.0 or newer, loaded in the same parent session

Install both packages, then reload Pi:

```bash
pi install git:github.com/nicobailon/pi-subagents
pi install git:github.com/white-hat/pi-subagents-workflows
```

For local development:

```bash
pi install /absolute/path/to/pi-subagents-workflows
```

## Use

Ask Pi to list or run a workflow. The extension exposes this tool:

```text
pi_subagent_workflow({ action: "list" })
pi_subagent_workflow({ action: "show", name: "review" })
pi_subagent_workflow({
  action: "run",
  name: "review",
  args: { target: "src/auth" },
  cwd: "/path/to/repository"
})
```

Humans can use the slash command:

```text
/workflow list
/workflow show review
/workflow run review target=src/auth depth=3 strict=true
/workflow run review target="src/my auth"
/workflow run review {"target":"src/auth"}
```

Tab completion covers the action, then the workflow name, then the workflow's own parameter names as `key=` — annotated with type, requiredness, and description, and skipping keys already typed.

Run arguments accept `key=value` pairs or a JSON object. Values are read as JSON when they parse (`3`, `true`, `null`, `["a","b"]`) and as plain strings otherwise; double or single quotes keep spaces, and single quotes keep the text verbatim.

Runs are detached and appear in pi-subagents status, artifacts, and FleetView.

## Workflow locations

The registry loads workflows from three scopes. Higher scopes replace lower scopes with the same name.

1. Package: `workflows/<name>/`
2. User: `~/.pi/agent/subagent-workflows/<name>/`
3. Project: `<Pi cwd>/.pi/subagent-workflows/<name>/`

An invalid higher-scope definition blocks fallback to a lower-scope definition of the same name. Project workflows load only when Pi trusts the current project, and discovery does not walk into ancestor directories. Start Pi from the repository root when using project workflows.

## Workflow format

Each workflow directory contains a manifest and script:

```text
review/
├── workflow.json
└── script.js
```

`workflow.json`:

```json
{
  "name": "review",
  "description": "Review a target with independent reviewers",
  "parameters": {
    "target": {
      "type": "string",
      "required": true,
      "description": "Path or topic to review"
    },
    "reviewers": {
      "type": "number",
      "default": 2
    }
  }
}
```

Supported parameter types are `string`, `number`, `boolean`, `string[]`, and `object`. Unknown arguments and wrong types fail before launch. Set `script` in the manifest when the script filename is not `script.js`. Manifests are capped at 64 KiB, descriptions at 1,000 characters, parameters at 128, and each discovery scope at 256 workflow directories.

The extension injects validated `args` and the resolved run `cwd` into `script.js`:

```js
const reviews = await runs.all(
  Array.from({ length: args.reviewers }, (_, index) => ({
    key: `review-${index + 1}`,
    agent: "reviewer",
    task: `Review ${args.target} from angle ${index + 1}`,
    cwd,
    context: "fresh"
  }))
);

return reviews.map((review) => review.output);
```

Write the script as a `workflowScript` body. Do not use imports, exports, Node APIs, or host globals. Scripts are capped at 1 MiB.

Use the canonical pi-subagents documentation for the runtime API and child execution controls:

- [Workflows and orchestration](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md)
- [Subagent tool reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md)
- [Agents](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md)

## Creating your own workflows

Ask Pi to write it. This package ships the `pi-subagents-workflow-authoring` skill, which Pi loads with the extension, and it carries the whole procedure: choose the scope, implement exactly the requested topology, declare every caller-supplied value as a typed parameter, give each child the smallest output contract that works, and document the result. Describe the shape you want — "three discoverers, one reviewer, one reporter" — and you get the manifest, the script, and a per-workflow README.

Two of its rules are worth knowing before you read any generated script, because they are the ones that bite:

- Read schema-bound results from `result.structuredOutput`. Never parse them back out of `result.output`.
- `runs.all` settles every lane and can return failed records, so check `run.error` on each. A failed `runs.run` rejects unless you catch it.

### Pair a workflow with a prompt

A workflow takes typed arguments and returns structured data. Neither end is where a person wants to start or finish. Put a Pi prompt at `~/.pi/agent/prompts/<name>.md` to be that layer — it turns a sentence into arguments, launches the run, and reports what came back:

```md
---
description: Run the saved local code-review workflow
argument-hint: "[what to review]"
---

Run the saved local code-review workflow for the current repository.

1. Do not perform the review yourself or edit repository files.
2. Resolve the repository root and use it as `cwd`.
3. Treat everything after the marker below as prose describing what the workflow
   should review. Pass it verbatim as `reviewRequest`.
4. Infer `dependencyReview` from that prose. Set it to `true` when the request
   involves manifests, lockfiles, versions, or dependency security.
5. Launch it:
   `pi_subagent_workflow({ action: "run", name: "code-review", args: { reviewRequest: "<prose>", dependencyReview: <true|false> }, cwd: "<repository-root>" })`
6. The workflow runs detached. Wait for it to finish, then report every confirmed
   finding and the full coverage ledger. Do not hide failed or skipped roles.

--- BEGIN REVIEW REQUEST (ALL REMAINING TEXT) ---
$@
```

Now `/code-review the auth refactor, check the lockfile too` runs the whole fan-out.

The prompt is doing three things the workflow cannot do for itself. It fences the calling agent off from the task, so Pi launches the review instead of drifting into performing one. It derives typed arguments from free prose, with `$@` carrying the user's words through verbatim rather than through a paraphrase. And it fixes what "done" means — naming the fields to report, including the failures, so a partial run cannot be summarized as a clean one.

## Permissions and extensions

The registry delegates each `runs.run()` call to pi-subagents. Named child agents keep their configured tools, skills, extensions, `subagentOnlyExtensions`, MCP selections, context mode, and permission-system behavior.

Workflow definitions are trusted code. The orchestration script runs in pi-subagents' restricted workflow worker, while this registry extension runs with normal Pi extension privileges. Review project workflows before trusting a repository.

## Limits

This package stores and launches workflow definitions. pi-subagents owns execution and artifacts. It does not add journal replay, edit-and-resume, nested `workflowScript` calls, or foreground RPC execution.

## Development

```bash
npm install
npm test
npm run typecheck
```

`.github/workflows/test.yml` runs the typecheck and test suite on Linux and Windows for every push and pull request to `main`.

## Releasing

Publishing is manual. Bump `version` in `package.json`, merge it, then run the **Release** workflow from the Actions tab. It reruns the checks and publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements).

The workflow authenticates through npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) rather than a token, so npm needs a one-time trusted publisher for this package pointing at `white-hat/pi-subagents-workflows` and `release.yml`. The `pi-package` keyword is what lists the published package on [pi.dev/packages](https://pi.dev/packages).
