import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { handleTerminalConnection, setSharedTerminalMode } from './terminal.js';
import http from 'http';
import { exec } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 6060;
const wss = new WebSocketServer({ noServer: true });

setSharedTerminalMode(false); // shared terminal flag

function sanitizePath(p) {
  return os.platform() === 'win32' ? p : p.replace(/(["\s'$`\\])/g, '\\$1');
}

// Shell-based file copy function
function copyFilesWithShell(sourceDir, destDir, ws) {
  const isWindows = os.platform() === 'win32';

  const safeSource = sanitizePath(sourceDir);
  const safeDest = sanitizePath(destDir);

  let command;
  if (isWindows) {
    // robocopy returns:
    // 0 = no files copied, 1 = files copied, ≥8 = error
    command = `robocopy "${safeSource}" "${safeDest}" /E /NFL /NDL /NJH /NJS /nc /ns /np`;
  } else {
    command = `cp -a "${safeSource}/." "${safeDest}/"`;
  }

  const proc = exec(command);

  proc.stdout.on('data', (data) => {
    console.log('[Copy STDOUT]', data);
    // Could parse robocopy output here
  });

  proc.stderr.on('data', (err) => {
    console.error('[Copy STDERR]', err);
    ws.send(JSON.stringify({ action: 'error', message: err }));
  });

  proc.on('close', (code) => {
    if (os.platform() === 'win32') {
      if (code >= 0 && code <= 7) {
        ws.send(JSON.stringify({ action: 'progress', progress: 100 }));
        ws.send(JSON.stringify({ action: 'done' }));
      } else {
        ws.send(JSON.stringify({ action: 'error', message: `Copy failed with exit code ${code}` }));
      }
    } else {
      if (code === 0) {
        ws.send(JSON.stringify({ action: 'progress', progress: 100 }));
        ws.send(JSON.stringify({ action: 'done' }));
      } else {
        ws.send(JSON.stringify({ action: 'error', message: `Copy failed with exit code ${code}` }));
      }
    }
  });
}

// HTTP static file server
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  const route = req.url === '/' ? 'index.html' : req.url.slice(1);
  const filePath = path.join(__dirname, route);
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const ext = path.extname(route);
  const contentType = contentTypes[ext] || 'application/octet-stream';

  fs.readFile(normalizedPath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      return res.end(err.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  handleTerminalConnection(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'startCopy') {
        const { source, destination } = data;
        copyFilesWithShell(source, destination, ws);
      }
    } catch (err) {
      ws.send(
        JSON.stringify({ action: 'error', message: 'Invalid message format.' })
      );
    }
  });
});

// Heartbeat to check WebSocket connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Upgrade HTTP to WebSocket
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
