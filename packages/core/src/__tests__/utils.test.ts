/**
 * Tests for logger utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, parseLogLevel, createLogger, logger } from '../logger.js';

describe('Logger', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LogLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
    });
  });

  describe('parseLogLevel', () => {
    it('should parse valid log level strings', () => {
      expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('info')).toBe(LogLevel.INFO);
      expect(parseLogLevel('INFO')).toBe(LogLevel.INFO);
      expect(parseLogLevel('warn')).toBe(LogLevel.WARN);
      expect(parseLogLevel('WARN')).toBe(LogLevel.WARN);
      expect(parseLogLevel('error')).toBe(LogLevel.ERROR);
      expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR);
    });

    it('should default to INFO for invalid log level strings', () => {
      expect(parseLogLevel('invalid')).toBe(LogLevel.INFO);
      expect(parseLogLevel('')).toBe(LogLevel.INFO);
    });
  });

  describe('Logger class', () => {
    it('should create a logger with default options', () => {
      const log = new Logger();
      expect(log).toBeInstanceOf(Logger);
    });

    it('should create a logger with custom options', () => {
      const log = new Logger({ level: LogLevel.DEBUG, prefix: 'test' });
      expect(log).toBeInstanceOf(Logger);
    });

    it('should log messages at or above the configured level', () => {
      const log = new Logger({ level: LogLevel.WARN });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      log.warn('warning message');
      log.error('error message');

      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should not log messages below the configured level', () => {
      const log = new Logger({ level: LogLevel.WARN });
      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      log.info('info message');

      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('should include prefix in log messages', () => {
      const log = new Logger({ level: LogLevel.INFO, prefix: 'TEST' });
      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      log.info('test message');

      expect(infoSpy).toHaveBeenCalled();
      const callArgs = infoSpy.mock.calls[0];
      expect(callArgs?.[0]).toContain('[TEST]');
    });

    it('should include context in log messages', () => {
      const log = new Logger({ level: LogLevel.INFO });
      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      log.info('test message', { userId: '123', action: 'test' });

      expect(infoSpy).toHaveBeenCalled();
      const callArgs = infoSpy.mock.calls[0];
      expect(callArgs?.[0]).toContain('userId');
      expect(callArgs?.[0]).toContain('123');
    });

    it('should include error in log messages', () => {
      const log = new Logger({ level: LogLevel.ERROR });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const testError = new Error('Test error');
      log.error('error message', testError);

      expect(errorSpy).toHaveBeenCalled();
      const callArgs = errorSpy.mock.calls[0];
      expect(callArgs?.[0]).toContain('Test error');
    });
  });

  describe('child logger', () => {
    it('should create a child logger with combined prefix', () => {
      const parent = new Logger({ prefix: 'parent' });
      const child = parent.child('child');

      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      child.info('test message');

      expect(infoSpy).toHaveBeenCalled();
      const callArgs = infoSpy.mock.calls[0];
      expect(callArgs?.[0]).toContain('[parent:child]');
    });

    it('should inherit log level from parent', () => {
      const parent = new Logger({ level: LogLevel.WARN });
      const child = parent.child('child');

      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      child.info('test message');

      expect(infoSpy).not.toHaveBeenCalled();
    });
  });

  describe('createLogger', () => {
    it('should create a logger with a specific prefix', () => {
      const log = createLogger('my-app');
      expect(log).toBeInstanceOf(Logger);

      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('test message');

      expect(infoSpy).toHaveBeenCalled();
      const callArgs = infoSpy.mock.calls[0];
      expect(callArgs?.[0]).toContain('[my-app]');
    });

    it('should accept additional options', () => {
      const log = createLogger('my-app', { level: LogLevel.DEBUG });
      expect(log).toBeInstanceOf(Logger);
    });
  });

  describe('default logger', () => {
    it('should export a default logger instance', () => {
      expect(logger).toBeInstanceOf(Logger);
    });
  });
});
