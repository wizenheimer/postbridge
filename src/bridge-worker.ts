/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BRIDGE SHAREDWORKER - DUMB RELAY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This SharedWorker acts as a message relay for cross-tab broadcasting.
 * It contains ZERO business logic - it only routes messages between tabs.
 *
 * WHY A DUMB RELAY?
 * ────────────────
 * - Business logic stays in tabs (easier debugging, hot-reload friendly)
 * - Worker doesn't need schema updates (generic and reusable)
 * - Reduces serialization overhead (no function transfer needed)
 * - Simplifies architecture (worker is just a router)
 *
 * HOW IT WORKS:
 * ────────────
 * 1. Tabs connect via SharedWorker and get unique tabIDs
 * 2. Each tab registers which methods it supports
 * 3. When a tab broadcasts a method call:
 *    - Worker receives BRIDGE_BROADCAST message
 *    - Worker relays as BRIDGE_RELAY to ALL other tabs (excludes sender)
 * 4. Receiving tabs execute the method locally and fire listeners
 *
 * MESSAGE FLOW:
 * ────────────
 * Tab A: remote.increment(5)
 *   ↓ BRIDGE_BROADCAST { methodName: "increment", args: [5], senderTabID: "A" }
 * Worker: Relay to all tabs except A
 *   ↓ BRIDGE_RELAY to Tab B
 *   ↓ BRIDGE_RELAY to Tab C
 *   ↓ BRIDGE_RELAY to Tab D
 * Tabs B,C,D: Execute increment(5), fire listeners
 *
 * STATE MANAGEMENT:
 * ────────────────
 * Worker maintains a map of connected tabs:
 * {
 *   "tabID1": { port: MessagePort, methods: ["increment", "decrement"] },
 *   "tabID2": { port: MessagePort, methods: ["increment", "decrement"] }
 * }
 *
 * This allows:
 * - Broadcasting to all tabs except sender
 * - Cleanup when tabs disconnect
 * - (Future) Method filtering based on available methods
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  bridgeActions,
  BridgeHandshakePayload,
  BridgeHandshakeAckPayload,
  BridgeHandshakeErrorPayload,
  BridgeBroadcastPayload,
  BridgeRelayPayload,
  BridgeDisconnectPayload,
  BridgeGetTabsPayload,
  BridgeTabsResponsePayload,
  BridgeDirectMessagePayload,
} from "./types";

/**
 * Tab Connection Info
 * ──────────────────
 * Stores information about a connected tab.
 */
interface TabConnection {
  /** MessagePort for communicating with this tab */
  port: MessagePort;
  /** Array of method names this tab supports */
  methods: string[];
  /** Channel this tab is connected to */
  channel: string;
}

/**
 * Channel State
 * ─────────────
 * Isolated state space for a channel.
 * Each channel maintains its own tabs and shared state.
 */
interface ChannelState {
  /** Tabs connected to this channel */
  tabs: Map<string, TabConnection>;
  /** Shared state for this channel */
  sharedState: Record<string, any>;
}

/**
 * Channels Registry
 * ────────────────
 * Maps channel name → ChannelState for isolated state spaces.
 *
 * Why channels?
 * - Allows multiple independent Bridge connections
 * - Each channel has isolated state (no mixing)
 * - Broadcasts only reach tabs on the same channel
 * - Default channel: "default" for backward compatibility
 */
const channels: Map<string, ChannelState> = new Map();

/**
 * Get or Create Channel
 * ────────────────────
 * Returns the ChannelState for a given channel name.
 * Creates it if it doesn't exist.
 */
function getOrCreateChannel(channelName: string): ChannelState {
  if (!channels.has(channelName)) {
    channels.set(channelName, {
      tabs: new Map(),
      sharedState: {},
    });
    console.log(`[Bridge Worker] Created channel: ${channelName}`);
  }
  return channels.get(channelName)!;
}

/**
 * SharedWorker Connection Handler
 * ───────────────────────────────
 * Called when a new tab connects to the SharedWorker.
 * Sets up message handling for this tab's port.
 */
(self as any).onconnect = (event: MessageEvent) => {
  const port = event.ports[0];

  // Message handler for this port
  port.onmessage = (event: MessageEvent) => {
    const data = event.data;

    // Handle different message types
    switch (data.action) {
      case bridgeActions.BRIDGE_HANDSHAKE:
        handleHandshake(port, data as BridgeHandshakePayload);
        break;

      case bridgeActions.BRIDGE_BROADCAST:
        handleBroadcast(data as BridgeBroadcastPayload);
        break;

      case bridgeActions.BRIDGE_DISCONNECT:
        handleDisconnect(data as BridgeDisconnectPayload);
        break;

      case bridgeActions.BRIDGE_GET_STATE:
        // Return current shared state for a specific channel
        const getStateData = data as { channel: string };
        const getStateChannel = getOrCreateChannel(getStateData.channel || "default");
        port.postMessage({
          action: bridgeActions.BRIDGE_STATE_RESPONSE,
          state: { ...getStateChannel.sharedState },
        });
        break;

      case bridgeActions.BRIDGE_SET_STATE:
        // Update shared state and broadcast to all tabs on the same channel
        const setStateData = data as { key: string; value: any; channel: string };
        const setStateChannel = getOrCreateChannel(setStateData.channel || "default");
        setStateChannel.sharedState[setStateData.key] = setStateData.value;

        // Broadcast state change to all tabs on this channel
        for (const [tabID, connection] of setStateChannel.tabs.entries()) {
          try {
            connection.port.postMessage({
              action: bridgeActions.BRIDGE_STATE_UPDATE,
              key: setStateData.key,
              value: setStateData.value,
            });
          } catch (error) {
            console.error(`[Bridge Worker] Failed to broadcast state to ${tabID}:`, error);
          }
        }
        break;

      case bridgeActions.BRIDGE_GET_TABS:
        // Return list of connected tab IDs for a channel
        handleGetTabs(port, data as BridgeGetTabsPayload);
        break;

      case bridgeActions.BRIDGE_DIRECT_MESSAGE:
        // Relay message to specific tab only
        handleDirectMessage(data as BridgeDirectMessagePayload);
        break;

      default:
        // Unknown action - ignore
        break;
    }
  };

  // Start the port
  port.start();
};

/**
 * Handle Handshake
 * ───────────────
 * Registers a new tab connection to a specific channel.
 *
 * Flow:
 * 1. Tab sends BRIDGE_HANDSHAKE with tabID, methodNames, channel, and initial state
 * 2. Worker gets or creates the channel
 * 3. Worker stores tab connection in channel's tab registry
 * 4. Worker initializes channel's shared state (if first tab on this channel)
 * 5. Worker sends BRIDGE_HANDSHAKE_ACK with current shared state for this channel
 *
 * @param port The MessagePort for this tab
 * @param payload The handshake payload
 */
function handleHandshake(port: MessagePort, payload: BridgeHandshakePayload) {
  const { tabID, methodNames, channel: channelName = "default" } = payload;

  // Get or create channel
  const channel = getOrCreateChannel(channelName);

  // Check for duplicate tabID
  if (channel.tabs.has(tabID)) {
    const existingConnection = channel.tabs.get(tabID)!;

    console.warn(
      `[Bridge Worker] Duplicate tabID "${tabID}" on channel "${channelName}". Disconnecting old connection.`,
    );

    // Disconnect old connection
    try {
      existingConnection.port.postMessage({
        action: bridgeActions.BRIDGE_HANDSHAKE_ERROR,
        error: "This tab ID is already in use by another connection. The old connection has been closed.",
        code: "DUPLICATE_TAB_ID",
        tabID,
        channel: channelName,
      } as BridgeHandshakeErrorPayload);
      existingConnection.port.close();
    } catch (error) {
      console.error(`[Bridge Worker] Failed to close old connection:`, error);
    }

    // Remove old connection
    channel.tabs.delete(tabID);
  }

  // Register tab connection in this channel
  channel.tabs.set(tabID, {
    port,
    methods: methodNames,
    channel: channelName,
  });

  // Initialize shared state from first tab's schema (if this is the first tab on this channel)
  if (channel.tabs.size === 1 && payload.schema) {
    Object.assign(channel.sharedState, payload.schema);
  }

  // Send acknowledgment with current shared state for this channel
  const ackPayload: BridgeHandshakeAckPayload = {
    action: bridgeActions.BRIDGE_HANDSHAKE_ACK,
    tabID,
    channel: channelName,
    sharedState: { ...channel.sharedState },
  };
  port.postMessage(ackPayload);

  console.log(`[Bridge Worker] Tab ${tabID} connected to channel "${channelName}" with methods:`, methodNames);
}

/**
 * Handle Broadcast
 * ───────────────
 * Relays a broadcast from one tab to all other tabs ON THE SAME CHANNEL.
 *
 * Flow:
 * 1. Tab A sends BRIDGE_BROADCAST with channel, methodName and args
 * 2. Worker relays as BRIDGE_RELAY to all tabs on same channel EXCEPT Tab A
 * 3. Each receiving tab executes the method locally
 *
 * CHANNEL ISOLATION:
 * Broadcasts only reach tabs on the same channel.
 * Tabs on different channels never receive each other's broadcasts.
 *
 * NO ECHO:
 * The sender is explicitly excluded from receiving the relay.
 * This prevents infinite loops and duplicate execution.
 *
 * @param payload The broadcast payload
 */
function handleBroadcast(payload: BridgeBroadcastPayload) {
  const { senderTabID, channel: channelName = "default", methodName, args, result, error } = payload;

  // Get the channel (should exist since sender is on it)
  const channel = channels.get(channelName);
  if (!channel) {
    console.error(`[Bridge Worker] Broadcast on non-existent channel: ${channelName}`);
    return;
  }

  // Build relay payload
  const relayPayload: BridgeRelayPayload = {
    action: bridgeActions.BRIDGE_RELAY,
    senderTabID,
    methodName,
    args,
    senderResult: result,
    senderError: error,
  };

  // Broadcast to all tabs on this channel except sender
  let relayCount = 0;
  for (const [tabID, connection] of channel.tabs.entries()) {
    // Skip sender (no echo)
    if (tabID === senderTabID) continue;

    // (Future optimization) Skip tabs that don't have this method
    // if (!connection.methods.includes(methodName)) continue;

    try {
      connection.port.postMessage(relayPayload);
      relayCount++;
    } catch (error) {
      console.error(`[Bridge Worker] Failed to relay to tab ${tabID}:`, error);
    }
  }

  console.log(
    `[Bridge Worker] Relayed ${methodName} from ${senderTabID} to ${relayCount} tabs on channel "${channelName}"`,
  );
}

/**
 * Handle Disconnect
 * ────────────────
 * Removes a tab from its channel's tab registry.
 *
 * Flow:
 * 1. Tab sends BRIDGE_DISCONNECT when closing connection
 * 2. Worker removes tab from its channel
 * 3. If channel becomes empty, it's cleaned up
 * 4. Future broadcasts won't be sent to this tab
 *
 * @param payload The disconnect payload
 */
/**
 * Handle Get Tabs
 * ───────────────
 * Returns list of all connected tab IDs on a channel.
 *
 * @param port The MessagePort of the requesting tab
 * @param payload The get tabs payload
 */
function handleGetTabs(port: MessagePort, payload: BridgeGetTabsPayload) {
  const { channel: channelName = "default", requestingTabID } = payload;

  const channel = channels.get(channelName);
  const tabIDs = channel ? Array.from(channel.tabs.keys()) : [];

  const responsePayload: BridgeTabsResponsePayload = {
    action: bridgeActions.BRIDGE_TABS_RESPONSE,
    tabIDs,
    channel: channelName,
  };

  port.postMessage(responsePayload);

  console.log(
    `[Bridge Worker] Tab ${requestingTabID} requested tabs on channel "${channelName}": [${tabIDs.join(", ")}]`,
  );
}

/**
 * Handle Direct Message
 * ────────────────────
 * Relays a message from one tab to a specific target tab only.
 *
 * @param payload The direct message payload
 */
function handleDirectMessage(payload: BridgeDirectMessagePayload) {
  const { senderTabID, targetTabID, channel: channelName = "default", methodName, args, result, error } = payload;

  const channel = channels.get(channelName);
  if (!channel) {
    console.warn(`[Bridge Worker] Channel "${channelName}" not found for direct message`);
    return;
  }

  const targetConnection = channel.tabs.get(targetTabID);
  if (!targetConnection) {
    console.warn(
      `[Bridge Worker] Target tab ${targetTabID} not found on channel "${channelName}" for direct message from ${senderTabID}`,
    );
    return;
  }

  // Relay message to target tab
  const relayPayload: BridgeRelayPayload = {
    action: bridgeActions.BRIDGE_RELAY,
    senderTabID,
    methodName,
    args,
    senderResult: result,
    senderError: error,
  };

  try {
    targetConnection.port.postMessage(relayPayload);
    console.log(
      `[Bridge Worker] Relayed direct message "${methodName}" from ${senderTabID} to ${targetTabID} on channel "${channelName}"`,
    );
  } catch (err) {
    console.error(`[Bridge Worker] Failed to send direct message to ${targetTabID}:`, err);
  }
}

function handleDisconnect(payload: BridgeDisconnectPayload) {
  const { tabID, channel: channelName = "default" } = payload;

  const channel = channels.get(channelName);
  if (channel && channel.tabs.has(tabID)) {
    channel.tabs.delete(tabID);
    console.log(`[Bridge Worker] Tab ${tabID} disconnected from channel "${channelName}"`);

    // Cleanup empty channels (optional optimization)
    if (channel.tabs.size === 0) {
      channels.delete(channelName);
      console.log(`[Bridge Worker] Channel "${channelName}" cleaned up (no tabs remaining)`);
    }
  }
}

/**
 * EMBEDDING INSTRUCTIONS:
 * ──────────────────────
 * To embed this worker as a Blob URL, the Bridge client will:
 * 1. Convert this file to a string
 * 2. Create a Blob: new Blob([workerCode], { type: 'application/javascript' })
 * 3. Create URL: URL.createObjectURL(blob)
 * 4. Create SharedWorker: new SharedWorker(url)
 *
 * This enables zero-configuration deployment - no separate worker file needed!
 */
