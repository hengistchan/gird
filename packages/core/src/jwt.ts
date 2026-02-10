/**
 * JWT (JSON Web Token) utilities for authentication
 */

import type { JwtPayload } from './types.js';
import { AuthenticationError } from './errors.js';
import type { SignOptions } from 'jsonwebtoken';

let jwtSecret: string | null = null;
let jwtExpiresIn: string = '24h';

/**
 * Initialize JWT configuration
 */
export function initJwt(options: { secret: string; expiresIn?: string }): void {
  jwtSecret = options.secret;
  if (options.expiresIn) {
    jwtExpiresIn = options.expiresIn;
  }
}

/**
 * Get JWT secret
 */
function getSecret(): string {
  if (!jwtSecret) {
    throw new AuthenticationError('JWT not initialized. Call initJwt() first.');
  }
  return jwtSecret;
}

/**
 * Generate a JWT token for an API key
 */
export async function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
  const secret = getSecret();

  // Dynamic import of jsonwebtoken
  const jwt = await import('jsonwebtoken');

  return new Promise((resolve, reject) => {
    jwt.sign(
      { ...payload },
      secret,
      { expiresIn: jwtExpiresIn } as SignOptions,
      (err: Error | null, token: string | undefined) => {
        if (err) {
          reject(new AuthenticationError('Failed to generate token'));
        } else {
          resolve(token!);
        }
      }
    );
  });
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const secret = getSecret();

  // Dynamic import of jsonwebtoken
  const jwt = await import('jsonwebtoken');

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      secret,
      (err: Error | null, decoded: unknown) => {
        if (err) {
          reject(new AuthenticationError('Invalid or expired token'));
        } else {
          resolve(decoded as JwtPayload);
        }
      }
    );
  });
}

/**
 * Decode a JWT token without verification (for debugging)
 */
export async function decodeToken(token: string): Promise<JwtPayload | null> {
  // Dynamic import of jsonwebtoken
  const jwt = await import('jsonwebtoken');

  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') {
    return null;
  }

  return decoded as JwtPayload;
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  const token = parts[1];
  return token ?? null;
}
