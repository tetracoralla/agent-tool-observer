import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ObserverError } from "./errors.mjs";

export const LAUNCH_AGENT_LABEL = "com.openadam.agent-tool-observer";

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertRegularFile(filePath, code) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ObserverError(code, "Installation input must be a regular non-symlinked file");
  }
  return fs.realpathSync(filePath);
}

function resolveStableNodePath() {
  const candidates = [
    "/opt/homebrew/opt/node@22/bin/node",
    "/opt/homebrew/bin/node",
    process.execPath
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    const stat = fs.lstatSync(resolved);
    if (stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0) {
      return path.resolve(candidate);
    }
  }
  throw new ObserverError("NODE_EXECUTABLE_INVALID", "No supported Node 22 executable resolved to a regular executable file");
}

function assertDirectory(directory, create = false) {
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ObserverError("INSTALL_DIRECTORY_INVALID", "Installation directory must be a real directory");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ObserverError("INSTALL_DIRECTORY_PERMISSIONS", "Installation directory must be accessible only to its owner");
  }
}

function runtimeSourceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function runtimeInventory(root = runtimeSourceRoot()) {
  const files = ["package.json"];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new ObserverError("OBSERVER_RUNTIME_INVALID", "Observer runtime source must not contain symlinks");
      }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path.relative(root, absolute));
    }
  };
  walk(path.join(root, "src"));
  return files.sort();
}

function runtimeDigest(root, inventory) {
  const digest = createHash("sha256");
  for (const relative of inventory) {
    const absolute = path.join(root, relative);
    assertRegularFile(absolute, "OBSERVER_RUNTIME_INVALID");
    digest.update(relative).update("\0").update(fs.readFileSync(absolute)).update("\0");
  }
  return digest.digest("hex");
}

function copyRuntimeBundle(config, options = {}) {
  const sourceRoot = options.sourceRoot ?? runtimeSourceRoot();
  const inventory = runtimeInventory(sourceRoot);
  const digest = runtimeDigest(sourceRoot, inventory);
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const version = String(packageJson.version);
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version)) {
    throw new ObserverError("OBSERVER_RUNTIME_INVALID", "Observer package version is invalid");
  }
  const runtimeRoot = path.join(config.stateDir, "runtime");
  const bundlePath = path.join(runtimeRoot, `${version}-${digest}`);
  const cliPath = path.join(bundlePath, "src", "cli.mjs");
  if (options.dryRun) return { version, digest, bundlePath, cliPath, inventory };

  assertDirectory(config.stateDir, true);
  if (!fs.existsSync(runtimeRoot)) fs.mkdirSync(runtimeRoot, { mode: 0o700 });
  assertDirectory(runtimeRoot);
  if (fs.existsSync(bundlePath)) {
    assertDirectory(bundlePath);
    const installedInventory = runtimeInventory(bundlePath);
    const installedDigest = runtimeDigest(bundlePath, installedInventory);
    if (installedDigest !== digest || JSON.stringify(installedInventory) !== JSON.stringify(inventory)) {
      throw new ObserverError("OBSERVER_RUNTIME_COLLISION", "Existing content-addressed runtime does not match its source digest");
    }
    return { version, digest, bundlePath, cliPath, inventory };
  }

  const staging = `${bundlePath}.staging-${process.pid}`;
  if (fs.existsSync(staging)) {
    throw new ObserverError("OBSERVER_RUNTIME_STAGING_EXISTS", "Observer runtime staging path already exists");
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    for (const relative of inventory) {
      const destination = path.join(staging, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(sourceRoot, relative), destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
    }
    if (runtimeDigest(staging, runtimeInventory(staging)) !== digest) {
      throw new ObserverError("OBSERVER_RUNTIME_COPY_FAILED", "Copied Observer runtime digest does not match its source");
    }
    fs.renameSync(staging, bundlePath);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { version, digest, bundlePath, cliPath, inventory };
}

function ensureOwnerLogFile(filePath) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ObserverError("LOG_TARGET_INVALID", "LaunchAgent log target must be a regular non-symlinked file");
    }
    fs.chmodSync(filePath, 0o600);
    return;
  }
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600
  );
  fs.closeSync(descriptor);
}

export function prepareOwnerLogFiles(paths) {
  ensureOwnerLogFile(paths.stdoutPath);
  ensureOwnerLogFile(paths.stderrPath);
}

export function installationPaths(config, homeDirectory = os.homedir()) {
  const launchAgentsDir = path.join(homeDirectory, "Library", "LaunchAgents");
  return {
    launchAgentsDir,
    plistPath: path.join(launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`),
    stdoutPath: path.join(config.logsDir, "launchd.stdout.log"),
    stderrPath: path.join(config.logsDir, "launchd.stderr.log")
  };
}

export function renderLaunchAgent({ nodePath, cliPath, stdoutPath, stderrPath, directRuntimeLogs = [], intervalSeconds = 300 }) {
  const directRuntimeLogValue = directRuntimeLogs.join(path.delimiter);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>--no-warnings</string>
    <string>${xmlEscape(cliPath)}</string>
    <string>collect</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ATO_DIRECT_RUNTIME_LOGS</key>
    <string>${xmlEscape(directRuntimeLogValue)}</string>
  </dict>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function runLaunchctl(argumentsList, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", argumentsList, {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new ObserverError("LAUNCHCTL_FAILED", "launchctl could not apply the observer service", {
      exitCode: result.status,
      operation: argumentsList[0],
      output: String(result.stderr || result.stdout || "").trim().slice(0, 1000),
      plistWritten: true
    });
  }
  return result;
}

function bootstrapLaunchAgent(domain, plistPath) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = runLaunchctl(["bootstrap", domain, plistPath], true);
    if (!last.error && last.status === 0) return;
    // launchd can need a short bounded drain after bootout before the same
    // label is accepted again. Keep the retry local and below one second.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
  }
  throw new ObserverError("LAUNCHCTL_FAILED", "launchctl could not bootstrap the observer service after bounded retries", {
    exitCode: last?.status ?? null,
    operation: "bootstrap",
    output: String(last?.stderr || last?.stdout || "").trim().slice(0, 1000),
    plistWritten: true
  });
}

export function installLaunchAgent(config, options = {}) {
  const nodePath = resolveStableNodePath();
  const runtime = copyRuntimeBundle(config, { dryRun: options.dryRun });
  const cliPath = options.dryRun
    ? runtime.cliPath
    : assertRegularFile(runtime.cliPath, "OBSERVER_CLI_INVALID");
  const paths = installationPaths(config, options.homeDirectory);
  const plist = renderLaunchAgent({ nodePath, cliPath, directRuntimeLogs: config.directRuntimeLogs, ...paths });
  const preflight = {
    label: LAUNCH_AGENT_LABEL,
    nodePath,
    cliPath,
    plistPath: paths.plistPath,
    stateDir: config.stateDir,
    runtimeVersion: runtime.version,
    runtimeDigest: runtime.digest,
    runtimePath: runtime.bundlePath,
    intervalSeconds: 300,
    directRuntimeLogs: config.directRuntimeLogs
  };
  if (options.dryRun) return { status: "dry-run", ...preflight };

  assertDirectory(config.stateDir, true);
  assertDirectory(config.logsDir, true);
  assertDirectory(paths.launchAgentsDir, true);
  prepareOwnerLogFiles(paths);
  if (fs.existsSync(paths.plistPath)) {
    const current = fs.lstatSync(paths.plistPath);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new ObserverError("PLIST_TARGET_INVALID", "LaunchAgent target must be a regular non-symlinked file");
    }
  }
  const temporary = `${paths.plistPath}.tmp-${process.pid}`;
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, plist, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, paths.plistPath);
  fs.chmodSync(paths.plistPath, 0o600);

  const domain = `gui/${process.getuid()}`;
  runLaunchctl(["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`], true);
  bootstrapLaunchAgent(domain, paths.plistPath);
  runLaunchctl(["enable", `${domain}/${LAUNCH_AGENT_LABEL}`]);
  runLaunchctl(["print", `${domain}/${LAUNCH_AGENT_LABEL}`]);
  return { status: "installed", ...preflight };
}

export function uninstallLaunchAgent(config, options = {}) {
  const paths = installationPaths(config, options.homeDirectory);
  const domain = `gui/${process.getuid()}`;
  runLaunchctl(["bootout", `${domain}/${LAUNCH_AGENT_LABEL}`], true);
  if (fs.existsSync(paths.plistPath)) {
    const stat = fs.lstatSync(paths.plistPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ObserverError("PLIST_TARGET_INVALID", "LaunchAgent target must be a regular non-symlinked file");
    }
    fs.unlinkSync(paths.plistPath);
  }
  return { status: "uninstalled", label: LAUNCH_AGENT_LABEL, statePreserved: true };
}

export function purgeStateDirectory(config) {
  const stateDir = path.resolve(config.stateDir);
  if (!fs.existsSync(stateDir)) return { status: "purged", stateDir, removed: false };
  const info = fs.lstatSync(stateDir);
  const root = path.parse(stateDir).root;
  const depth = stateDir.slice(root.length).split(path.sep).filter(Boolean).length;
  if (!info.isDirectory() || info.isSymbolicLink() || stateDir === path.resolve(os.homedir()) || depth < 3) {
    throw new ObserverError("PURGE_STATE_DIR_UNSAFE", "Refusing to recursively remove an unsafe Observer state directory");
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new ObserverError("PURGE_STATE_DIR_UNSAFE", "Observer state directory is not owned by the current user");
  }
  fs.rmSync(stateDir, { recursive: true, force: false });
  return { status: "purged", stateDir, removed: true };
}

export { copyRuntimeBundle, runtimeInventory };
