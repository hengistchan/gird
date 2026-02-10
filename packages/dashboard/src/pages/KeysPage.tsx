import { Link } from 'react-router-dom';
import { Loading, ApiError, EmptyState, Button, Card, CardHeader, CardContent, CardTitle, Badge } from '../components/ui';
import { useApiKeys } from '../lib/hooks';

export function KeysPage() {
  const { data, isLoading, error, refetch } = useApiKeys();

  if (isLoading) {
    return <Loading text="Loading API keys..." />;
  }

  if (error) {
    return <ApiError error={error} onRetry={() => refetch()} />;
  }

  const keys = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">API Keys</h2>
        <Link to="/keys/new">
          <Button>Create API Key</Button>
        </Link>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          description="Create your first API key to access your servers."
          action={{
            label: 'Create API Key',
            onClick: () => {
              window.location.href = '/keys/new';
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {keys.map((key: any) => (
            <Card key={key.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">{key.name}</CardTitle>
                <Badge variant="info">API Key</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono text-muted-foreground mb-4">
                  {key.key?.slice(0, 12)}...{key.key?.slice(-4)}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Created: {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : 'Unknown'}
                  </span>
                  <Link to={`/keys/${key.id}`} className="text-sm text-primary hover:underline">
                    View details
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
