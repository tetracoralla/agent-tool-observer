import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fixtureConfig, temporaryRoot } from "./helpers.mjs";
import { installLaunchAgent, prepareOwnerLogFiles, renderLaunchAgent } from "../src/installer.mjs";

test("LaunchAgent runs one fixed short-lived collector without KeepAlive or shell", () => {
  const plist = renderLaunchAgent({
    nodePath: "/safe/node&binary",
    cliPath: "/safe/observer<cli>.mjs",
    stdoutPath: "/safe/out.log",
    stderrPath: "/safe/err.log"
  });
  assert.match(plist, /<key>StartInterval<\/key>/);
  assert.match(plist, /<integer>300<\/integer>/);
  assert.doesNotMatch(plist, /KeepAlive/);
  assert.doesNotMatch(plist, /\/bin\/(?:ba|z)?sh/);
  assert.doesNotMatch(plist, /kickstart/);
  assert.match(plist, /<string>--quiet<\/string>/);
  assert.doesNotMatch(plist, /<string>--json<\/string>/);
  assert.match(plist, /node&amp;binary/);
  assert.match(plist, /observer&lt;cli&gt;/);
});

test("install dry-run performs no filesystem mutation", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const fakeHome = `${root}/not-created-home`;
    const result = installLaunchAgent(config, { dryRun: true, homeDirectory: fakeHome });
    assert.equal(result.status, "dry-run");
    assert.equal(fs.existsSync(fakeHome), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("LaunchAgent log preparation repairs modes and rejects symlink targets", () => {
  const root = temporaryRoot();
  try {
    const stdoutPath = path.join(root, "stdout.log");
    const stderrPath = path.join(root, "stderr.log");
    fs.writeFileSync(stdoutPath, "existing", { mode: 0o644 });
    prepareOwnerLogFiles({ stdoutPath, stderrPath });
    assert.equal(fs.lstatSync(stdoutPath).mode & 0o777, 0o600);
    assert.equal(fs.lstatSync(stderrPath).mode & 0o777, 0o600);

    fs.unlinkSync(stderrPath);
    fs.symlinkSync(stdoutPath, stderrPath);
    assert.throws(() => prepareOwnerLogFiles({ stdoutPath, stderrPath }), { code: "LOG_TARGET_INVALID" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
