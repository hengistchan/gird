import { Link } from 'react-router-dom';
import { Loading, ApiError, EmptyState, Button, Card, CardHeader, CardContent, CardTitle, Badge } from '../components/ui';
import { useServers } from '../lib/hooks';

export function ServersPage() {
  const { data, isLoading, error, refetch } = useServers();

  if (isLoading) {
    return <Loading text="Loading servers..." />;
  }

  if (error) {
    return <ApiError error={error} onRetry={() => refetch()} />;
  }

  const servers = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Servers</h2>
        <Link to="/servers/new">
          <Button>Create Server</Button>
        </Link>
      </div>

      {servers.length === 0 ? (
        <EmptyState
          title="No servers yet"
          description="Create your first server to get started with MCP deployment."
          action={{
            label: 'Create Server',
            onClick: () => {
              // Navigate to create server page
              window.location.href = '/servers/new';
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server: any) => (
            <Card key={server.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">{server.name}</CardTitle>
                <Badge variant="info">{server.type}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {server.description || 'No description'}
                </p>
                <div className="flex items-center justify-between">
                  <Badge
                    variant={
                      server.status === 'running'
                        ? 'success'
                        : server.status === 'stopped'
                          ? 'default'
                          : 'danger'
                    }
                  >
                    {server.status || 'unknown'}
                  </Badge>
                  <Link to={`/servers/${server.id}`} className="text-sm text-primary hover:underline">
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
