#!/usr/bin/env node

import { readFileSync } from "node:fs";

const EXPECTED_MIGRATIONS = [
  "202607260001_ssmm_spike1_runtime.sql",
  "202607310001_ssmm_spike1_authority_integrity.sql",
  "202607310002_ssmm_spike1_creation_revision.sql",
  "202607310003_ssmm_spike1_plpgsql_qualification.sql",
];

const EXPECTED_SECRETS = new Set([
  "SSMM_RUNTIME_SHARED_SECRET",
  "SSMM_SHAPE_ENDPOINT",
  "SSMM_SHAPE_API_KEY",
  "SSMM_SHAPE_MODEL",
  "SSMM_PURPOSE_ID",
  "SSMM_PURPOSE_LABEL",
  "SSMM_ORIENTATION_ID",
  "SSMM_ORIENTATION_LABEL",
]);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parseJsonOutput = (text) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Continue past CLI progress lines.
      }
    }
  }
  fail("rollback_evidence_invalid_json");
};

const [kind, path, emptyFlag] = process.argv.slice(2);
if (!kind || !path) {
  fail("usage: validate-rollback-evidence.mjs <functions|secrets|table-stats|dry-run> <file> [--empty]");
}

const text = readFileSync(path, "utf8");

if (kind === "dry-run") {
  const observedVersions = [...new Set(text.match(/20\d{10}/g) ?? [])];
  const expectedVersions = EXPECTED_MIGRATIONS.map((name) => name.slice(0, 12));
  if (JSON.stringify(observedVersions) !== JSON.stringify(expectedVersions)) {
    fail(`rollback_dry_run_mismatch:${observedVersions.join(",")}`);
  }
  let prior = -1;
  for (const migration of EXPECTED_MIGRATIONS) {
    const index = text.indexOf(migration);
    if (index <= prior) fail(`rollback_dry_run_order_mismatch:${migration}`);
    prior = index;
  }
  process.stdout.write(`${EXPECTED_MIGRATIONS.join("\n")}\n`);
  process.exit(0);
}

const parsed = parseJsonOutput(text);

if (kind === "functions") {
  const functions = Array.isArray(parsed) ? parsed : (parsed.functions ?? []);
  const names = functions.map((item) => item.slug ?? item.name).filter(Boolean).sort();
  const unexpected = names.filter((name) => name !== "ssmm-runtime");
  if (unexpected.length) fail(`rollback_unexpected_functions:${unexpected.join(",")}`);
  if (emptyFlag === "--empty" && names.length) fail(`rollback_functions_remain:${names.join(",")}`);
  if (names.length) process.stdout.write(`${names.join("\n")}\n`);
  process.exit(0);
}

if (kind === "secrets") {
  const secrets = Array.isArray(parsed) ? parsed : (parsed.secrets ?? []);
  const names = secrets.map((item) => item.name).filter(Boolean).sort();
  const unexpected = names.filter((name) => !EXPECTED_SECRETS.has(name));
  if (unexpected.length) fail(`rollback_unexpected_secrets:${unexpected.join(",")}`);
  if (emptyFlag === "--empty" && names.length) fail(`rollback_secrets_remain:${names.join(",")}`);
  if (names.length) process.stdout.write(`${names.join("\n")}\n`);
  process.exit(0);
}

if (kind === "table-stats") {
  const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  if (rows.length) fail(`rollback_table_stats_not_empty:${rows.length}`);
  process.stdout.write("table_stats_rows=0\n");
  process.exit(0);
}

fail(`rollback_evidence_unknown_kind:${kind}`);
