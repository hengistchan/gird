import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
  redirectTo?: string;
}

const AUTH_TOKEN_KEY = 'gird_token';

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return !!token && token.length > 0;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function ProtectedRoute({
  children,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  if (!isAuthenticated()) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}

// Hook to check auth status
export function useAuth() {
  return {
    isAuthenticated: isAuthenticated(),
    token: getAuthToken(),
    login: (token: string) => setAuthToken(token),
    logout: () => clearAuthToken(),
  };
}
