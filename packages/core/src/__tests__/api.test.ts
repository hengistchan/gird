/**
 * Tests for API key utilities (generateApiKey, hashApiKey, verifyApiKey)
 */

import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, verifyApiKey, extractApiKeyPrefix } from '../index.js';

describe('API Key Utilities', () => {
  describe('generateApiKey', () => {
    it('should generate a key with correct prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^gird_sk_/);
    });

    it('should generate keys with sufficient length (at least 40 chars)', () => {
      const key = generateApiKey();
      expect(key.length).toBeGreaterThanOrEqual(40);
    });

    it('should not contain padding characters (=)', () => {
      const key = generateApiKey();
      expect(key).not.toContain('=');
    });

    it('should use URL-safe base64 characters only', () => {
      const key = generateApiKey();
      // Should only contain alphanumeric, hyphen, underscore
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different keys each time', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });

    it('should generate keys with sufficient entropy (32 random bytes)', () => {
      const keys = new Set<string>();
      // Generate 1000 keys and check for collisions
      for (let i = 0; i < 1000; i++) {
        keys.add(generateApiKey());
      }
      // With 32 bytes of entropy, collisions in 1000 keys are astronomically unlikely
      expect(keys.size).toBe(1000);
    });
  });

  describe('extractApiKeyPrefix', () => {
    it('should extract first 20 characters as prefix', () => {
      const key = generateApiKey();
      const prefix = extractApiKeyPrefix(key);
      expect(prefix).toBe(key.slice(0, 20));
      expect(prefix.length).toBe(20);
    });

    it('should include the gird_sk_ prefix', () => {
      const key = generateApiKey();
      const prefix = extractApiKeyPrefix(key);
      // Prefix starts with gird_sk_ and has 12 characters total
      expect(prefix).toMatch(/^gird_sk_[A-Za-z0-9_-]+$/);
      expect(prefix.startsWith('gird_sk_')).toBe(true);
    });

    it('should handle shorter keys gracefully', () => {
      const shortKey = 'gird_sk_abc';
      const prefix = extractApiKeyPrefix(shortKey);
      expect(prefix).toBe(shortKey);
    });

    it('should handle empty string', () => {
      const prefix = extractApiKeyPrefix('');
      expect(prefix).toBe('');
    });
  });

  describe('hashApiKey', () => {
    it('should hash an API key with bcrypt', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(key);
      expect(typeof hash).toBe('string');
    });

    it('should generate different hashes for same key (due to salt)', async () => {
      const key = generateApiKey();
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should produce hashes starting with $2b$ (bcrypt format)', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      
      expect(hash).toMatch(/^\$2b\$/);
    });

    it('should produce consistent hash length (60 chars for bcrypt)', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      
      expect(hash.length).toBe(60);
    });

    it('should handle empty string', async () => {
      const hash = await hashApiKey('');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(60);
    });
  });

  describe('verifyApiKey', () => {
    it('should return true for matching key and hash', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      
      const isValid = await verifyApiKey(key, hash);
      expect(isValid).toBe(true);
    });

    it('should return false for incorrect key', async () => {
      const key = generateApiKey();
      const wrongKey = generateApiKey();
      const hash = await hashApiKey(key);
      
      const isValid = await verifyApiKey(wrongKey, hash);
      expect(isValid).toBe(false);
    });

    it('should return false for empty string vs hash', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      
      const isValid = await verifyApiKey('', hash);
      expect(isValid).toBe(false);
    });

    it('should return false for key vs empty hash', async () => {
      const key = generateApiKey();
      
      const isValid = await verifyApiKey(key, '');
      expect(isValid).toBe(false);
    });

    it('should verify against multiple different hashes', async () => {
      const key = generateApiKey();
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);
      
      const isValid1 = await verifyApiKey(key, hash1);
      const isValid2 = await verifyApiKey(key, hash2);
      
      expect(isValid1).toBe(true);
      expect(isValid2).toBe(true);
    });

    it('should handle verification of many keys efficiently', async () => {
      const keys = Array.from({ length: 10 }, () => generateApiKey());
      const hashes = await Promise.all(keys.map(k => hashApiKey(k)));
      
      const results = await Promise.all(
        keys.map((key, i) => verifyApiKey(key, hashes[i]))
      );
      
      expect(results.every(r => r === true)).toBe(true);
    });
  });

  describe('API key integration', () => {
    it('should create, hash, and verify a key end-to-end', async () => {
      const key = generateApiKey();
      
      // Verify format
      expect(key).toMatch(/^gird_sk_[A-Za-z0-9_-]+$/);
      expect(key.length).toBeGreaterThanOrEqual(40);
      
      // Hash and verify
      const hash = await hashApiKey(key);
      const isValid = await verifyApiKey(key, hash);
      expect(isValid).toBe(true);
      
      // Wrong key should fail
      const wrongKey = generateApiKey();
      const isInvalid = await verifyApiKey(wrongKey, hash);
      expect(isInvalid).toBe(false);
    });

    it('should handle prefix extraction for database lookup optimization', async () => {
      const key = generateApiKey();
      const prefix = extractApiKeyPrefix(key);
      
      // Prefix should be useful for indexed database lookups
      expect(prefix.length).toBe(20);
      expect(key.startsWith(prefix)).toBe(true);
    });
  });
});
