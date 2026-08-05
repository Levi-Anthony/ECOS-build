import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const rollbackSql = readFileSync("supabase/rollback/rollback_ssmm_spike1.sql", "utf8");
const verifySql = readFileSync("supabase/rollback/verify_stage2b_baseline.sql", "utf8");
const runner = readFileSync("scripts/ssmm-stage3-rollback.sh", "utf8");
const runbook = readFileSync("docs/spike-1/remote-build-runbook.md", "utf8");

assert.match(rollbackSql, /^begin;/m);
assert.match(rollbackSql, /^commit;/m);
assert.doesNotMatch(rollbackSql, /\bcascade\b/i);
assert.doesNotMatch(rollbackSql, /drop\s+extension/i);
assert.match(rollbackSql, /drop schema if exists ssmm_spike1 restrict;/);
assert.match(rollbackSql, /ssmm_rollback_unexpected_relations/);
assert.match(rollbackSql, /ssmm_rollback_unexpected_indexes/);
assert.match(rollbackSql, /ssmm_rollback_unexpected_constraints/);
assert.match(rollbackSql, /ssmm_rollback_unexpected_routines/);
assert.ok(rollbackSql.indexOf("drop trigger") < rollbackSql.indexOf("drop table"));
assert.ok(rollbackSql.indexOf("drop function") < rollbackSql.indexOf("drop table"));
assert.ok(rollbackSql.indexOf("runtime_requests restrict") < rollbackSql.indexOf("main_loops restrict"));
assert.match(verifySql, /stage2b_baseline_mismatch/);

for (const value of [
  "itqjtjcsjwvzxcowhqyt",
  "stage2b-empty-20260804",
  "862613c1072315c8c500084b9835ead6e45979c4e9e6abdff6be4b7174df3422",
  "168a95a9c745af5ed4679751f90419ac9dc434240a213b03e32a06d5664c2308",
  "202607260001", "202607310001", "202607310002", "202607310003",
]) assert.ok(runner.includes(value), `runner missing ${value}`);

for (const name of [
  "SSMM_RUNTIME_SHARED_SECRET", "SSMM_SHAPE_ENDPOINT", "SSMM_SHAPE_API_KEY",
  "SSMM_SHAPE_MODEL", "SSMM_PURPOSE_ID", "SSMM_PURPOSE_LABEL",
  "SSMM_ORIENTATION_ID", "SSMM_ORIENTATION_LABEL",
]) assert.ok(runbook.includes(name), `runbook missing ${name}`);

assert.match(runbook, /verify_jwt=false/i);
assert.match(runbook, /custom shared-secret\s+authentication/i);
assert.match(runbook, /supabase migration repair/);
assert.match(runbook, /ssmm-stage3-rollback\.sh execute/);

const temp = mkdtempSync(join(tmpdir(), "ssmm-rollback-test-"));
const validator = "scripts/validate-rollback-evidence.mjs";
const check = (kind, body, shouldPass, extra = []) => {
  const path = join(temp, `${kind}-${Math.random()}.txt`);
  writeFileSync(path, body, { mode: 0o600 });
  const result = spawnSync(process.execPath, [validator, kind, path, ...extra], { encoding: "utf8" });
  assert.equal(result.status === 0, shouldPass, result.stderr || result.stdout);
};

check("functions", JSON.stringify({ functions: [] }), true, ["--empty"]);
check("functions", JSON.stringify({ functions: [{ slug: "ssmm-runtime" }] }), true);
check("functions", JSON.stringify({ functions: [{ slug: "unrelated" }] }), false);
check("secrets", JSON.stringify({ secrets: [{ name: "SSMM_PURPOSE_ID" }] }), true);
check("secrets", JSON.stringify({ secrets: [{ name: "UNRELATED_SECRET" }] }), false);
check("table-stats", '{"rows":[]}', true);
check("table-stats", '{"rows":[{"table":"unexpected"}]}', false);

const dryRun = [
  "202607260001_ssmm_spike1_runtime.sql",
  "202607310001_ssmm_spike1_authority_integrity.sql",
  "202607310002_ssmm_spike1_creation_revision.sql",
  "202607310003_ssmm_spike1_plpgsql_qualification.sql",
].join("\n");
check("dry-run", dryRun, true);
check("dry-run", `${dryRun}\n202608010001_unexpected.sql`, false);

process.stdout.write("rollback_readiness_static=passed\n");
