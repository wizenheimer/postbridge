# Bridge Multi-Channel Example

A demonstration of channel isolation in Bridge with two independent counter apps.

**Pattern Used:** Channel Isolation
- Two separate channels: `counter-a` and `counter-b`
- Each channel maintains completely isolated state
- Changes in Channel A do not affect Channel B (and vice versa)

## Quick Start

1. **Build the library:**
   ```bash
   npm run build
   ```

2. **Serve the example:**
   ```bash
   npx serve .
   ```

3. **Open in browser:**
   - Navigate to `http://localhost:3000/examples/multi-channel/`
   - Open the same URL in multiple tabs
   - Interact with both counters

## What to Try

### Test Channel Isolation

1. **Increment Channel A** in Tab 1
   - Watch Channel A counter update in all tabs
   - Notice Channel B counter remains unchanged

2. **Increment Channel B** in Tab 2
   - Watch Channel B counter update in all tabs
   - Notice Channel A counter remains unchanged

3. **Reset one channel**
   - Only that channel resets across all tabs
   - The other channel maintains its state

### Open Multiple Tabs

- Open 3-4 tabs with the same URL
- Each tab shows both channels
- Changes to Channel A sync across all tabs
- Changes to Channel B sync across all tabs
- But Channel A and B never interfere with each other!

## Key Observations

### Channel Isolation

```
Tab 1 (counter-a)         Tab 2 (counter-a)
  increment A                 sees A=1
  A=1, B=0                    A=1, B=0
```

```
Tab 1 (counter-b)         Tab 2 (counter-b)
  increment B                 sees B=1
  A=1, B=1                    A=1, B=1
```

**Result:** Each channel maintains independent state across all tabs.

### Shared Worker Architecture

```
┌─────────────────────────────────────────────────────┐
│          SharedWorker (Single)                      │
│                                                     │
│  Channel A                Channel B                 │
│  ├─ State: { counter: 5 }  ├─ State: { counter: 3 } │
│  ├─ Tabs: [tab1, tab2]     ├─ Tabs: [tab1, tab2]    │
│  └─ Broadcasts only        └─ Broadcasts only       │
│     within Channel A           within Channel B     │
└─────────────────────────────────────────────────────┘
```

## Implementation Details

### Channel A

```javascript
const connectionA = await bridge.connect(schemaA, {
  channel: 'counter-a'  // Isolated state space
});
```

### Channel B

```javascript
const connectionB = await bridge.connect(schemaB, {
  channel: 'counter-b'  // Separate isolated state space
});
```

### Same Tab, Different Channels

Both connections exist simultaneously in the same browser tab, but they operate independently:

- Different `channel` names
- Different state spaces in the SharedWorker
- Different broadcast groups
- No cross-channel communication

## Use Cases

This pattern is useful for:

1. **Multiple Independent Apps**
   - Counter app and Todo app in the same domain
   - Each needs its own state synchronization
   - No interference between apps

2. **Multi-Tenant Applications**
   - Different channels for different tenants
   - Complete data isolation
   - Single codebase, multiple instances

3. **Feature Isolation**
   - Chat feature on `chat-channel`
   - Notifications on `notification-channel`
   - Dashboard on `dashboard-channel`

4. **Testing and Development**
   - Test multiple instances without interference
   - Debug one channel without affecting others

## Comparison with Single Channel

### Without Channels (Default)
```javascript
// Both use the same "default" channel
const conn1 = await bridge.connect(schema1);
const conn2 = await bridge.connect(schema2);
// State can mix and interfere
```

### With Channels
```javascript
// Isolated channels
const conn1 = await bridge.connect(schema1, { channel: 'app1' });
const conn2 = await bridge.connect(schema2, { channel: 'app2' });
// Complete isolation
```

## Further Reading

- [Multiple Connections Guide](../docs/guides/multiple-connections.md) - When and how to use channels
- [Understanding Shared State](../docs/guides/understanding-shared-state.md) - State management in Bridge
- [Bridge Documentation](../docs/guides/bridge.md) - Full API reference

