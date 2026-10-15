/**
 * Unified Microservices Launcher for FlowMaster
 * Launches Orchestrator, Verification Service, and Credit Service concurrently
 */
const { spawn } = require('child_process');
const path = require('path');

const services = [
  {
    name: 'VERIFICATION',
    color: '\x1b[35m', // Magenta
    cwd: path.resolve(__dirname, '../backend/verification-service'),
    script: 'src/index.js',
  },
  {
    name: 'CREDIT',
    color: '\x1b[33m', // Yellow
    cwd: path.resolve(__dirname, '../backend/credit-service'),
    script: 'src/index.js',
  },
  {
    name: 'ORCHESTRATOR',
    color: '\x1b[36m', // Cyan
    cwd: path.resolve(__dirname, '../backend/orchestrator-service'),
    script: 'src/index.js',
  },
];

const RESET = '\x1b[0m';

console.log(`${RESET}=======================================================`);
console.log(`Starting FlowMaster Microservices Pipeline...`);
console.log(`=======================================================`);

const processes = [];

services.forEach(({ name, color, cwd, script }) => {
  const child = spawn('node', [script], {
    cwd,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.log(`${color}[${name}]${RESET} ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.error(`${color}[${name}:ERR]${RESET} ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`${color}[${name}]${RESET} Exited with code ${code}`);
  });

  processes.push(child);
});

// Handle termination signals
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`\nStopping all services...`);
    processes.forEach((p) => p.kill(sig));
    process.exit(0);
  });
});
