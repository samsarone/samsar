import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');

const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('the Unix launcher is executable and does not require npm', () => {
  const launcherPath = path.join(rootDir, 'setup.sh');
  const launcher = read('setup.sh');
  const mode = fs.statSync(launcherPath).mode & 0o777;

  assert.ok(mode & 0o100, 'setup.sh must be executable by its owner');
  assert.match(launcher, /scripts\/setup-wizard-docker\.sh/);
  assert.doesNotMatch(launcher, /\bnpm\b|\bnode\b|\byarn\b/);
  assert.match(read('scripts/setup-wizard-docker.sh'), /Usage: \.\/setup\.sh/);
});

test('the host bootstrap installs Docker without installing Node tooling', () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const bootstrap = launcher.match(/bootstrap_host\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(bootstrap, /install_docker_engine/);
  assert.match(bootstrap, /start_docker_service/);
  assert.match(bootstrap, /ensure_docker_desktop_macos_version/);
  assert.match(bootstrap, /ensure_linux_docker_requirements/);
  assert.doesNotMatch(launcher, /install_nodejs|nodesource|install_yarn_if_needed/);
  assert.match(launcher, /docker-ce docker-ce-cli containerd\.io docker-buildx-plugin docker-compose-plugin/);
});

test('the Linux launcher enforces compatible Engine and Compose capabilities', () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const updateSection = launcher.slice(
    launcher.indexOf('update_existing_docker_linux() {'),
    launcher.indexOf('running_docker_engine_meets_minimum() {'),
  );

  assert.match(launcher, /MIN_DOCKER_ENGINE_LINUX_VERSION="20\.10\.0"/);
  assert.match(launcher, /MIN_DOCKER_COMPOSE_VERSION="2\.20\.0"/);
  assert.match(launcher, /docker_cli version --format '\{\{\.Server\.Version\}\}'/);
  assert.match(launcher, /docker_cli compose version --short/);
  assert.match(launcher, /docker_cli buildx version/);
  assert.match(updateSection, /docker_is_desktop_backed/);
  assert.match(updateSection, /update_existing_docker_desktop_linux/);
  assert.match(launcher, /docker_cli desktop update --quiet/);
  assert.match(updateSection, /docker_is_rootless/);
  assert.match(updateSection, /update_existing_docker_(apt|rpm|apk|snap)/);
  assert.doesNotMatch(updateSection, /install_docker_convenience_script|get\.docker\.com/);
  assert.match(launcher, /dpkg_owner_of_active_docker_cli/);
  assert.match(launcher, /rpm_owner_of_active_docker_cli/);
  assert.match(launcher, /active_docker_cli_is_snap/);
  assert.match(launcher, /active_docker_endpoint/);
  assert.match(launcher, /moby-compose docker-compose/);
  assert.match(launcher, /moby-buildx docker-buildx/);
  assert.doesNotMatch(launcher, /pacman -Sy --needed/);
  assert.match(launcher, /pacman -Syu --needed --noconfirm docker docker-compose docker-buildx/);
});

test('Linux version probes accept vendor suffixes and reject deficient tooling', {
  skip: process.platform === 'win32',
}, () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const versionFunctions = launcher.slice(
    launcher.indexOf('version_at_least() {'),
    launcher.indexOf('docker_desktop_macos_version() {'),
  );
  const probeFunctions = launcher.slice(
    launcher.indexOf('probe_linux_docker_requirements() {'),
    launcher.indexOf('detect_docker_socket_path() {'),
  );
  const script = `
set -euo pipefail
${versionFunctions}
${probeFunctions}
MIN_DOCKER_ENGINE_LINUX_VERSION=20.10.0
MIN_DOCKER_COMPOSE_VERSION=2.20.0
DOCKER_ENGINE_VERSION=''
DOCKER_COMPOSE_VERSION=''
DOCKER_ENGINE_COMPATIBLE=0
DOCKER_COMPOSE_COMPATIBLE=0
DOCKER_BUILDX_AVAILABLE=0
docker_cli() {
  case "$1" in
    version) printf '%s\\n' "\${MOCK_ENGINE_VERSION}" ;;
    compose)
      [[ -n "\${MOCK_COMPOSE_VERSION}" ]] || return 1
      printf '%s\\n' "\${MOCK_COMPOSE_VERSION}"
      ;;
    buildx) [[ "\${MOCK_BUILDX}" == 1 ]] ;;
    *) return 1 ;;
  esac
}
MOCK_ENGINE_VERSION='29.6.2+vendor'
MOCK_COMPOSE_VERSION='v2.40.3-desktop.1'
MOCK_BUILDX=1
probe_linux_docker_requirements
linux_docker_requirements_met
printf '%s|%s\\n' "$DOCKER_ENGINE_VERSION" "$DOCKER_COMPOSE_VERSION"
MOCK_ENGINE_VERSION='19.03.15'
MOCK_COMPOSE_VERSION=''
MOCK_BUILDX=0
probe_linux_docker_requirements
if linux_docker_requirements_met; then exit 1; fi
printf '%s|%s|%s\\n' "$DOCKER_ENGINE_COMPATIBLE" "$DOCKER_COMPOSE_COMPATIBLE" "$DOCKER_BUILDX_AVAILABLE"
`;

  const output = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(output, '29.6.2|2.40.3\n0|0|0\n');
});

test('Linux bootstrap and provenance guards avoid the wrong Docker installation', {
  skip: process.platform === 'win32',
}, () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const enabledFunction = launcher.slice(
    launcher.indexOf('enabled() {'),
    launcher.indexOf('version_at_least() {'),
  );
  const startFunction = launcher.slice(
    launcher.indexOf('start_docker_service() {'),
    launcher.indexOf('target_docker_user() {'),
  );
  const aptFamilyFunction = launcher.slice(
    launcher.indexOf('detect_apt_docker_family() {'),
    launcher.indexOf('dpkg_package_installed() {'),
  );
  const groupFunctions = launcher.slice(
    launcher.indexOf('target_docker_user() {'),
    launcher.indexOf('try_docker_info() {'),
  );
  const rpmFamilyFunctions = launcher.slice(
    launcher.indexOf('rpm_package_installed() {'),
    launcher.indexOf('rpm_package_available() {'),
  );
  const apkUpdateFunction = launcher.slice(
    launcher.indexOf('update_existing_docker_apk() {'),
    launcher.indexOf('snap_docker_installed() {'),
  );
  const script = `
set -euo pipefail
${enabledFunction}
${startFunction}
${aptFamilyFunction}
${groupFunctions}
${rpmFamilyFunctions}
${apkUpdateFunction}
warn() { :; }
log() { :; }
is_linux() { return 0; }
uname() { printf 'Linux\\n'; }
active_docker_endpoint() { printf 'unix:///var/run/docker.sock\\n'; }
run_as_root() { MUTATIONS=$((MUTATIONS + 1)); }
docker() {
  [[ "$1" == info ]] || return 1
  return "$MOCK_INFO_STATUS"
}
MUTATIONS=0
MOCK_INFO_STATUS=0
BOOTSTRAP_ENABLED=1
start_docker_service
[[ "$MUTATIONS" == 0 ]]
MOCK_INFO_STATUS=1
BOOTSTRAP_ENABLED=0
start_docker_service
[[ "$MUTATIONS" == 0 ]]
ensure_docker_group_permissions
[[ "$MUTATIONS" == 0 ]]
DOCKER_ENGINE_COMPATIBLE=1
dpkg_owner_of_active_docker_cli() { printf 'docker-ce-cli\\n'; }
dpkg_package_installed() {
  [[ "$1" == docker-ce-cli || "$1" == docker.io ]]
}
family="$(detect_apt_docker_family || true)"
[[ -z "$family" ]]
rpm_owner_of_active_docker_cli() { printf 'docker-cli\n'; }
rpm_package_installed() { [[ "$1" == moby-engine || "$1" == docker-cli ]]; }
family="$(detect_rpm_docker_family)"
[[ "$family" == moby ]]
[[ "$(rpm_cli_package_for_family "$family")" == docker-cli ]]
active_docker_cli_paths() { printf '/usr/bin/docker\n'; }
apk() {
  if [[ "$1 $2" == 'info --who-owns' ]]; then
    printf '/usr/bin/docker is owned by %s\n' "$APK_OWNER"
    return 0
  fi
  return 1
}
DOCKER_COMPOSE_COMPATIBLE=1
DOCKER_BUILDX_AVAILABLE=1
APK_OWNER='podman-docker-5.4.2-r0'
if update_existing_docker_apk; then exit 1; fi
APK_OWNER='docker-cli-29.0.0-r0'
update_existing_docker_apk
[[ "$MUTATIONS" == 0 ]]
`;

  execFileSync('bash', ['-c', script]);
});

test('the setup wizard mounts the active local Docker context socket', {
  skip: process.platform === 'win32',
}, () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const endpointFunction = launcher.slice(
    launcher.indexOf('active_docker_endpoint() {'),
    launcher.indexOf('select_docker_command() {'),
  );
  const socketFunction = launcher.slice(
    launcher.indexOf('detect_docker_socket_path() {'),
    launcher.indexOf('is_interactive_terminal() {'),
  );
  const script = `
set -euo pipefail
${endpointFunction}
${socketFunction}
die() { printf '%s\\n' "$*" >&2; exit 1; }
docker_is_desktop_backed() { [[ "$MOCK_DESKTOP" == 1 ]]; }
is_wsl_environment() { return 1; }
uname() { printf 'Linux\\n'; }
docker_cli() {
  if [[ "$1 $2" == 'context show' ]]; then
    printf 'desktop-linux\\n'
  elif [[ "$1 $2" == 'context inspect' ]]; then
    printf '%s\\n' "$MOCK_ENDPOINT"
  else
    return 1
  fi
}
DOCKER_HOST=''
DOCKER_CONTEXT=''
SAMSAR_SETUP_DOCKER_SOCKET=''
MOCK_DESKTOP=0
MOCK_ENDPOINT='unix:///home/test/.docker/desktop/docker.sock'
[[ "$(detect_docker_socket_path)" == '/home/test/.docker/desktop/docker.sock' ]]
MOCK_ENDPOINT='ssh://docker.example.test'
if (detect_docker_socket_path >/dev/null 2>&1); then exit 1; fi
MOCK_DESKTOP=1
[[ "$(detect_docker_socket_path)" == '/var/run/docker.sock.raw' ]]
`;

  execFileSync('bash', ['-c', script]);
});

test('the macOS launcher enforces a Docker Desktop version with the wake fixes', () => {
  const launcher = read('scripts/setup-wizard-docker.sh');
  const readme = read('README.md');
  const installFunction = launcher.slice(
    launcher.indexOf('install_docker_engine() {'),
    launcher.indexOf('start_docker_service() {'),
  );

  assert.match(launcher, /MIN_DOCKER_DESKTOP_MACOS_VERSION="4\.84\.0"/);
  assert.match(launcher, /CFBundleShortVersionString/);
  assert.match(launcher, /docker desktop update --quiet/);
  assert.match(launcher, /brew upgrade --cask docker/);
  assert.match(installFunction, /! -d \/Applications\/Docker\.app[\s\S]*install_docker_desktop_macos/);
  assert.match(readme, /Docker Desktop 4\.84\.0 or newer/);
});

test('remote setup also uses the npm-free launcher', () => {
  const remoteLauncher = read('scripts/setup-wizard-remote.sh');

  assert.match(remoteLauncher, /\.\/setup\.sh --no-open-setup-port/);
  assert.doesNotMatch(remoteLauncher, /npm run setup-wizard/);
});

test('the setup-wizard image owns its Node and Compose dependencies', () => {
  const dockerfile = read('apps/setup-wizard/Dockerfile');

  assert.match(dockerfile, /^FROM node:20 AS builder/m);
  assert.match(dockerfile, /^FROM node:20-alpine/m);
  assert.match(dockerfile, /docker-cli-compose/);
  assert.match(dockerfile, /COPY storageConfig\.mjs \.\/storageConfig\.mjs/);
  assert.match(dockerfile, /CMD \["node", "server\.mjs"\]/);
});

test('the Unix launcher forwards only approved setup environment variables', () => {
  const launcher = read('scripts/setup-wizard-docker.sh');

  assert.match(launcher, /DEFAULT_PROVIDER_ENV_NAMES=\(/);
  assert.match(launcher, /OPENAI_API_KEY/);
  assert.match(launcher, /GOOGLE_APPLICATION_CREDENTIALS_JSON_B64/);
  assert.match(launcher, /MONGO_URL/);
  assert.match(launcher, /SMTP_PASSWORD/);
  assert.match(launcher, /AWS_SES_SECRET_ACCESS_KEY/);
  assert.match(launcher, /AWS_SECRET_ACCESS_KEY/);
  assert.match(launcher, /B2_HOST/);
  assert.match(launcher, /CLOUDFRONT_PRIVATE_KEY/);
  assert.match(launcher, /SAMSAR_SETUP_PROVIDER_ENV_NAMES/);
  assert.match(launcher, /PROVIDER_ENV_DOCKER_ARGS\+=\(--env "\$name=\$\{!name\}"\)/);
  assert.match(
    launcher,
    /\$\{PROVIDER_ENV_DOCKER_ARGS\[@\]\+"\$\{PROVIDER_ENV_DOCKER_ARGS\[@\]\}"\}/,
  );
  assert.doesNotMatch(launcher, /--env-file[^\n]*(?:env|environment)/i);

  const script = `
set -euo pipefail
PROVIDER_ENV_DOCKER_ARGS=()
capture_args() {
  [[ "$#" == 1 ]]
  [[ "$1" == "setup-wizard-image" ]]
}
capture_args \${PROVIDER_ENV_DOCKER_ARGS[@]+"\${PROVIDER_ENV_DOCKER_ARGS[@]}"} setup-wizard-image
`;
  execFileSync('bash', ['-c', script]);
});

test('Windows launchers bootstrap Docker Desktop without npm', () => {
  const powershell = read('setup.ps1');
  const command = read('setup.cmd');

  assert.match(powershell, /Docker\.DockerDesktop/);
  assert.match(powershell, /Invoke-NativeProcess/);
  assert.match(powershell, /'install'/);
  assert.match(powershell, /MinimumDockerDesktopVersion = \[Version\] '4\.84\.0'/);
  assert.match(powershell, /LOCALAPPDATA[\s\S]*Programs\\DockerDesktop/);
  assert.match(powershell, /DisplayVersion/);
  assert.match(powershell, /SAMSAR_SETUP_BOOTSTRAP/);
  assert.match(powershell, /SAMSAR_SETUP_INSTALL_DOCKER/);
  assert.match(powershell, /'desktop', 'update', '--quiet'/);
  assert.match(powershell, /'upgrade'/);
  assert.match(powershell, /--include-unknown/);
  assert.match(powershell, /Wait-ForCompatibleDockerDesktopInstallation[\s\S]*Attempts = 60/);
  assert.doesNotMatch(powershell, /winget\.exe[^\n]*2>&1/);
  assert.doesNotMatch(powershell, /winget\.exe uninstall/);
  assert.match(powershell, /wsl\.exe/);
  assert.doesNotMatch(powershell, /\bnpm\b|\byarn\b/);
  assert.match(command, /setup\.ps1/);
  assert.match(read('.github/workflows/ci.yml'), /shell: powershell/);
});
