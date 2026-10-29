#!/usr/bin/env node
/**
 * Design QA Agent — workshop stub
 *
 * Runs on every pull request. Fetches the diff, checks it against the
 * design system's component manifest, and posts a pass/fail result back
 * to the PR.
 *
 * ALREADY WIRED: fetching the diff, reading the manifest, calling
 * Claude, handling API errors, parsing the response, posting the
 * result, exiting with the right status code.
 *
 * YOUR JOB: fill in buildPrompt() — write the prompt that decides
 * whether the diff follows the design system.
 *
 * File paths below are placeholders. Update them to match your repo.
 */

import fs from "node:fs";

// --- Placeholders — update these to match your repo structure ---
const PLACEHOLDER_MANIFEST_PATH = "./manifest.json"; // now pointed at the real manifest
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // swap for 'claude-sonnet-5' if you want stronger reasoning

// ============================================================
// ALREADY WIRED — fetch the PR diff
// ============================================================
async function fetchDiff() {
  const repo = process.env.GITHUB_REPOSITORY; // e.g. "your-username/your-repo"
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch diff: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ============================================================
// ALREADY WIRED — read the component manifest
// ============================================================
function readManifest() {
  return fs.readFileSync(PLACEHOLDER_MANIFEST_PATH, "utf-8");
}

// ============================================================
// YOUR JOB — write the prompt
//
// This is the only part you need to write. Everything else below
// (calling the API, handling errors, parsing the result) is already
// wired up and working.
//
// Write a prompt that asks Claude to compare the diff against the
// manifest and decide pass/fail. Things worth including:
//   - Reference the manifest explicitly, don't just say "the design system"
//   - Say what counts as an issue (off-system components, hardcoded
//     colors, arbitrary spacing, deprecated variants)
//   - Ask for structured reasoning, not just a verdict
//
// IMPORTANT: whatever you ask for, it must come back as valid JSON in
// exactly this shape, because that's what the code below expects:
//   {
//     "pass": true or false,
//     "findings": [
//       { "file": "...", "line": "...", "issue": "...", "reasoning": "..." }
//     ]
//   }
// If there are no issues, "pass" should be true and "findings" empty.
// ============================================================
function buildPrompt(diff, manifest) {
  return `You are a design system QA reviewer. Your job is to check a pull request diff against the design system's component manifest and decide whether the changes follow it.

The manifest below is the single source of truth. Base every check on what it actually says, and do not invent rules that are not in it. Check the diff against all of these manifest sections:
- "components": only the listed components should be used, imported from their listed "import" path, with variants from "approvedVariants", sizes from "approvedSizes", and only the listed "subcomponents".
- "deprecatedVariants": any use of a deprecated variant is an issue. Mention the replacement the manifest gives.
- "spacingScale": the approved spacing tokens.
- "rules": every rule in this array.
- "accessibilityRules": every rule in this array.
- "responsiveRules": every rule in this array.

Scope:
- Only flag lines that appear in the diff as added or changed lines (lines starting with "+", excluding the "+++" file header). Do not flag removed lines, unchanged context lines, or code outside the diff.
- If a line breaks more than one manifest rule, report each one as a separate finding.
- If the diff does not touch any UI code, or nothing in it breaks the manifest, the result is a pass.

For each finding, give:
- "file": the file path from the diff header.
- "line": the line number in the new file (from the @@ hunk header) and the offending snippet, e.g. "42: <Button variant=\\"ghost\\">".
- "issue": a short description of what is wrong.
- "reasoning": why it breaks the manifest, quoting or naming the specific manifest rule or entry (e.g. components.Button.deprecatedVariants.ghost, or the exact text of the rule), and what to use instead if the manifest says.

Respond ONLY with valid JSON in exactly this shape, with no other text, explanation, or markdown fences:
{
  "pass": true or false,
  "findings": [
    { "file": "...", "line": "...", "issue": "...", "reasoning": "..." }
  ]
}
"pass" must be false if there is at least one finding. If there are no issues, return "pass": true and an empty "findings" array.

Manifest:
${manifest}

Diff:
${diff}`;
}

// ============================================================
// ALREADY WIRED — calls Claude, checks for API errors, and parses
// the JSON response. You shouldn't need to touch this function.
// ============================================================
async function checkDesignCompliance(diff, manifest) {
  const prompt = buildPrompt(diff, manifest);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Anthropic API error (status ${response.status}):`, JSON.stringify(data, null, 2));
    return {
      pass: false,
      findings: [{
        file: "-",
        line: "-",
        issue: "API call failed",
        reasoning: data?.error?.message || `HTTP ${response.status}`,
      }],
    };
  }

  const text = data.content?.[0]?.text ?? "";

  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(cleaned);
    return {
      pass: result.pass === true,
      findings: Array.isArray(result.findings) ? result.findings : [],
    };
  } catch (err) {
    console.error("Failed to parse Claude's response as JSON:", text);
    return {
      pass: false,
      findings: [{ file: "-", line: "-", issue: "Agent response could not be parsed", reasoning: text.slice(0, 300) }],
    };
  }
}


// ============================================================
// ALREADY WIRED — post the result back to the PR
// ============================================================
async function postResult(result) {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const body = result.pass
    ? `Design QA agent: no issues found.`
    : `Design QA agent found issues:\n\n${result.findings
        .map((f) => `- **${f.file}:${f.line}** — ${f.issue}\n  ${f.reasoning}`)
        .join("\n")}`;

  const commentRes = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!commentRes.ok) {
    const errText = await commentRes.text();
    console.error(`Failed to post comment (status ${commentRes.status}):`, errText);
  } else {
    console.log("Comment posted successfully.");
  }

  // Non-zero exit makes the GitHub Action report a failed check.
  process.exit(result.pass ? 0 : 1);
}

// ============================================================
// ALREADY WIRED — run it
// ============================================================
(async function main() {
  try {
    const diff = await fetchDiff();
    const manifest = readManifest();
    const result = await checkDesignCompliance(diff, manifest);
    await postResult(result);
  } catch (err) {
    console.error("Design QA agent failed to run:", err);
    process.exit(1);
  }
})();