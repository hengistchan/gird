import { useParams, useNavigate, Link } from 'react-router-dom';
import { useServer, useStartServer, useStopServer, useDeleteServer, useServerLogs } from '../lib/hooks';
import { Loading, InlineLoading } from '../components/ui/Loading';
import { ErrorMessage } from '../components/ui/ErrorMessage';
import { Button } from '../components/ui/Button';
import { notify } from '../lib/toast';

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: serverData, isLoading, error } = useServer(id!);
  const { data: logsData, isLoading: logsLoading } = useServerLogs(id!, 100);
  const startServer = useStartServer();
  const stopServer = useStopServer();
  const deleteServer = useDeleteServer();

  const handleStart = async () => {
    try {
      await startServer.mutateAsync({ id: id! });
    } catch (err) {
      notify.error('Failed to start server', err);
    }
  };

  const handleStop = async () => {
    try {
      await stopServer.mutateAsync(id!);
    } catch (err) {
      notify.error('Failed to stop server', err);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this server?')) return;
    try {
      await deleteServer.mutateAsync(id!);
      navigate('/servers');
    } catch (err) {
      notify.error('Failed to delete server', err);
    }
  };

  if (isLoading) return <Loading text="Loading server..." />;
  if (error) return <ErrorMessage message={(error as Error).message || 'Server not found'} onRetry={() => window.location.reload()} />;

  // The API returns { success: true, data: {...} }, and TanStack Query wraps it
  const server = (serverData as any)?.data;
  if (!server) return <ErrorMessage message="Server not found" />;

  const isRunning = server.status === 'ACTIVE';
  const logs = (logsData as any)?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/servers" className="text-muted-foreground hover:text-foreground text-sm">
              ← Servers
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-2">{server.name}</h1>
          <p className="text-muted-foreground">{server.type}</p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button
              onClick={handleStop}
              disabled={stopServer.isPending}
              variant="secondary"
            >
              {stopServer.isPending ? <InlineLoading /> : 'Stop'}
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={startServer.isPending}
              variant="default"
            >
              {startServer.isPending ? <InlineLoading /> : 'Start'}
            </Button>
          )}
          <Button
            onClick={() => navigate(`/servers/${id}/edit`)}
            variant="ghost"
          >
            Edit
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleteServer.isPending}
            variant="danger"
          >
            {deleteServer.isPending ? <InlineLoading /> : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Server Info */}
      <div className="border border-border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-2">Server Information</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">ID:</dt>
          <dd className="font-mono text-xs">{server.id}</dd>

          <dt className="text-muted-foreground">Status:</dt>
          <dd>
            <span className={`px-2 py-1 rounded text-xs ${
              isRunning ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {server.status}
            </span>
          </dd>

          <dt className="text-muted-foreground">Type:</dt>
          <dd>{server.type}</dd>

          <dt className="text-muted-foreground">Description:</dt>
          <dd>{server.description || 'No description'}</dd>

          <dt className="text-muted-foreground">Created:</dt>
          <dd>{new Date(server.createdAt).toLocaleString()}</dd>

          <dt className="text-muted-foreground">Last Updated:</dt>
          <dd>{new Date(server.updatedAt).toLocaleString()}</dd>
        </dl>
      </div>

      {/* Logs */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Logs</h2>
          {logsLoading && <InlineLoading />}
        </div>
        <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-gray-500">No logs available</p>
          ) : (
            logs.map((log: string, i: number) => (
              <div key={i} className="whitespace-pre-wrap">{log}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
