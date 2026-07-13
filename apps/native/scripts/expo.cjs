/*
 * npm may place Expo inside this workspace when the desktop app uses a
 * different React version. Expo's hoisted CLI resolves `expo` from the repo
 * root, so expose this workspace's dependencies through NODE_PATH first.
 */
const Module = require('node:module');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspaceModules = path.resolve(__dirname, '..', 'node_modules');
process.env.NODE_PATH = [workspaceModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module.Module._initPaths();

const cli = require.resolve('expo/bin/cli', { paths: [workspaceModules] });
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
