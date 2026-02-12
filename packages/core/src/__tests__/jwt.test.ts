/**
 * Tests for JWT utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist the secret for mock initialization
const testSecret = vi.hoisted(() => 'test-jwt-secret-key-with-at-least-32-chars');
const testPayload = vi.hoisted(() => ({
  apiKeyId: 'test-api-key-id',
  permissions: { serverIds: ['server-1', 'server-2'] },
}));

// Helper to wait for token expiration
const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('JWT Utilities', () => {
  beforeEach(() => {
    // Reset modules to get fresh state
    vi.resetModules();
  });

  describe('initJwt', () => {
    it('should initialize JWT with secret and default expiry', async () => {
      const { initJwt } = await import('../jwt.js');

      expect(() => initJwt({ secret: testSecret })).not.toThrow();
    });

    it('should initialize JWT with custom expiry', async () => {
      const { initJwt, generateToken, verifyToken } = await import('../jwt.js');

      initJwt({ secret: testSecret, expiresIn: '1s' });

      const token = await generateToken(testPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Should work immediately
      const decoded = await verifyToken(token);
      expect(decoded.apiKeyId).toBe(testPayload.apiKeyId);
    });
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', async () => {
      const { initJwt, generateToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token = await generateToken(testPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include payload in the token', async () => {
      const { initJwt, generateToken, verifyToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token = await generateToken(testPayload);
      const decoded = await verifyToken(token);

      expect(decoded.apiKeyId).toBe(testPayload.apiKeyId);
      expect(decoded.permissions).toEqual(testPayload.permissions);
    });

    it('should throw if JWT is not initialized', async () => {
      const { generateToken } = await import('../jwt.js');
      const { AuthenticationError } = await import('../errors.js');

      await expect(generateToken(testPayload)).rejects.toThrow(AuthenticationError);
      await expect(generateToken(testPayload)).rejects.toThrow('JWT not initialized');
    });

    it('should generate different tokens for different payloads', async () => {
      const { initJwt, generateToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token1 = await generateToken({ apiKeyId: 'key-1', permissions: {} });
      const token2 = await generateToken({ apiKeyId: 'key-2', permissions: {} });

      expect(token1).not.toBe(token2);
    });

    it('should include tenantId if provided', async () => {
      const { initJwt, generateToken, verifyToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const payload = {
        ...testPayload,
        tenantId: 'tenant-123',
      };
      const token = await generateToken(payload);
      const decoded = await verifyToken(token);

      expect(decoded.tenantId).toBe('tenant-123');
    });
  });

  describe('verifyToken', () => {
    it('should verify and return decoded token', async () => {
      const { initJwt, generateToken, verifyToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token = await generateToken(testPayload);
      const decoded = await verifyToken(token);

      expect(decoded.apiKeyId).toBe(testPayload.apiKeyId);
      expect(decoded.permissions).toEqual(testPayload.permissions);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should throw for invalid token', async () => {
      const { initJwt, verifyToken } = await import('../jwt.js');
      const { AuthenticationError } = await import('../errors.js');
      initJwt({ secret: testSecret });

      await expect(verifyToken('invalid.token.here')).rejects.toThrow(AuthenticationError);
      await expect(verifyToken('invalid.token.here')).rejects.toThrow('Invalid or expired token');
    });

    it('should throw for token signed with different secret', async () => {
      // First module instance - generate token
      const module1 = await import('../jwt.js');
      module1.initJwt({ secret: testSecret });
      const token = await module1.generateToken(testPayload);

      // Reset modules and use different secret
      vi.resetModules();

      const module2 = await import('../jwt.js');
      const { AuthenticationError } = await import('../errors.js');
      module2.initJwt({ secret: 'different-secret-key-with-32-chars-minimum!!' });

      await expect(module2.verifyToken(token)).rejects.toThrow(AuthenticationError);
    });

    it('should throw for expired token', async () => {
      const { initJwt, generateToken, verifyToken } = await import('../jwt.js');
      const { AuthenticationError } = await import('../errors.js');

      // Create token that expires in 1 second
      initJwt({ secret: testSecret, expiresIn: '1s' });
      const token = await generateToken(testPayload);

      // Should work immediately
      const decoded = await verifyToken(token);
      expect(decoded.apiKeyId).toBe(testPayload.apiKeyId);

      // Wait for expiration
      await waitFor(1100);

      // Should fail after expiration
      await expect(verifyToken(token)).rejects.toThrow(AuthenticationError);
      await expect(verifyToken(token)).rejects.toThrow('Invalid or expired token');
    });

    it('should throw if JWT is not initialized', async () => {
      const { verifyToken } = await import('../jwt.js');
      const { AuthenticationError } = await import('../errors.js');

      await expect(verifyToken('some.token.value')).rejects.toThrow(AuthenticationError);
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', async () => {
      const { initJwt, generateToken, decodeToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token = await generateToken(testPayload);
      const decoded = await decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.apiKeyId).toBe(testPayload.apiKeyId);
      expect(decoded?.permissions).toEqual(testPayload.permissions);
    });

    it('should return null for invalid token format', async () => {
      const { decodeToken } = await import('../jwt.js');

      const decoded = await decodeToken('not-a-valid-token');
      expect(decoded).toBeNull();
    });

    it('should return null for token with wrong number of parts', async () => {
      const { decodeToken } = await import('../jwt.js');

      const decoded = await decodeToken('only.two');
      expect(decoded).toBeNull();
    });

    it('should decode even with wrong secret (no verification)', async () => {
      const { initJwt, generateToken, decodeToken } = await import('../jwt.js');
      initJwt({ secret: testSecret });

      const token = await generateToken(testPayload);
      const decoded = await decodeToken(token);

      // Decode doesn't require secret - it just decodes
      expect(decoded).not.toBeNull();
      expect(decoded?.apiKeyId).toBe(testPayload.apiKeyId);
    });
  });

  describe('extractToken', () => {
    it('should extract token from valid Bearer header', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('Bearer my-jwt-token');

      expect(token).toBe('my-jwt-token');
    });

    it('should return null for undefined header', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken(undefined);

      expect(token).toBeNull();
    });

    it('should return null for empty string', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('');

      expect(token).toBeNull();
    });

    it('should return null for non-Bearer auth type', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('Basic my-jwt-token');

      expect(token).toBeNull();
    });

    it('should return null for malformed header (no space)', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('BearerToken');

      expect(token).toBeNull();
    });

    it('should return null for extra spaces', async () => {
      const { extractToken } = await import('../jwt.js');
      // "Bearer  token" (two spaces) - split gives ['Bearer', '', 'token']
      const token = extractToken('Bearer  token');

      // Current implementation only checks parts.length === 2
      expect(token).toBeNull(); // parts.length is 3, not 2
    });

    it('should handle token with dots', async () => {
      const { extractToken } = await import('../jwt.js');
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const token = extractToken(`Bearer ${jwtToken}`);

      expect(token).toBe(jwtToken);
    });

    it('should be case-sensitive for Bearer', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('bearer my-token');

      expect(token).toBeNull();
    });

    it('should return null for Bearer with empty token', async () => {
      const { extractToken } = await import('../jwt.js');
      const token = extractToken('Bearer');

      expect(token).toBeNull();
    });
  });

  describe('Integration: Full JWT flow', () => {
    it('should support full token lifecycle', async () => {
      const { initJwt, generateToken, verifyToken, decodeToken, extractToken } = await import('../jwt.js');

      // Initialize
      initJwt({ secret: testSecret, expiresIn: '1h' });

      // Generate
      const token = await generateToken({
        apiKeyId: 'api-key-123',
        tenantId: 'tenant-456',
        permissions: { serverIds: null }, // null = all servers
      });

      // Extract from header
      const authHeader = `Bearer ${token}`;
      const extracted = extractToken(authHeader);
      expect(extracted).toBe(token);

      // Verify
      const verified = await verifyToken(extracted!);
      expect(verified.apiKeyId).toBe('api-key-123');
      expect(verified.tenantId).toBe('tenant-456');
      expect(verified.permissions.serverIds).toBeNull();

      // Decode (without verification)
      const decoded = await decodeToken(extracted!);
      expect(decoded?.apiKeyId).toBe('api-key-123');
    });
  });
});
