/**
 * Slice 3 engine tests — validation, admin proofs, and lifecycle helpers.
 *
 * Tests act as external clients and import from @plannotator/shared/collab/client.
 */

import { describe, expect, test } from 'bun:test';
import {
  validateServerEnvelope,
  validateAdminCommandEnvelope,
  isValidationError,
} from './validation';
import type { ValidationError } from './validation';
import {
  deriveAdminKey,
  computeAdminVerifier,
  computeAdminProof,
  verifyAdminProof,
  generateChallengeId,
  generateNonce,
} from '@plannotator/shared/collab/client';
import type { AdminCommand } from '@plannotator/shared/collab';

// ---------------------------------------------------------------------------
// validateServerEnvelope
// ---------------------------------------------------------------------------

describe('validateServerEnvelope', () => {
  const validEvent = {
    clientId: 'client-1',
    opId: 'op-abc',
    channel: 'event',
    ciphertext: 'encrypted-data',
  };

  test('accepts valid event envelope', () => {
    const result = validateServerEnvelope(validEvent);
    expect(isValidationError(result)).toBe(false);
  });

  test('accepts valid presence envelope', () => {
    const result = validateServerEnvelope({ ...validEvent, channel: 'presence' });
    expect(isValidationError(result)).toBe(false);
  });

  test('rejects missing clientId', () => {
    const { clientId: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects missing opId', () => {
    const { opId: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects invalid channel', () => {
    expect(isValidationError(validateServerEnvelope({ ...validEvent, channel: 'invalid' }))).toBe(true);
  });

  test('rejects missing ciphertext', () => {
    const { ciphertext: _, ...rest } = validEvent;
    expect(isValidationError(validateServerEnvelope(rest))).toBe(true);
  });

  test('rejects oversized event ciphertext (> 512 KB)', () => {
    const result = validateServerEnvelope({ ...validEvent, ciphertext: 'x'.repeat(512_001) });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).status).toBe(413);
  });

  test('rejects oversized presence ciphertext (> 8 KB)', () => {
    const result = validateServerEnvelope({ ...validEvent, channel: 'presence', ciphertext: 'x'.repeat(8_193) });
    expect(isValidationError(result)).toBe(true);
    expect((result as ValidationError).status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// validateAdminCommandEnvelope
// ---------------------------------------------------------------------------

describe('validateAdminCommandEnvelope', () => {
  const validDelete = {
    type: 'admin.command',
    challengeId: 'ch_abc',
    clientId: 'client-1',
    command: { type: 'room.delete' },
    adminProof: 'proof-data',
  };

  test('accepts valid delete command', () => {
    const result = validateAdminCommandEnvelope(validDelete);
    expect(isValidationError(result)).toBe(false);
  });

  test('rejects unknown command type', () => {
    expect(isValidationError(validateAdminCommandEnvelope({ ...validDelete, command: { type: 'room.explode' } }))).toBe(true);
  });

  test('rejects missing challengeId', () => {
    const { challengeId: _, ...rest } = validDelete;
    expect(isValidationError(validateAdminCommandEnvelope(rest))).toBe(true);
  });

  test('rejects missing adminProof', () => {
    const { adminProof: _, ...rest } = validDelete;
    expect(isValidationError(validateAdminCommandEnvelope(rest))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin Proof Round-Trip
// ---------------------------------------------------------------------------

const ADMIN_SECRET = new Uint8Array(32);
ADMIN_SECRET.fill(0xcd);
const ROOM_ID = 'test-room-admin-proof';

describe('admin proof verification (end-to-end)', () => {
  test('valid admin proof is accepted', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const command: AdminCommand = { type: 'room.delete' };

    const proof = await computeAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command);
    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command, proof);
    expect(valid).toBe(true);
  });

  test('wrong proof is rejected', async () => {
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();
    const command: AdminCommand = { type: 'room.delete' };

    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, command, 'garbage-proof');
    expect(valid).toBe(false);
  });

  test('proof cannot verify against a different command shape (binding via canonicalJson)', async () => {
    // V1 has a single AdminCommand shape, so we exercise the binding via
    // an unsanctioned command — the proof must not verify for anything
    // whose canonicalJson differs from what was signed.
    const adminKey = await deriveAdminKey(ADMIN_SECRET);
    const verifier = await computeAdminVerifier(adminKey, ROOM_ID);
    const challengeId = generateChallengeId();
    const nonce = generateNonce();

    const deleteCommand: AdminCommand = { type: 'room.delete' };
    const otherCommand = { type: 'room.other' } as unknown as AdminCommand;

    const proof = await computeAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, deleteCommand);
    const valid = await verifyAdminProof(verifier, ROOM_ID, 'client-1', challengeId, nonce, otherCommand, proof);
    expect(valid).toBe(false);
  });
});
