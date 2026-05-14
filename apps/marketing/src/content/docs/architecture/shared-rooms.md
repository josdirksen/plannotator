---
title: "Shared Rooms"
description: "How Plannotator's live collaboration rooms work, including end-to-end encryption and zero-knowledge architecture."
sidebar:
  order: 50
section: "Architecture"
---

# Shared rooms

Shared rooms let multiple people review a plan together in real time. Annotations, cursors, and presence sync across all participants. The room server never sees your content.

## Zero-knowledge design

All plan content is encrypted on your device before it leaves the browser. The server stores and relays ciphertext only. It cannot read your plan, your annotations, or your cursor position.

When you create a room, the browser generates a random **room secret** and derives three encryption keys from it using HKDF:

- **Auth key** for the WebSocket handshake proof
- **Event key** for encrypting annotations (AES-256-GCM)
- **Presence key** for encrypting cursor and identity data (AES-256-GCM)

The room secret lives in the URL fragment (`#key=...`), which browsers never send to the server. Only people who have the link can decrypt the room's content.

## How it works

![Shared rooms architecture](/assets/architecture/shared-rooms.svg)

When a participant sends an annotation, it is encrypted locally with the shared event key, sent over a WebSocket as ciphertext, sequenced by the Durable Object, and broadcast to all other connected clients. Each client decrypts the payload locally using the same event key derived from the shared room secret.

The server assigns a monotonic sequence number to each event and stores the ciphertext in SQLite. Clients that reconnect replay from their last acknowledged sequence number, so no events are lost.

## What the server stores

| Stored on server | Never leaves your browser |
|---|---|
| Room ID, client IDs | Room secret, admin secret |
| Encrypted event blobs | Decrypted plan content |
| Sequence numbers | Annotation text |
| Auth verifiers (hashed) | Cursor positions |

Auth verifiers are HMAC digests of the room secret. They let the server verify that a connecting client holds the secret without ever seeing the secret itself.

## Room lifecycle

Rooms expire automatically after the duration you choose (1, 7, or 30 days). When a room expires or is deleted by its creator, the server purges all stored data. There are no tombstones or soft deletes.

An admin secret (also in the creator's URL fragment) grants the ability to delete the room early. Like the room secret, it never reaches the server in plaintext.

## Sharing folders

When you annotate a folder (`plannotator annotate ~/project/docs/`), you can share the entire session as a single live room. Click **Start Live Room** and the modal shows a file picker listing every file in the folder.

- **Annotated files** are pre-checked. Unannotated files can be opted in for context.
- **The picker enforces a 5 MB plaintext budget.** Most markdown folders fit comfortably — the snapshot is compressed before encryption, so 5 MB of typical prose shrinks to well under the server limit. If your particular selection doesn't compress enough, room creation fails cleanly and you can deselect files and retry.
- **HTML files** in the folder are included as raw HTML (not converted to markdown). They render in the room's HTML viewer and can be annotated just like standalone HTML rooms. Markdown files render in the standard plan viewer. Switching between them is seamless.
- **Each file's annotations are scoped** — an annotation on `README.md` doesn't appear when you're viewing `design.md`. The sidebar file list shows per-file annotation counts and updates live as collaborators work.
- **Internal links work across docs.** A link like `[design](./design.md)` switches to that file if it's in the room. Links to files not in the room are visually disabled so there's no confusion about what's available.

The room protocol treats the folder as a single encrypted snapshot. The server doesn't know whether a room contains one document or twenty — it's all ciphertext. Compression, encryption, and decryption happen entirely in the browser.

## Agent participants

AI agents can join rooms as first-class peers using the `collab-agent` CLI. They use the same encryption protocol as browsers. Agent cursors appear with a gear icon so human participants can distinguish them.
