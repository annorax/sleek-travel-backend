// Unit tests for src/util.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIpAddress } from '../../src/util';

describe('extractIpAddress', () => {
    test('prefers x-forwarded-for header when present', () => {
        const req = {
            headers: { 'x-forwarded-for': '198.51.100.7' },
            socket: { remoteAddress: '10.0.0.1' },
        };
        assert.equal(extractIpAddress(req), '198.51.100.7');
    });

    test('falls back to socket.remoteAddress when no header', () => {
        const req = {
            headers: {},
            socket: { remoteAddress: '10.0.0.1' },
        };
        assert.equal(extractIpAddress(req), '10.0.0.1');
    });

    test('returns null/undefined when neither is set', () => {
        const req = { headers: {}, socket: {} };
        const result = extractIpAddress(req);
        assert.ok(result == null, `expected null/undefined, got ${String(result)}`);
    });
});
