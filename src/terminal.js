import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import pty from 'node-pty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sharedPty = null;
let isSharedMode = false;

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const spawnShell = () => pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.env.HOME,
  env: process.env,
});

// Set whether the terminal should be shared across multiple clients
export const setSharedTerminalMode = (enable) => {
  isSharedMode = enable;
  if (isSharedMode && !sharedPty) {
    sharedPty = spawnShell();  // Only spawn a shared terminal once
  }
};

// Handle terminal WebSocket connections
export const handleTerminalConnection = (ws) => {
  // Use a shared terminal if in shared mode; otherwise, spawn a new terminal for the connection
  const ptyProcess = isSharedMode ? sharedPty : spawnShell();

  // Stream terminal output back to the client
  ptyProcess.onData((data) => {
    console.log('[Terminal Output]:', data); // Debugging: Log terminal output
    ws.send(JSON.stringify({ action: 'terminal', output: data }));
  });

  // Handle incoming WebSocket messages
  ws.on('message', (message) => {
    try {
      // Try to parse the incoming message as JSON
      const data = JSON.parse(message);

    } catch (error) {
      // If the message is not valid JSON, treat it as raw terminal input and write to the pty process
      console.log('[Command Executing]:', message);
      
      // Display command in terminal UI
      ws.send(JSON.stringify({
        action: 'debug',
        message: `Command Executed: ${message}`, // Send the executed command back to the client to display
      }));

      // Write the command to the terminal
      ptyProcess.write(message);
    }
  });

  // Clean up the terminal process when the WebSocket connection is closed
  ws.on('close', () => {
    if (!isSharedMode && ptyProcess) {
      ptyProcess.kill();
    }
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.send(JSON.stringify({ action: 'error', message: 'An error occurred with the WebSocket connection.' }));
  });
};
