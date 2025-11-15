// Import from the built library
import { bridge } from '../lib/postbridge.js';

// DOM elements
const counterEl = document.getElementById('counter');
const statusEl = document.getElementById('status');
const tabIdEl = document.getElementById('tabId');
const incrementBtn = document.getElementById('incrementBtn');
const decrementBtn = document.getElementById('decrementBtn');
const resetBtn = document.getElementById('resetBtn');

// Schema - demonstrating the "Single Source of Truth" pattern
// See: docs/guides/shared-state-patterns.md for multi-writer considerations
const schema = {
  // Shared variable: New tabs catch up on current counter value
  counter: 0,

  // Functions use explicit values to avoid multi-writer race conditions
  // Each function takes the new value as argument (caller is source of truth)
  setCounter: (newValue, remote) => {
    remote.counter = newValue;
    counterEl.textContent = newValue;
    return newValue;
  }
};

// Initialize
async function init() {
  try {
    statusEl.textContent = '[CONNECTING] Initializing...';
    
    // Connect - just like Rimless!
    const connection = await bridge.connect(schema, {
      workerURL: '/lib/bridge-worker.js'
    });

    // Connected!
    statusEl.textContent = '[CONNECTED] Synced with all tabs';
    statusEl.className = 'status connected';
    tabIdEl.textContent = connection.id.substring(0, 8);

    // Initialize display with shared state (new tabs catch up automatically!)
    counterEl.textContent = connection.remote.counter;

    // Wire up buttons - caller computes new value, broadcasts to all tabs
    // This avoids multi-writer race conditions (see shared-state-patterns.md)
    incrementBtn.onclick = () => {
      const newValue = connection.remote.counter + 1;
      connection.remote.setCounter(newValue);
    };
    
    decrementBtn.onclick = () => {
      const newValue = connection.remote.counter - 1;
      connection.remote.setCounter(newValue);
    };
    
    resetBtn.onclick = () => {
      connection.remote.setCounter(0);
    };

    // Enable buttons
    incrementBtn.disabled = false;
    decrementBtn.disabled = false;
    resetBtn.disabled = false;

    // Cleanup on unload
    window.addEventListener('beforeunload', () => connection.close());

  } catch (error) {
    statusEl.textContent = '[ERROR] ' + error.message;
    statusEl.className = 'status error';
    console.error('Connection failed:', error);
  }
}

// Start
init();
