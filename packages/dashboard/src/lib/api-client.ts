import axios from 'axios';
import type { AxiosError } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  success: false;
}

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('gird_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: Unified error handling
api.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError<ApiError>) => {
    const apiError = error.response?.data;
    if (apiError) {
      return Promise.reject({
        message: apiError.error,
        code: apiError.code,
        details: apiError.details,
        status: error.response?.status,
      });
    }
    return Promise.reject({
      message: error.message || 'Network error',
      status: error.response?.status || 0,
    });
  }
);

export default api;
