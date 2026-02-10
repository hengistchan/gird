/**
 * Tests for error classes
 */

import { describe, it, expect } from 'vitest';
import {
  GirdError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  DeploymentError,
  ProxyError,
  FileNotFoundError,
} from '../types.js';
import { isGirdError, getErrorResponse, wrapError } from '../errors.js';

describe('Error Classes', () => {
  describe('GirdError', () => {
    it('should create a base GirdError', () => {
      const error = new GirdError('Something went wrong', 'TEST_ERROR', 500);
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(GirdError);
      expect(error.message).toBe('Something went wrong');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('GirdError');
    });

    it('should include details when provided', () => {
      const details = { field: 'value', count: 42 };
      const error = new GirdError('Validation failed', 'VALIDATION_ERROR', 400, details);
      
      expect(error.details).toEqual(details);
    });

    it('should have undefined details when not provided', () => {
      const error = new GirdError('Simple error', 'SIMPLE_ERROR', 500);
      
      expect(error.details).toBeUndefined();
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new GirdError('Thrown error', 'THROWN_ERROR', 500);
      }).toThrow(GirdError);
    });

    it('should preserve stack trace', () => {
      const error = new GirdError('Stack trace test', 'STACK_TEST', 500);
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Stack trace test');
    });
  });

  describe('AuthenticationError', () => {
    it('should create an AuthenticationError with default message', () => {
      const error = new AuthenticationError();
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthenticationError');
    });

    it('should create an AuthenticationError with custom message', () => {
      const error = new AuthenticationError('Invalid API key');
      
      expect(error.message).toBe('Invalid API key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
    });

    it('should include details when provided', () => {
      const details = { apiKeyId: 'key_123' };
      const error = new AuthenticationError('Key expired', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('AuthorizationError', () => {
    it('should create an AuthorizationError with default message', () => {
      const error = new AuthorizationError();
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.message).toBe('Authorization failed');
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe('AuthorizationError');
    });

    it('should create an AuthorizationError with custom message', () => {
      const error = new AuthorizationError('Insufficient permissions');
      
      expect(error.message).toBe('Insufficient permissions');
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.statusCode).toBe(403);
    });

    it('should include details when provided', () => {
      const details = { required: 'admin', current: 'user' };
      const error = new AuthorizationError('Access denied', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('NotFoundError', () => {
    it('should create a NotFoundError with resource only', () => {
      const error = new NotFoundError('Server');
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe('Server not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('NotFoundError');
      expect(error.details).toEqual({ resource: 'Server', id: undefined });
    });

    it('should create a NotFoundError with resource and id', () => {
      const error = new NotFoundError('Server', 'server_123');
      
      expect(error.message).toBe("Server with id 'server_123' not found");
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.details).toEqual({ resource: 'Server', id: 'server_123' });
    });

    it('should handle numeric ids', () => {
      const error = new NotFoundError('User', 42);
      
      expect(error.message).toBe("User with id '42' not found");
      // The actual implementation preserves the original type (number)
      expect(error.details).toEqual({ resource: 'User', id: 42 });
    });

    it('should handle empty string id', () => {
      const error = new NotFoundError('ApiKey', '');
      
      // Empty string is falsy, so the message uses fallback format
      expect(error.message).toBe('ApiKey not found');
    });

    it('should handle falsy id values like null', () => {
      const error = new NotFoundError('Resource', null);
      
      expect(error.message).toBe('Resource not found');
    });
  });

  describe('ValidationError', () => {
    it('should create a ValidationError', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
    });

    it('should include details when provided', () => {
      const details = { field: 'email', issue: 'invalid format' };
      const error = new ValidationError('Email validation failed', details);
      
      expect(error.details).toEqual(details);
    });

    it('should include array of validation errors in details', () => {
      const details = {
        errors: [
          { field: 'email', message: 'Invalid email' },
          { field: 'password', message: 'Too short' },
        ],
      };
      const error = new ValidationError('Multiple validation errors', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('DeploymentError', () => {
    it('should create a DeploymentError', () => {
      const error = new DeploymentError('Deployment failed');
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(DeploymentError);
      expect(error.message).toBe('Deployment failed');
      expect(error.code).toBe('DEPLOYMENT_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('DeploymentError');
    });

    it('should include details when provided', () => {
      const details = { serverId: 'server_123', phase: 'container_start' };
      const error = new DeploymentError('Container failed to start', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('ProxyError', () => {
    it('should create a ProxyError', () => {
      const error = new ProxyError('Proxy request failed');
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.message).toBe('Proxy request failed');
      expect(error.code).toBe('PROXY_ERROR');
      expect(error.statusCode).toBe(502);
      expect(error.name).toBe('ProxyError');
    });

    it('should include details when provided', () => {
      const details = { targetUrl: 'http://backend:3000', status: 503 };
      const error = new ProxyError('Backend unavailable', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('FileNotFoundError', () => {
    it('should create a FileNotFoundError', () => {
      const error = new FileNotFoundError('/path/to/file.txt');
      
      expect(error).toBeInstanceOf(GirdError);
      expect(error).toBeInstanceOf(FileNotFoundError);
      expect(error.message).toBe('File not found: /path/to/file.txt');
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('FileNotFoundError');
      expect(error.details).toEqual({ path: '/path/to/file.txt' });
    });

    it('should handle empty path', () => {
      const error = new FileNotFoundError('');
      
      expect(error.message).toBe('File not found: ');
      expect(error.details).toEqual({ path: '' });
    });

    it('should handle relative paths', () => {
      const error = new FileNotFoundError('./config.json');
      
      expect(error.message).toBe('File not found: ./config.json');
    });
  });
});

describe('Error Utilities', () => {
  describe('isGirdError', () => {
    it('should return true for GirdError instances', () => {
      const error = new GirdError('Test', 'TEST', 500);
      expect(isGirdError(error)).toBe(true);
    });

    it('should return true for subclasses of GirdError', () => {
      expect(isGirdError(new AuthenticationError())).toBe(true);
      expect(isGirdError(new AuthorizationError())).toBe(true);
      expect(isGirdError(new NotFoundError('Test'))).toBe(true);
      expect(isGirdError(new ValidationError('Test'))).toBe(true);
      expect(isGirdError(new DeploymentError('Test'))).toBe(true);
      expect(isGirdError(new ProxyError('Test'))).toBe(true);
      expect(isGirdError(new FileNotFoundError('/path'))).toBe(true);
    });

    it('should return false for error-like objects that are not Error instances', () => {
      // The isGirdError function checks for `instanceof Error` first
      const errorLike = {
        name: 'CustomError',
        message: 'Custom error message',
        code: 'CUSTOM_ERROR',
        statusCode: 500,
      };
      expect(isGirdError(errorLike)).toBe(false);
    });

    it('should return false for plain Error', () => {
      const error = new Error('Plain error');
      expect(isGirdError(error)).toBe(false);
    });

    it('should return false for TypeError', () => {
      const error = new TypeError('Type error');
      expect(isGirdError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isGirdError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isGirdError(undefined)).toBe(false);
    });

    it('should return false for objects without code', () => {
      const incomplete = { message: 'Error', statusCode: 500 };
      expect(isGirdError(incomplete)).toBe(false);
    });

    it('should return false for objects without statusCode', () => {
      const incomplete = { message: 'Error', code: 'ERROR' };
      expect(isGirdError(incomplete)).toBe(false);
    });

    it('should return false for non-Error objects with wrong types', () => {
      expect(isGirdError({ code: 123, statusCode: 500 })).toBe(false);
      expect(isGirdError({ code: 'ERROR', statusCode: '500' })).toBe(false);
    });
  });

  describe('getErrorResponse', () => {
    it('should return correct response for GirdError', () => {
      const error = new AuthenticationError('Invalid token');
      const response = getErrorResponse(error);
      
      expect(response).toEqual({
        error: 'Invalid token',
        code: 'AUTHENTICATION_ERROR',
        statusCode: 401,
        details: undefined,
      });
    });

    it('should include details in response for GirdError with details', () => {
      const error = new ValidationError('Invalid data', { field: 'email' });
      const response = getErrorResponse(error);
      
      expect(response.details).toEqual({ field: 'email' });
    });

    it('should return correct response for plain Error', () => {
      const error = new Error('Something went wrong');
      const response = getErrorResponse(error);
      
      expect(response).toEqual({
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
        statusCode: 500,
      });
    });

    it('should return correct response for TypeError', () => {
      const error = new TypeError('Invalid type');
      const response = getErrorResponse(error);
      
      expect(response).toEqual({
        error: 'Invalid type',
        code: 'INTERNAL_ERROR',
        statusCode: 500,
      });
    });

    it('should return generic response for non-Error values', () => {
      expect(getErrorResponse(null)).toEqual({
        error: 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
        statusCode: 500,
      });

      expect(getErrorResponse('string error')).toEqual({
        error: 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
        statusCode: 500,
      });

      expect(getErrorResponse(12345)).toEqual({
        error: 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
        statusCode: 500,
      });
    });

    it('should handle objects that are Error-like but not GirdError', () => {
      const error = new Error('Custom');
      (error as { code: string }).code = 'CUSTOM_CODE';
      const response = getErrorResponse(error);
      
      // Should still return INTERNAL_ERROR since isGirdError checks for both code and statusCode
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('wrapError', () => {
    it('should wrap a GirdError with additional context', () => {
      const original = new AuthenticationError('Token expired');
      const wrapped = wrapError(original, 'Failed to authenticate user');
      
      expect(wrapped.message).toBe('Failed to authenticate user: Token expired');
      expect(wrapped.name).toBe('AuthenticationError');
      expect((wrapped as { code?: string }).code).toBe('AUTHENTICATION_ERROR');
      expect((wrapped as { statusCode?: number }).statusCode).toBe(401);
    });

    it('should wrap a plain Error with additional context', () => {
      const original = new Error('Database connection failed');
      const wrapped = wrapError(original, 'Failed to load user data');
      
      expect(wrapped.message).toBe('Failed to load user data: Database connection failed');
      expect(wrapped.name).toBe('Error');
      expect((wrapped as { code?: string }).code).toBeUndefined();
      expect((wrapped as { statusCode?: number }).statusCode).toBeUndefined();
    });

    it('should wrap a non-Error value', () => {
      const wrapped = wrapError('string error', 'Operation failed');
      
      expect(wrapped.message).toBe('Operation failed: string error');
      expect(wrapped.name).toBe('Error');
    });

    it('should preserve stack trace from original error', () => {
      const original = new Error('Original error');
      const wrapped = wrapError(original, 'Wrapped');
      
      expect(wrapped.stack).toBe(original.stack);
    });

    it('should allow overriding error code', () => {
      const original = new AuthenticationError('Auth failed');
      const wrapped = wrapError(original, 'User login failed', 'USER_LOGIN_ERROR');
      
      expect((wrapped as { code?: string }).code).toBe('USER_LOGIN_ERROR');
    });

    it('should not add code if original is not GirdError and no override', () => {
      const original = new Error('Simple error');
      const wrapped = wrapError(original, 'Wrapped error');
      
      expect((wrapped as { code?: string }).code).toBeUndefined();
      expect((wrapped as { statusCode?: number }).statusCode).toBeUndefined();
    });

    it('should preserve GirdError properties when code override is provided', () => {
      const original = new ValidationError('Invalid input');
      const wrapped = wrapError(original, 'Request validation failed', 'REQUEST_VALIDATION_ERROR');
      
      expect((wrapped as { code?: string }).code).toBe('REQUEST_VALIDATION_ERROR');
      expect((wrapped as { statusCode?: number }).statusCode).toBe(400);
    });

    it('should handle null error gracefully', () => {
      const wrapped = wrapError(null, 'Something went wrong');
      
      expect(wrapped.message).toBe('Something went wrong: null');
      expect(wrapped.name).toBe('Error');
    });

    it('should handle undefined error gracefully', () => {
      const wrapped = wrapError(undefined, 'Unknown error');
      
      expect(wrapped.message).toBe('Unknown error: undefined');
    });
  });
});
