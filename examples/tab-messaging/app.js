import { bridge } from "../lib/postbridge.js";

// DOM elements
const myTabIdEl = document.getElementById("my-tab-id");
const tabCountEl = document.getElementById("tab-count");
const messageInput = document.getElementById("message-input");
const broadcastBtn = document.getElementById("broadcast-btn");
const tabsList = document.getElementById("tabs-list");
const messageLog = document.getElementById("message-log");

// Schema: Message relay methods
// These functions execute in ALL tabs (sender + receivers)
const schema = {
  // Broadcast message to all tabs
  broadcastMessage: (message, senderName, senderId) => {
    // This function runs in ALL tabs automatically
    // The sender's log is handled when they call the function
    // Other tabs receive this and execute it automatically
    if (connection && senderId !== connection.id) {
      addLogEntry(
        `From ${shortenId(senderName)}`,
        message,
        "received-broadcast"
      );
    }
    return { message, sender: senderName, timestamp: Date.now() };
  },

  // Direct message to specific tab
  directMessage: (message, senderName, recipientId) => {
    // This function only runs in the target tab (direct message)
    // Check if this tab is the intended recipient
    if (connection && recipientId === connection.id) {
      addLogEntry(
        `From ${shortenId(senderName)} (Direct)`,
        message,
        "received-direct"
      );
    }
    return { message, sender: senderName, recipient: recipientId, timestamp: Date.now() };
  },
};

// Initialize Bridge connection
let connection;

async function init() {
  try {
    connection = await bridge.connect(schema, {
      workerURL: "/lib/bridge-worker.js",
      channel: "message-relay",
    });

    // Display my tab ID
    myTabIdEl.textContent = connection.id;

    // Refresh tabs list
    await refreshTabsList();

    // Auto-refresh tabs list every 2 seconds
    setInterval(refreshTabsList, 2000);

    // Log initial connection
    addLogEntry("System", "Connected to message relay", "system");
  } catch (error) {
    console.error("Failed to connect:", error);
    myTabIdEl.textContent = "Connection failed";
  }
}

// Refresh the list of connected tabs
async function refreshTabsList() {
  const tabs = await connection.getConnectedTabs();

  // Update count
  tabCountEl.textContent = tabs.length;

  // Clear and rebuild list
  tabsList.innerHTML = "";

  if (tabs.length === 1) {
    tabsList.innerHTML = '<p class="empty-state">No other tabs connected</p>';
    return;
  }

  tabs.forEach((tabId) => {
    const isMe = tabId === connection.id;

    const tabItem = document.createElement("div");
    tabItem.className = `tab-item ${isMe ? "me" : ""}`;

    const tabInfo = document.createElement("div");
    tabInfo.className = "tab-info";

    const badge = document.createElement("span");
    badge.className = "tab-badge";
    badge.textContent = isMe ? "YOU" : "TAB";

    const tabIdSpan = document.createElement("span");
    tabIdSpan.className = "tab-id";
    tabIdSpan.textContent = shortenId(tabId);

    tabInfo.appendChild(badge);
    tabInfo.appendChild(tabIdSpan);
    tabItem.appendChild(tabInfo);

    if (!isMe) {
      const actions = document.createElement("div");
      actions.className = "tab-actions";

      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Send Message";
      sendBtn.onclick = () => sendDirectMessage(tabId);
      actions.appendChild(sendBtn);

      tabItem.appendChild(actions);
    }

    tabsList.appendChild(tabItem);
  });
}

// Send broadcast message
async function sendBroadcastMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  try {
    await connection.remote.broadcastMessage(message, connection.id, connection.id);
    addLogEntry("You (Broadcast)", message, "sent-broadcast");
    messageInput.value = "";
  } catch (error) {
    console.error("Failed to send broadcast:", error);
  }
}

// Send direct message to specific tab
async function sendDirectMessage(targetTabId) {
  const message = messageInput.value.trim() || "Hello!";

  try {
    await connection.remote(targetTabId).directMessage(message, connection.id, targetTabId);
    addLogEntry(`You → ${shortenId(targetTabId)} (Direct)`, message, "sent-direct");

    if (messageInput.value.trim()) {
      messageInput.value = "";
    }
  } catch (error) {
    console.error("Failed to send direct message:", error);
  }
}

// Add entry to message log
function addLogEntry(sender, message, type) {
  // Remove empty state if present
  const emptyState = messageLog.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }

  const entry = document.createElement("div");
  entry.className = `log-entry ${getLogClass(type)}`;

  const header = document.createElement("div");
  header.className = "log-header";

  const senderSpan = document.createElement("span");
  senderSpan.textContent = sender;

  const typeSpan = document.createElement("span");
  typeSpan.className = "log-type";
  typeSpan.textContent = getTypeLabel(type);

  header.appendChild(senderSpan);
  header.appendChild(typeSpan);

  const messageDiv = document.createElement("div");
  messageDiv.className = "log-message";
  messageDiv.textContent = message;

  entry.appendChild(header);
  entry.appendChild(messageDiv);

  messageLog.insertBefore(entry, messageLog.firstChild);

  // Limit log entries to 50
  while (messageLog.children.length > 50) {
    messageLog.removeChild(messageLog.lastChild);
  }
}

// Get CSS class for log entry type
function getLogClass(type) {
  if (type === "sent-broadcast" || type === "received-broadcast") return "broadcast";
  if (type === "sent-direct") return "sent";
  if (type === "received-direct") return "received";
  return "";
}

// Get label for log entry type
function getTypeLabel(type) {
  if (type === "sent-broadcast") return "Broadcast Sent";
  if (type === "received-broadcast") return "Broadcast Received";
  if (type === "sent-direct") return "Direct Sent";
  if (type === "received-direct") return "Direct Received";
  if (type === "system") return "System";
  return "";
}

// Shorten tab ID for display
function shortenId(id) {
  if (id.length <= 12) return id;
  return `${id.substring(0, 6)}...${id.substring(id.length - 6)}`;
}

// Event listeners
broadcastBtn.addEventListener("click", sendBroadcastMessage);

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendBroadcastMessage();
  }
});

// Initialize on page load
init();

