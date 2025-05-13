// Create a WebSocket connection to the server
const socket = new WebSocket(
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
);

const term = new Terminal({ cursorBlink: true });
let hasStartedCopyProgress = false;

// Utility: Displays a temporary message to the user
const showMessage = (text, type = 'info') => {
  const container = document.getElementById('progress-bar-container');
  const existingMessage = document.getElementById('status-message');
  
  // Remove previous message
  if (existingMessage) existingMessage.remove();

  // Create a new status message element
  const msg = document.createElement('div');
  msg.id = 'status-message';
  msg.textContent = text;
  msg.style.cssText = `
    position: relative;
    top: 10px;
    padding: 10px;
    border-radius: 6px;
    margin-top: 10px;
    font-weight: bold;
    max-width: 1000px;
    text-align: center;
    transition: opacity 0.5s ease-in-out;
    opacity: 1;
    background-color: ${type === 'error' ? '#ff4c4c' : '#4caf50'};
    color: #fff;
  `;

  container.appendChild(msg);

  // Hide the message after 3 seconds
  setTimeout(() => {
    msg.style.opacity = '0';
    setTimeout(() => msg.remove(), 1000);
  }, 3000);
};

// Initializes the terminal instance
const initTerminal = () => {
  if (term._initialized) return;

  term._initialized = true;
  term.open(document.getElementById('terminal'));

  // Send keystrokes from the terminal to the server
  term.onKey(({ key }) => socket.send(key));

  // Handle paste events (Ctrl+V / Cmd+V)
  term.attachCustomKeyEventHandler((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      navigator.clipboard.readText().then(text => socket.send(text));
      return false; // prevent default paste behavior
    }
    return true;
  });
};

// Sends a request to start the copy operation
const startCopy = () => {
  const source = document.getElementById('sourcePath')?.value;
  const destination = document.getElementById('destinationPath')?.value;

  if (!source || !destination) {
    showMessage('Please enter both source and destination paths.', 'error');
    return;
  }

  hasStartedCopyProgress = false;
  socket.send(JSON.stringify({ action: 'startCopy', source, destination }));
  updateProgressBar(0);
};

// Updates the progress bar based on the current progress percentage
const updateProgressBar = (progress) => {
  const percent = Math.max(0, Math.min(progress, 100));
  document.getElementById('progress').style.width = `${percent}%`;

  // Show "Copy started" message only when progress starts
  if (!hasStartedCopyProgress && percent > 0) {
    hasStartedCopyProgress = true;
    showMessage('Copy started...', 'info');
  }
};

// Handles the WebSocket message events from the server
const handleWebSocketMessage = ({ data }) => {
  try {
    const msg = JSON.parse(data);

    switch (msg.action) {
      case 'progress':
        updateProgressBar(msg.progress);
        break;
      case 'done':
        showMessage('All files and folders copied successfully!');
        break;
      case 'error':
        showMessage(`Error: ${msg.message}`, 'error');
        break;
      case 'terminal':
        term.write(msg.output);
        break;
      default:
        console.error(`Unknown action: ${msg.action}`);
    }
  } catch (error) {
    console.error('Failed to parse WebSocket message:', data);
    term.write(data); // Handle raw data (e.g., from terminal output)
  }
};

// WebSocket event handlers
socket.onopen = initTerminal;

socket.onmessage = handleWebSocketMessage;

socket.onerror = (err) => {
  console.error('WebSocket error:', err);
  showMessage('WebSocket connection error.', 'error');
};

socket.onclose = () => {
  term.write('\r\nDisconnected from server.\r\n');
  showMessage('Disconnected from server.', 'error');
};
