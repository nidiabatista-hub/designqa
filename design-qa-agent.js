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

Failure reasons. Every finding must fall under exactly one of these, each tied to a part of manifest.json:
- "Deprecated variant": a variant listed in components.<Name>.deprecatedVariants is used.
- "Unapproved variant": a variant or size not in components.<Name>.approvedVariants or components.<Name>.approvedSizes is used.
- "Off-system component": a raw element or a component not listed in "components" is used where a manifest component should be (e.g. a raw <button> instead of Button), or a component is imported from a path other than its "import".
- "Hardcoded color": a hex value, inline color style, or arbitrary Tailwind color is used instead of a color token, per "rules".
- "Off-scale spacing": a padding, margin, or gap value is not one of the "spacingScale" tokens, per "rules".
- "Colliding max-width": max-w-xs/sm/md/lg/xl is used, per "rules".
- "Accessibility": a rule in "accessibilityRules" is broken.
- "Responsive": a rule in "responsiveRules" is broken.

For each finding, give:
- "file": the file path from the diff header.
- "line": the line number in the new file (from the @@ hunk header) and the offending snippet, e.g. "42: <Button variant=\\"ghost\\">".
- "issue": the failure reason from the list above, then a colon and a short description, e.g. "Deprecated variant: Button uses variant=\\"ghost\\"".
- "reasoning": explain exactly why it fails, using this format:
  "Breaks manifest.json <path>: \\"<exact text of the rule or entry, quoted from the manifest>\\". Found: <what the diff line does>. Fix: <the manifest-approved alternative>."
  - <path> is the JSON location of the rule, e.g. components.Button.deprecatedVariants.ghost, rules[1], accessibilityRules[0], responsiveRules[1].
  - Quote the manifest text word for word. Do not paraphrase it.
  - For the fix, use the replacement the manifest gives if it gives one (e.g. "Use 'outline' instead."). Otherwise name the approved option from the manifest, such as a token from "spacingScale", a color token from "rules", or a variant from "approvedVariants".
  - Example: "Breaks manifest.json components.Button.deprecatedVariants.ghost: \\"Deprecated as of this project's design system. Use 'outline' instead.\\" Found: the Sign in Button uses variant=\\"ghost\\". Fix: change it to variant=\\"outline\\"."

Respond ONLY with valid JSON in exactly this shape, with no other text, explanation, or markdown fences:
{
  "pass": true or false,
  "findings": [
    { "file": "...", "line": "...", "issue": "...", "reasoning": "..." }
  ]
}
"pass" must be false if there is at least one finding. If there are no issues, return "pass": true and an empty "findings" array.
Your entire reply must be that single JSON object: start with { and end with }. Do not explain your decision before or after it, even when the result is a pass or the diff contains no UI code.

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
    const result = JSON.parse(extractJson(text));
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

// Pull the first complete JSON object out of Claude's reply, ignoring any
// markdown fences or explanation text around it.
function extractJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return text;
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