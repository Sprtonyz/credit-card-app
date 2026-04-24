const { spawn } = require('child_process');
const path = require('path');

const command = process.argv[2];
const forwardedArgs = process.argv.slice(3);

const supported = new Set(['dev', 'build', 'start', 'export']);
if (!supported.has(command)) {
  console.error(`Unsupported Next command: ${command || '(missing)'}`);
  process.exit(1);
}

const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
const distDir = command === 'dev' ? '.next-dev' : '.next';

const child = spawn(process.execPath, [nextBin, command, ...forwardedArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
