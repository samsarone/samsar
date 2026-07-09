#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_PROCESSOR_CONTAINER = 'samsar-processor-1';
const MIN_PASSWORD_LENGTH = 8;

const PROCESSOR_RESET_SCRIPT = String.raw`
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

import User from './src/schema/User.js';
import { getDBConnectionString } from './src/models/DBString.js';

const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(data));
  });
}

function describeAdmin(user) {
  return {
    id: user._id.toString(),
    email: user.email || '',
    username: user.username || '',
    isAdminUser: Boolean(user.isAdminUser),
    isEmailVerified: Boolean(user.isEmailVerified),
    dockerAdminBootstrappedAt: user.dockerAdminBootstrappedAt || null,
    updatedAt: user.updatedAt || null,
  };
}

async function findDockerAdmins() {
  return User.find({
    $or: [
      { isAdminUser: true },
      { dockerAdminBootstrappedAt: { $exists: true, $ne: null } },
    ],
  })
    .sort({ dockerAdminBootstrappedAt: -1, updatedAt: -1 })
    .select('_id email username isAdminUser isEmailVerified dockerAdminBootstrappedAt updatedAt');
}

async function resolveAdmin(email) {
  if (email) {
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error('No user found for ' + email + '. Run with --list to see Docker admin users.');
    }
    if (!user.isAdminUser && !user.dockerAdminBootstrappedAt) {
      throw new Error(email + ' is not marked as the Docker admin user.');
    }
    return user;
  }

  const admins = await findDockerAdmins();
  if (admins.length === 0) {
    throw new Error('No Docker admin user found.');
  }
  if (admins.length > 1) {
    console.log(JSON.stringify({ ok: false, admins: admins.map(describeAdmin) }, null, 2));
    throw new Error('More than one Docker admin user exists. Re-run with --email admin@example.com.');
  }
  return admins[0];
}

async function main() {
  if (process.env.CURRENT_ENV !== 'docker') {
    throw new Error('This command must run inside the Docker processor container.');
  }

  const payload = JSON.parse((await readStdin()) || '{}');
  await getDBConnectionString();

  if (payload.action === 'list') {
    const admins = await findDockerAdmins();
    console.log(JSON.stringify({ ok: true, admins: admins.map(describeAdmin) }, null, 2));
    return;
  }

  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Admin password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.');
  }

  const user = await resolveAdmin(email);
  user.password = await bcrypt.hash(password, 10);
  user.isAdminUser = true;
  user.isEmailVerified = true;
  user.isPremiumUser = true;
  user.generationCredits = Math.max(Number(user.generationCredits) || 0, 100000);
  user.hasFreeTrialClaimed = true;
  await user.save();

  console.log(JSON.stringify({
    ok: true,
    message: 'Docker admin password reset.',
    user: describeAdmin(user),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
`;

function usage() {
  console.log(`Usage:
  node utils/reset-docker-admin-password.mjs --list
  node utils/reset-docker-admin-password.mjs --email admin@example.com
  node utils/reset-docker-admin-password.mjs admin@example.com

Options:
  --email, -e       Admin email to reset. Optional only when exactly one Docker admin exists.
  --password, -p    New password. Prefer the interactive prompt so it is not stored in shell history.
  --container, -c   Processor container name. Defaults to ${DEFAULT_PROCESSOR_CONTAINER}.
  --list            List Docker admin users.
`);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseArgs(argv) {
  const args = {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || process.env.SAMSAR_ADMIN_PASSWORD || '',
    container: process.env.SAMSAR_PROCESSOR_CONTAINER || DEFAULT_PROCESSOR_CONTAINER,
    list: false,
    help: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--list') {
      args.list = true;
    } else if (arg === '--email' || arg === '-e') {
      args.email = argv[++i] || '';
    } else if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length);
    } else if (arg === '--password' || arg === '-p') {
      args.password = argv[++i] || '';
    } else if (arg.startsWith('--password=')) {
      args.password = arg.slice('--password='.length);
    } else if (arg === '--container' || arg === '-c') {
      args.container = argv[++i] || '';
    } else if (arg.startsWith('--container=')) {
      args.container = arg.slice('--container='.length);
    } else if (arg.startsWith('-')) {
      throw new Error('Unknown option: ' + arg);
    } else {
      positional.push(arg);
    }
  }

  if (!args.email && positional[0]) {
    args.email = positional[0];
  }
  if (!args.password && positional[1]) {
    args.password = positional[1];
  }

  args.email = normalizeEmail(args.email);
  args.container = args.container || DEFAULT_PROCESSOR_CONTAINER;
  return args;
}

function runSync(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function getDockerCommand(container) {
  const psArgs = ['ps', '--format', '{{.Names}}'];
  const direct = runSync('docker', psArgs);
  if (direct.status === 0) {
    if (!direct.stdout.split(/\r?\n/).includes(container)) {
      throw new Error('Processor container not found: ' + container + '\nRunning containers:\n' + direct.stdout.trim());
    }
    return { command: 'docker', prefixArgs: [] };
  }

  if (process.platform !== 'win32') {
    const sudoCheck = runSync('sudo', ['-n', 'true']);
    if (sudoCheck.status === 0) {
      const sudo = runSync('sudo', ['-n', 'docker', ...psArgs]);
      if (sudo.status === 0) {
        if (!sudo.stdout.split(/\r?\n/).includes(container)) {
          throw new Error('Processor container not found: ' + container + '\nRunning containers:\n' + sudo.stdout.trim());
        }
        return { command: 'sudo', prefixArgs: ['-n', 'docker'] };
      }
    }
  }

  throw new Error((direct.stderr || direct.stdout || 'Unable to run docker ps.').trim());
}

function runProcessorScript({ container, payload }) {
  const docker = getDockerCommand(container);
  const args = [
    ...docker.prefixArgs,
    'exec',
    '-i',
    '-w',
    '/app',
    container,
    'node',
    '--input-type=module',
    '-e',
    PROCESSOR_RESET_SCRIPT,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(docker.command, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Processor reset command failed with exit code ' + code + '.'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function promptPassword(label) {
  if (!process.stdin.isTTY) {
    throw new Error('No password was provided. Re-run in a terminal prompt or set ADMIN_PASSWORD.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.stdoutMuted = false;
  rl._writeToOutput = function writeToOutput(text) {
    rl.output.write(rl.stdoutMuted ? '*' : text);
  };

  return new Promise((resolve) => {
    rl.question(label, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

async function getPassword(initialPassword) {
  if (initialPassword) {
    return initialPassword;
  }

  const password = await promptPassword('New admin password: ');
  const confirmation = await promptPassword('Confirm new admin password: ');
  if (password !== confirmation) {
    throw new Error('Passwords do not match.');
  }
  return password;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.list) {
    await runProcessorScript({
      container: args.container,
      payload: { action: 'list' },
    });
    return;
  }

  const password = await getPassword(args.password);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Admin password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.');
  }

  await runProcessorScript({
    container: args.container,
    payload: {
      action: 'reset',
      email: args.email,
      password,
    },
  });
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
