import { toast } from 'sonner';

export const notify = {
  success: (message: string, description?: string) => {
    toast.success(message, description ? { description } : undefined);
  },

  error: (message: string, error?: Error | unknown) => {
    const description = error instanceof Error ? error.message : undefined;
    toast.error(message, description ? { description } : undefined);
  },

  info: (message: string, description?: string) => {
    toast(message, description ? { description } : undefined);
  },

  loading: (message: string) => toast.loading(message),

  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string;
      error: string;
    }
  ) => toast.promise(promise, messages),
};
