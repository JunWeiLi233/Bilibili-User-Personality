import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { classifyScenario, SCENARIOS } from "../services/contextClassifier.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const COMPARATOR = join(__dirname, "compareContextClassifier.js");

const FIXTURES = [
  ["哈哈哈笑死我了", "taunting"],
  ["你有证据吗？请提供数据来源", "argument"],
  ["太强了！牛逼！支持！", "praise"],
  ["别急，慢慢来，没关系的", "reassurance"],
  ["我太菜了，萌新一个", "self_deprecation"],
  ["https://www.bilibili.com/video/BV1xx411c7mD", "neutral_info"],
  ["", "neutral_info"],
];

test("contextClassifier JS classifies taunting", () => {
  const r = classifyScenario("哈哈哈笑死我了");
  assert.strictEqual(r.scenario, "taunting");
  assert.ok(r.confidence > 0);
});

test("contextClassifier JS classifies argument", () => {
  const r = classifyScenario("你有证据吗？请提供数据来源");
  assert.strictEqual(r.scenario, "argument");
});

test("contextClassifier JS classifies praise", () => {
  const r = classifyScenario("太强了！牛逼！支持！");
  assert.strictEqual(r.scenario, "praise");
});

test("contextClassifier JS returns neutral_info for empty text", () => {
  const r = classifyScenario("");
  assert.strictEqual(r.scenario, "neutral_info");
  assert.strictEqual(r.confidence, 0);
});

test("contextClassifier Python fixture parity", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [COMPARATOR, "--json"],
    { cwd: PROJECT_ROOT, timeout: 30000 }
  );
  const result = JSON.parse(stdout);
  assert.ok(result.ok, `Mismatches: ${JSON.stringify(result.mismatches)}`);
  assert.strictEqual(result.mismatches.length, 0);
});

test("contextClassifier JS scenarios match Python scenarios", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [COMPARATOR, "--json"],
    { cwd: PROJECT_ROOT, timeout: 30000 }
  );
  const result = JSON.parse(stdout);
  assert.deepStrictEqual(result.jsScenarios, result.pyScenarios);
});

test("contextClassifier fixture coverage — all scenarios exercise at least one fixture", () => {
  const texts = FIXTURES.map(([t]) => t).filter(Boolean);
  const seen = new Set();
  for (const text of texts) {
    seen.add(classifyScenario(text).scenario);
  }
  for (const s of SCENARIOS) {
    assert.ok(seen.has(s), `Scenario ${s} should be exercised by at least one fixture`);
  }
});
