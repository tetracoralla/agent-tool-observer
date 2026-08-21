import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

export function renderLaunchAgent({ nodePath, cliPath, stdoutPath, stderrPath, intervalSeconds = 300 }) {
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
      plistWritten: true
    });
  }
  return result;
}

export function installLaunchAgent(config, options = {}) {
  const currentCli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  const nodePath = resolveStableNodePath();
  const cliPath = assertRegularFile(currentCli, "OBSERVER_CLI_INVALID");
  const paths = installationPaths(config, options.homeDirectory);
  const plist = renderLaunchAgent({ nodePath, cliPath, ...paths });
  const preflight = {
    label: LAUNCH_AGENT_LABEL,
    nodePath,
    cliPath,
    plistPath: paths.plistPath,
    stateDir: config.stateDir,
    intervalSeconds: 300
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
  runLaunchctl(["bootstrap", domain, paths.plistPath]);
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
