# Implementation Plan: Real-time Collaboration

## Context

This proposal introduces real-time collaborative editing to the Plannotator editor, letting reviewers annotate the same plan simultaneously with sub-second visibility of each other's cursors and edits. We are targeting **production-grade concurrency** for up to 50 active collaborators per document, with end-to-end edit-to-visible latency under 150ms at the 95th percentile. The implementation uses operational transforms running on a dedicated Node.js gateway that speaks `WebSocket` to clients and `gRPC` to the storage tier.

Runtime parameters for phase one:

```typescript
export const COLLAB_CONFIG = {
  maxCollaborators: 50,
  heartbeatIntervalMs: 5_000,
  operationBatchSize: 32,
  gateway: "wss://collab.plannotator.ai",
} as const;
```

| Parameter | Value | Description |
| --- | --- | --- |
| `maxCollaborators` | 50 | Hard ceiling per document |
| `heartbeatIntervalMs` | 5 000 ms | Ping cadence; three missed heartbeats trigger reconnect |
| `operationBatchSize` | 32 | Max ops per WebSocket frame |
| `gateway` | `wss://collab.plannotator.ai` | Regional edge endpoint |

## Phase 1: Infrastructure

### WebSocket Server

Set up a WebSocket server to handle concurrent connections:

```typescript
const server = new WebSocketServer({ port: 8080 });

server.on('connection', (socket, request) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, socket);

  socket.on('message', (data) => {
    broadcast(sessionId, data);
  });
});
```

### Client Connection

- Establish persistent connection on document load
  - Initialize WebSocket with authentication token
  - Set up heartbeat ping/pong every 30 seconds
  - Handle connection state changes (connecting, open, closing, closed)
- Implement reconnection logic with exponential backoff
  - Start with 1 second delay
  - Double delay on each retry (max 30 seconds)
  - Reset delay on successful connection
- Handle offline state gracefully
  - Queue local changes in IndexedDB
  - Show offline indicator in UI
  - Sync queued changes on reconnect

### Database Schema

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(50) DEFAULT 'editor',
  cursor_position JSONB,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_collaborators_document ON collaborators(document_id);
```

## Phase 2: Operational Transforms

> The key insight is that we need to transform operations against concurrent operations to maintain consistency.

Key requirements (see [OT primer](https://en.wikipedia.org/wiki/Operational_transformation) for *theoretical background*):

- Transform insert against insert
  - Same position: use user ID for deterministic ordering
  - Different positions: adjust offset of later operation
- Transform insert against delete
  - Insert before delete: no change needed
  - Insert inside deleted range: special handling required
- Transform delete against delete
  - Non-overlapping: adjust positions
  - Overlapping: merge or split operations
- Maintain cursor positions across transforms

## Phase 3: UI Updates

1. Show collaborator cursors in real-time
2. Display presence indicators
3. Add conflict resolution UI
4. Implement undo/redo stack per user

## Pre-launch Checklist

- [ ] Infrastructure ready
  - [x] WebSocket server deployed
  - [x] Database migrations applied
  - [ ] Load balancer configured
- [ ] Security audit complete
  - [x] Authentication flow reviewed
  - [ ] Rate limiting implemented
- [x] Documentation updated

---

**Target:** Ship MVP in next sprint
