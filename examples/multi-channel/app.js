import { bridge } from '../lib/postbridge.js';

// Channel A Elements
const statusAEl = document.getElementById('statusA');
const tabIdAEl = document.getElementById('tabIdA');
const counterAEl = document.getElementById('counterA');
const incrementABtn = document.getElementById('incrementA');
const decrementABtn = document.getElementById('decrementA');
const resetABtn = document.getElementById('resetA');

// Channel B Elements
const statusBEl = document.getElementById('statusB');
const tabIdBEl = document.getElementById('tabIdB');
const counterBEl = document.getElementById('counterB');
const incrementBBtn = document.getElementById('incrementB');
const decrementBBtn = document.getElementById('decrementB');
const resetBBtn = document.getElementById('resetB');

// Schema for Channel A
const schemaA = {
  counter: 0,
  setCounter: (newValue, remote) => {
    remote.counter = newValue;
    counterAEl.textContent = newValue;
    return newValue;
  }
};

// Schema for Channel B
const schemaB = {
  counter: 0,
  setCounter: (newValue, remote) => {
    remote.counter = newValue;
    counterBEl.textContent = newValue;
    return newValue;
  }
};

// Initialize Channel A
async function initChannelA() {
  try {
    statusAEl.textContent = '[CONNECTING] Initializing Channel A...';
    statusAEl.className = 'status connecting';

    const connectionA = await bridge.connect(schemaA, {
      workerURL: '/lib/bridge-worker.js',
      channel: 'counter-a'
    });

    // Connected!
    statusAEl.textContent = '[CONNECTED] Channel A synced';
    statusAEl.className = 'status connected';
    tabIdAEl.textContent = connectionA.id.substring(0, 8);

    // Initialize display with shared state
    counterAEl.textContent = connectionA.remote.counter;

    // Wire up buttons
    incrementABtn.onclick = () => {
      const newValue = connectionA.remote.counter + 1;
      connectionA.remote.setCounter(newValue);
    };

    decrementABtn.onclick = () => {
      const newValue = connectionA.remote.counter - 1;
      connectionA.remote.setCounter(newValue);
    };

    resetABtn.onclick = () => {
      connectionA.remote.setCounter(0);
    };

    // Enable buttons
    incrementABtn.disabled = false;
    decrementABtn.disabled = false;
    resetABtn.disabled = false;

    console.log('[Channel A] Connected:', connectionA.id);
  } catch (error) {
    console.error('[Channel A] Error:', error);
    statusAEl.textContent = '[ERROR] Failed to connect';
    statusAEl.className = 'status error';
  }
}

// Initialize Channel B
async function initChannelB() {
  try {
    statusBEl.textContent = '[CONNECTING] Initializing Channel B...';
    statusBEl.className = 'status connecting';

    const connectionB = await bridge.connect(schemaB, {
      workerURL: '/lib/bridge-worker.js',
      channel: 'counter-b'
    });

    // Connected!
    statusBEl.textContent = '[CONNECTED] Channel B synced';
    statusBEl.className = 'status connected';
    tabIdBEl.textContent = connectionB.id.substring(0, 8);

    // Initialize display with shared state
    counterBEl.textContent = connectionB.remote.counter;

    // Wire up buttons
    incrementBBtn.onclick = () => {
      const newValue = connectionB.remote.counter + 1;
      connectionB.remote.setCounter(newValue);
    };

    decrementBBtn.onclick = () => {
      const newValue = connectionB.remote.counter - 1;
      connectionB.remote.setCounter(newValue);
    };

    resetBBtn.onclick = () => {
      connectionB.remote.setCounter(0);
    };

    // Enable buttons
    incrementBBtn.disabled = false;
    decrementBBtn.disabled = false;
    resetBBtn.disabled = false;

    console.log('[Channel B] Connected:', connectionB.id);
  } catch (error) {
    console.error('[Channel B] Error:', error);
    statusBEl.textContent = '[ERROR] Failed to connect';
    statusBEl.className = 'status error';
  }
}

// Initialize both channels
initChannelA();
initChannelB();

