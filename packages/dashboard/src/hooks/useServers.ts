import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { serverApi } from '../lib/api';
import type { ServerType, ServerStatus } from '@gird/core';

// Query keys
export const serverKeys = {
  all: ['servers'] as const,
  lists: () => [...serverKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...serverKeys.lists(), filters] as const,
  details: () => [...serverKeys.all, 'detail'] as const,
  detail: (id: string) => [...serverKeys.details(), id] as const,
};

// List servers
export function useServers(filters: {
  page?: number;
  pageSize?: number;
  type?: ServerType;
  status?: ServerStatus;
  search?: string;
} = {}) {
  return useQuery({
    queryKey: serverKeys.list(filters),
    queryFn: () => serverApi.list(filters),
  });
}

// Get single server
export function useServer(
  id: string,
  options?: Omit<UseQueryOptions<unknown>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: serverKeys.detail(id),
    queryFn: () => serverApi.get(id),
    enabled: !!id,
    ...options,
  });
}

// Create server mutation
export function useCreateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: serverApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() });
    },
  });
}

// Update server mutation
export function useUpdateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof serverApi.update>[1] }) =>
      serverApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() });
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(variables.id) });
    },
  });
}

// Delete server mutation
export function useDeleteServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => serverApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() });
    },
  });
}

// Start server mutation
export function useStartServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, options }: { id: string; options?: Record<string, unknown> }) =>
      serverApi.start(id, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() });
    },
  });
}

// Stop server mutation
export function useStopServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => serverApi.stop(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(variables) });
      queryClient.invalidateQueries({ queryKey: serverKeys.lists() });
    },
  });
}

// Get server logs
export function useServerLogs(id: string, tail?: number) {
  return useQuery({
    queryKey: ['server', id, 'logs', tail],
    queryFn: () => serverApi.getLogs(id, tail ? { tail } : undefined),
    enabled: !!id,
    refetchInterval: 5000, // Poll every 5 seconds for live logs
  });
}
