import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateApiKey } from '../../lib/hooks';

const apiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  permissions: z.object({
    serverIds: z.array(z.string()).nullable(),
  }),
});

type ApiKeyFormData = z.infer<typeof apiKeySchema>;

interface CreateApiKeyFormProps {
  onSuccess?: (key: string) => void;
}

export function CreateApiKeyForm({ onSuccess }: CreateApiKeyFormProps) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue } =
    useForm<ApiKeyFormData>({
      resolver: zodResolver(apiKeySchema),
      defaultValues: {
        permissions: { serverIds: null },
      },
    });

  const createApiKey = useCreateApiKey();
  const allServersAccess = watch('permissions.serverIds') === null;

  const onSubmit = async (data: ApiKeyFormData) => {
    const result = await createApiKey.mutateAsync(data);
    // Show the key to user (only shown once)
    const key = result.data?.key || '';
    reset();
    onSuccess?.(key);
    return result;
  };

  const handleAllServersChange = (checked: boolean) => {
    // Toggle between null (all servers) and [] (specific servers)
    setValue('permissions.serverIds', checked ? null : []);
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

      <div className="flex items-center gap-2">
        <input
          {...register('permissions.serverIds')}
          id="allServers"
          type="checkbox"
          checked={allServersAccess}
          onChange={(e) => handleAllServersChange(e.target.checked)}
          className="w-4 h-4"
        />
        <label htmlFor="allServers" className="text-sm">
          Access all servers (leave unchecked to select specific servers)
        </label>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || createApiKey.isPending}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 disabled:opacity-50"
      >
        {isSubmitting || createApiKey.isPending ? 'Creating...' : 'Create API Key'}
      </button>
    </form>
  );
}
