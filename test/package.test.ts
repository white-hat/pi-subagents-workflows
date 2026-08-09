import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const skill = readFileSync(new URL("../skills/pi-subagents-workflow-authoring/SKILL.md", import.meta.url), "utf8");

test("package publishes the extension, authoring skill, and bundled workflow directory", () => {
  assert.deepEqual(packageJson.pi.extensions, ["./index.ts"]);
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.ok(packageJson.files.includes("workflows/"));
});

test("authoring skill points to canonical pi-subagents references", () => {
  assert.match(skill, /\.\.\/\.\.\/README\.md/);
  assert.match(skill, /nicobailon\/pi-subagents\/blob\/main\/docs\/workflows\.md/);
  assert.match(skill, /nicobailon\/pi-subagents\/blob\/main\/docs\/tool-reference\.md/);
});

test("authoring skill uses structured output for machine-readable workflow contracts", () => {
  assert.match(skill, /object-root `outputSchema` whenever downstream orchestration needs machine-readable values/);
  assert.match(skill, /result\.structuredOutput/);
  assert.match(skill, /commit `137b6b6`/);
  assert.doesNotMatch(skill, /ask the child to return JSON as normal assistant text/);
  assert.doesNotMatch(skill, /use exact markers such as/);
});
