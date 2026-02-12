/**
 * Tests for auto-restart rate limiting functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isRateLimitExceeded,
  clearRateLimit,
  clearAllRateLimits,
  MAX_RESTARTS_PER_MINUTE,
  RESTART_TIME_WINDOW_MS,
} from '../health/auto-restart.js';

describe('Auto-Restart Rate Limiting', () => {
  beforeEach(() => {
    // Clear all rate limit state before each test
    clearAllRateLimits();
  });

  afterEach(() => {
    // Clean up after each test
    clearAllRateLimits();
    vi.useRealTimers();
  });

  describe('Constants', () => {
    it('should have MAX_RESTARTS_PER_MINUTE equal to 3', () => {
      expect(MAX_RESTARTS_PER_MINUTE).toBe(3);
    });

    it('should have RESTART_TIME_WINDOW_MS equal to 60000', () => {
      expect(RESTART_TIME_WINDOW_MS).toBe(60000);
    });
  });

  describe('isRateLimitExceeded', () => {
    it('should return false on first call (no restart recorded yet)', () => {
      const deploymentId = 'test-deployment-1';
      const result = isRateLimitExceeded(deploymentId);
      expect(result).toBe(false);
    });

    it('should return false after 3 consecutive restarts (at limit but not exceeded)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentId = 'test-deployment-2';

      // First call - adds timestamp
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Second call - adds timestamp
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Third call - adds timestamp, at limit
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      vi.useRealTimers();
    });

    it('should return true after 4 consecutive restarts (exceeds limit)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentId = 'test-deployment-3';

      // First 3 calls - should be false
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Fourth call - should be true (exceeded)
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      vi.useRealTimers();
    });

    it('should reset count after time window expires', () => {
      vi.useFakeTimers();
      const startTime = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(startTime);

      const deploymentId = 'test-deployment-4';

      // First 3 calls - should be false
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Fourth call - should be true (exceeded)
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      // Advance time past the window
      vi.setSystemTime(new Date(startTime.getTime() + RESTART_TIME_WINDOW_MS + 1000));

      // After time window, should be false again (starts fresh)
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      vi.useRealTimers();
    });

    it('should track deployments independently', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentA = 'deployment-a';
      const deploymentB = 'deployment-b';

      // Exhaust rate limit for deployment A
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(true);

      // Deployment B should still be able to restart (independent tracking)
      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(true);

      vi.useRealTimers();
    });

    it('should only count timestamps within the time window', () => {
      vi.useFakeTimers();
      const startTime = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(startTime);

      const deploymentId = 'test-deployment-5';

      // First 3 calls within initial window
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Fourth call - should be true (exceeded)
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      // Advance time to just before window expires (59 seconds)
      vi.setSystemTime(new Date(startTime.getTime() + 59000));
      clearRateLimit(deploymentId); // Clear to allow testing

      // Add 3 more timestamps within the new window
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);

      // Fourth call - should be true again
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('clearRateLimit', () => {
    it('should allow restart again after clearing rate limit', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentId = 'test-deployment-6';

      // Exhaust rate limit
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      // Clear rate limit
      clearRateLimit(deploymentId);

      // Should be able to restart again
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(false);
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      vi.useRealTimers();
    });

    it('should only clear specific deployment rate limit', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentA = 'deployment-a-clear';
      const deploymentB = 'deployment-b-clear';

      // Exhaust rate limit for deployment A
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(true);

      // Clear only deployment A
      clearRateLimit(deploymentA);

      // Deployment A should be able to restart again
      expect(isRateLimitExceeded(deploymentA)).toBe(false);

      // Deployment B should start fresh (was never used)
      expect(isRateLimitExceeded(deploymentB)).toBe(false);

      vi.useRealTimers();
    });

    it('should handle clearing non-existent deployment', () => {
      // Should not throw when clearing a deployment that was never tracked
      expect(() => clearRateLimit('non-existent-deployment')).not.toThrow();
    });
  });

  describe('clearAllRateLimits', () => {
    it('should clear rate limits for all deployments', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentA = 'deployment-a-all';
      const deploymentB = 'deployment-b-all';

      // Exhaust rate limits for both deployments
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentA)).toBe(true);

      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(true);

      // Clear all rate limits
      clearAllRateLimits();

      // Both deployments should be able to restart again
      expect(isRateLimitExceeded(deploymentA)).toBe(false);
      expect(isRateLimitExceeded(deploymentB)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid consecutive calls with fake timers', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const deploymentId = 'test-deployment-rapid';

      // Simulate rapid calls at the exact same time
      for (let i = 0; i < 3; i++) {
        expect(isRateLimitExceeded(deploymentId)).toBe(false);
      }

      // Fourth call should exceed
      expect(isRateLimitExceeded(deploymentId)).toBe(true);

      vi.useRealTimers();
    });

    it('should handle multiple deployments with staggered restarts', () => {
      vi.useFakeTimers();
      const startTime = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(startTime);

      const deploymentA = 'deployment-stagger-a';
      const deploymentB = 'deployment-stagger-b';

      // Deployment A: 3 restarts - next call should return true (at limit)
      isRateLimitExceeded(deploymentA);
      isRateLimitExceeded(deploymentA);
      isRateLimitExceeded(deploymentA);

      // Deployment B: 2 restarts - next call should return false (not at limit)
      isRateLimitExceeded(deploymentB);
      isRateLimitExceeded(deploymentB);

      // Advance time by 30 seconds (within window)
      vi.setSystemTime(new Date(startTime.getTime() + 30000));

      // Deployment A has 3 timestamps, next call should return true (exceeds)
      expect(isRateLimitExceeded(deploymentA)).toBe(true);

      // Deployment B has 2 timestamps, next call should return false
      expect(isRateLimitExceeded(deploymentB)).toBe(false);

      // Now deployment B has 3 timestamps, next call should return true
      expect(isRateLimitExceeded(deploymentB)).toBe(true);

      vi.useRealTimers();
    });
  });
});
