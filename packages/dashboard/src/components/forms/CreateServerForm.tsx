import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ServerType } from '@gird/core';
import { useCreateServer } from '../../lib/hooks';

const serverSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  type: z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']),
  description: z.string().optional(),
});

type ServerFormData = z.infer<typeof serverSchema>;

interface CreateServerFormProps {
  onSuccess?: () => void;
}

// Default config for each server type
const getDefaultConfig = (type: ServerType) => {
  switch (type) {
    case 'STDIO':
      return { command: '' };
    case 'SSE':
      return { url: '' };
    case 'AWS_LAMBDA':
      return { functionName: '' };
    case 'EXECUTABLE':
      return { path: '' };
  }
};

export function CreateServerForm({ onSuccess }: CreateServerFormProps) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } =
    useForm<ServerFormData>({
      resolver: zodResolver(serverSchema),
    });

  const createServer = useCreateServer();

  const onSubmit = async (data: ServerFormData) => {
    // For now, just submit basic info with minimal config
    // TODO: Add config form fields based on type
    const requestData: {
      name: string;
      type: ServerType;
      config: Record<string, unknown>;
      description?: string;
    } = {
      name: data.name,
      type: data.type,
      config: getDefaultConfig(data.type),
    };
    if (data.description !== undefined) {
      requestData.description = data.description;
    }
    await createServer.mutateAsync(requestData);
    reset();
    onSuccess?.();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          {...register('name')}
          id="name"
          type="text"
          className="w-full px-3 py-2 border border-border rounded-md bg-background"
        />
        {errors.name && (
          <p className="text-destructive text-sm mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="type" className="block text-sm font-medium mb-1">
          Type
        </label>
        <select
          {...register('type')}
          id="type"
          className="w-full px-3 py-2 border border-border rounded-md bg-background"
        >
          <option value="STDIO">STDIO</option>
          <option value="SSE">SSE</option>
          <option value="AWS_LAMBDA">AWS Lambda</option>
          <option value="EXECUTABLE">Executable</option>
        </select>
        {errors.type && (
          <p className="text-destructive text-sm mt-1">{errors.type.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <textarea
          {...register('description')}
          id="description"
          rows={3}
          className="w-full px-3 py-2 border border-border rounded-md bg-background"
        />
        {errors.description && (
          <p className="text-destructive text-sm mt-1">{errors.description.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || createServer.isPending}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-50"
      >
        {isSubmitting || createServer.isPending ? 'Creating...' : 'Create Server'}
      </button>
    </form>
  );
}
