import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApiKey, useDeleteApiKey } from '../lib/hooks';
import { Loading } from '../components/ui/Loading';
import { ErrorMessage } from '../components/ui/ErrorMessage';
import { Button } from '../components/ui/Button';
import { notify } from '../lib/toast';

export function KeyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: apiKeyData, isLoading, error } = useApiKey(id!);
  const deleteApiKey = useDeleteApiKey();

  // The API returns { success: true, data: { key: {...} } }, and TanStack Query wraps it
  const key = (apiKeyData as any)?.data?.key;

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this API key?')) return;
    try {
      await deleteApiKey.mutateAsync(id!);
      navigate('/keys');
    } catch (err) {
      notify.error('Failed to delete API Key', err);
    }
  };

  if (isLoading) return <Loading text="Loading API key..." />;
  if (error) return <ErrorMessage message={(error as Error).message || 'API Key not found'} />;

  if (!key) return <ErrorMessage message="API Key not found" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/keys" className="text-muted-foreground hover:text-foreground text-sm">
            ← API Keys
          </Link>
          <h1 className="text-2xl font-bold mt-2">{key.name}</h1>
        </div>
        <Button
          onClick={handleDelete}
          disabled={deleteApiKey.isPending}
          variant="danger"
        >
          Delete
        </Button>
      </div>

      <div className="border border-border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">API Key Information</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-40">ID:</dt>
            <dd className="font-mono text-xs break-all">{key.id}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-40">Name:</dt>
            <dd>{key.name}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-40">Permissions:</dt>
            <dd>
              {key.permissions?.serverIds ? (
                <div className="flex flex-col gap-1">
                  <span className="inline-flex items-center px-2 py-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">
                    Limited Access
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {key.permissions.serverIds.length} server(s)
                  </span>
                </div>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                  All Servers
                </span>
              )}
            </dd>
          </div>
          {key.permissions?.serverIds && key.permissions.serverIds.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="text-muted-foreground sm:w-40">Server IDs:</dt>
              <dd className="font-mono text-xs space-y-1">
                {key.permissions.serverIds.map((serverId: string) => (
                  <div key={serverId} className="bg-muted px-2 py-1 rounded">
                    {serverId}
                  </div>
                ))}
              </dd>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-40">Created:</dt>
            <dd>{new Date(key.createdAt).toLocaleString()}</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <dt className="text-muted-foreground sm:w-40">Last Updated:</dt>
            <dd>{new Date(key.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <div className="border border-border border-yellow-200 bg-yellow-50 rounded-lg p-4 dark:border-yellow-800/30 dark:bg-yellow-950/20">
        <h3 className="font-semibold text-yellow-800 dark:text-yellow-400 mb-1">Note</h3>
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          API keys are only shown once during creation. If you've lost this key, you'll need to delete it and create a new one.
        </p>
      </div>
    </div>
  );
}
