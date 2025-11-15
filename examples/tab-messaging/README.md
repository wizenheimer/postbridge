# Bridge Message Relay Example

This example demonstrates **direct messaging** and **broadcasting** capabilities of Bridge.

## Features

### Direct Messaging

- Send messages to specific tabs only
- Each tab has a "Send Message" button
- Messages appear only in sender and recipient tabs

### Broadcasting

- Send messages to ALL connected tabs at once
- Click "Broadcast to All" button
- All tabs receive and display the message

### Tab Management

- Real-time list of all connected tabs
- Auto-refreshes every 2 seconds
- Shows your tab ID and total connected tabs

### 📝 Message Log

- Complete history of sent/received messages
- Clear visual distinction between:
  - Broadcast messages (black background)
  - Direct messages sent (gray)
  - Direct messages received (white)

## Running the Example

### Development (with npm serve)

```bash
# From project root
npm run build
npx serve .

# Open http://localhost:3000/examples/tab-messaging/
```

### Production

Ensure the built library files are available:

- `/lib/postbridge.js`
- `/lib/bridge-worker.js`

## How It Works

### Architecture

```
┌──────────────────────────────────────────────────┐
│                Browser Window                    │
├──────────────────────────────────────────────────┤
│  Tab A                                           │
│  ┌─────────────────────────────────────────┐     │
│  │ • My ID: abc-123                        │     │
│  │ • Message: "Hello"                      │     │
│  │                                         │     │
│  │ Connected Tabs:                         │     │
│  │   [YOU] abc-123                         │     │
│  │   [TAB] def-456  [Send Message]  ◄──┐   │     │
│  │   [TAB] ghi-789  [Send Message]     │   │     │
│  │                                     │   │     │
│  │ [Broadcast to All]  ◄─────┐         │   │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
                 │                    │
        Broadcast│           Direct   │
                 ↓                    ↓
┌──────────────────────────────────────────────────┐
│           SharedWorker (Relay)                   │
├──────────────────────────────────────────────────┤
│  Broadcast: Send to ALL tabs on channel          │
│  Direct:    Send to SPECIFIC tab only            │
└──────────────────────────────────────────────────┘
                 ↓                   ↓
       ┌─────────┴─────────┐         │
       ↓                   ↓         ↓
    Tab B               Tab C     Tab B only
```

### Code Structure

#### Schema Definition

```javascript
const schema = {
  // Broadcast: remote.broadcastMessage() → all tabs
  broadcastMessage: (message, senderName, remote) => {
    return { message, sender: senderName, timestamp: Date.now() };
  },

  // Direct: remote(tabID).directMessage() → specific tab
  directMessage: (message, senderName, recipientId, remote) => {
    return { message, sender: senderName, recipient: recipientId };
  },
};
```

#### Broadcast Usage

```javascript
// Send to ALL tabs
await connection.remote.broadcastMessage("Hello everyone!", connection.id);
```

#### Direct Message Usage

```javascript
// Send to SPECIFIC tab
const targetTabId = "def-456";
await connection.remote(targetTabId).directMessage("Hello just you!", connection.id, targetTabId);
```

#### How Messages Work

When any tab calls a schema function, it executes in ALL tabs automatically:

```javascript
// In the schema definition, functions handle their own updates:
const schema = {
  broadcastMessage: (message, senderName, remote) => {
    // This runs in ALL tabs automatically
    console.log(`Broadcast from ${senderName}: ${message}`);
    updateUI(message);
  },

  directMessage: (message, senderName, recipientId, remote) => {
    // This also runs in all tabs, but you can filter by recipient
    if (recipientId === remote.id) {
      console.log(`Direct message from ${senderName}: ${message}`);
      updateUI(message);
    }
  },
};
```

No need for separate `.on()` listeners - your schema functions ARE the handlers!

## Key Concepts

### 1. Tab Discovery

Use `getConnectedTabs()` to find other tabs:

```javascript
const tabs = await connection.getConnectedTabs();
const otherTabs = tabs.filter((id) => id !== connection.id);
```

### 2. Broadcast vs Direct

| Feature    | Broadcast                 | Direct Message           |
| ---------- | ------------------------- | ------------------------ |
| Syntax     | `remote.method()`         | `remote(tabID).method()` |
| Recipients | ALL tabs                  | ONE specific tab         |
| Use Case   | State sync, announcements | P2P communication        |

### 3. Message Filtering

Direct messages execute in all tabs, so you filter by recipient in the schema function:

```javascript
const schema = {
  directMessage: (message, sender, recipientId, remote) => {
    // Only process if I'm the recipient
    if (recipientId === remote.id) {
      handleMessage(message, sender);
    }
  },
};
```

## Testing

### Test Scenario 1: Broadcast

1. Open 3 tabs
2. In Tab 1, type "Hello all" and click "Broadcast to All"
3. Verify: All 3 tabs show the message in their logs

### Test Scenario 2: Direct Message

1. Open 3 tabs (A, B, C)
2. In Tab A, type "Hi B" and click "Send Message" next to Tab B
3. Verify:
   - Tab A log: "You → B (Direct): Hi B"
   - Tab B log: "From A (Direct): Hi B"
   - Tab C log: No new message (not involved)

### Test Scenario 3: Mixed Messages

1. Open 4 tabs
2. Send broadcasts and direct messages
3. Verify message log shows correct types and recipients

## Troubleshooting

### Messages not appearing

- Check browser console for errors
- Ensure SharedWorker is supported (not Safari)
- Verify all tabs are on the same channel ("message-relay")

### Tabs list not updating

- The list auto-refreshes every 2 seconds
- Manually refresh by reopening a tab
- Check that `getConnectedTabs()` is working

### Direct messages going to all tabs

- This is expected - all schema functions execute in all tabs
- Filter by recipient ID in your schema function
- Use `if (recipientId === remote.id)` pattern
- Check worker logs for BRIDGE_DIRECT_MESSAGE actions

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: No SharedWorker support

## Further Reading

- [Bridge Guide](../docs/guides/bridge.md)
- [Direct Messaging Documentation](../docs/guides/bridge.md#-direct-messaging)
- [Channel Isolation](../docs/guides/channel-isolation-example.md)
