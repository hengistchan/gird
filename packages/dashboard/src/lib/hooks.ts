import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serverApi, apiKeyApi } from './api';
import { notify } from './toast';
import type { ServerType, ServerStatus } from '@gird/core';

// Server Hooks
export function useServers(params?: {
  page?: number;
  pageSize?: number;
  type?: ServerType;
  status?: ServerStatus;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  return useQuery({
    queryKey: ['servers', params],
    queryFn: () => serverApi.list(params ?? {}),
  });
}

export function useServer(id: string) {
  return useQuery({
    queryKey: ['server', id],
    queryFn: () => serverApi.get(id),
    enabled: !!id,
  });
}

export function useCreateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: serverApi.create,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      const data = response.data as { data?: { name?: string } };
      notify.success(
        'Server created successfully',
        data.data?.name ? `Server "${data.data.name}" is ready` : undefined
      );
    },
    onError: (error: any) => {
      notify.error('Failed to create server', error);
    },
  });
}

export function useUpdateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof serverApi.update>[1] }) =>
      serverApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['server', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notify.success('Server updated successfully');
    },
    onError: (error: any) => {
      notify.error('Failed to update server', error);
    },
  });
}

export function useDeleteServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: serverApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notify.success('Server deleted successfully');
    },
    onError: (error: any) => {
      notify.error('Failed to delete server', error);
    },
  });
}

export function useStartServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, options }: { id: string; options?: unknown } = { id: '' }) =>
      serverApi.start(id, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['server', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notify.success('Server started successfully');
    },
    onError: (error: any) => {
      notify.error('Failed to start server', error);
    },
  });
}

export function useStopServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => serverApi.stop(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['server', id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notify.success('Server stopped successfully');
    },
    onError: (error: any) => {
      notify.error('Failed to stop server', error);
    },
  });
}

// API Key Hooks
export function useApiKeys(params?: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['apiKeys', params],
    queryFn: () => apiKeyApi.list(params || {}),
  });
}

export function useApiKey(id: string) {
  return useQuery({
    queryKey: ['apiKey', id],
    queryFn: () => apiKeyApi.get(id),
    enabled: !!id,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: apiKeyApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      notify.success(
        'API Key created successfully',
        'Make sure to copy your key now. You won\'t be able to see it again!'
      );
    },
    onError: (error: any) => {
      notify.error('Failed to create API Key', error);
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: apiKeyApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      notify.success('API Key deleted successfully');
    },
    onError: (error: any) => {
      notify.error('Failed to delete API Key', error);
    },
  });
}

export function useServerLogs(id: string, tail?: number) {
  return useQuery({
    queryKey: ['server', id, 'logs', tail],
    queryFn: () => serverApi.getLogs(id, tail !== undefined ? { tail } : {}),
    enabled: !!id,
    refetchInterval: 5000, // Poll every 5 seconds for live logs
  });
}
