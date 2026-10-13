import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

console.log('================================================================');
console.log(' Starting GuideHub Local Server + High-Speed Cloudflare Tunnel');
console.log('================================================================\n');

// Automatically free port 3000 if a previous local server instance is still bound
try {
  if (process.platform === 'win32') {
    const out = execSync('netstat -ano | findstr :3000', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && Number(pid) !== process.pid) {
          pids.add(pid);
        }
      }
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {}
    }
  }
} catch (e) {}

// Start Express server directly in the same process
await import('../server/server.js');

setTimeout(() => {
  const cloudflaredCli = path.join(ROOT_DIR, 'node_modules', 'cloudflared', 'lib', 'cloudflared.js');

  if (fs.existsSync(cloudflaredCli)) {
    console.log('\n Generating high-speed public HTTPS link (Cloudflare Tunnel)...\n');
    const tunnelProc = spawn(
      'node',
      [cloudflaredCli, 'tunnel', '--url', 'http://127.0.0.1:3000'],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit'
      }
    );

    tunnelProc.on('exit', code => {
      console.log(`\n[Tunnel closed with code ${code}]`);
    });

    process.on('SIGINT', () => {
      tunnelProc.kill('SIGINT');
      process.exit(0);
    });
  } else {
    console.log('\n Generating shareable public HTTPS link (localhost.run fallback)...\n');
    const tunnelProc = spawn(
      'ssh',
      ['-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=30', '-R', '80:127.0.0.1:3000', 'nokey@localhost.run'],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit'
      }
    );

    tunnelProc.on('exit', code => {
      console.log(`\n[Tunnel closed with code ${code}]`);
    });

    process.on('SIGINT', () => {
      tunnelProc.kill('SIGINT');
      process.exit(0);
    });
  }
}, 1000);
