import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardTitle } from '../components/ui/Card';

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome to Gird</h2>
        <p className="text-muted-foreground">MCP Server Manager - Deploy and manage MCP servers</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <CardTitle className="mb-2">Servers</CardTitle>
          <p className="text-sm text-muted-foreground mb-4">Manage your MCP servers</p>
          <Link to="/servers" className="text-sm text-primary hover:underline">
            View servers &rarr;
          </Link>
        </Card>

        <Card className="p-6">
          <CardTitle className="mb-2">API Keys</CardTitle>
          <p className="text-sm text-muted-foreground mb-4">Manage API keys for access control</p>
          <Link to="/keys" className="text-sm text-primary hover:underline">
            View keys &rarr;
          </Link>
        </Card>

        <Card className="p-6">
          <CardTitle className="mb-2">Logs</CardTitle>
          <p className="text-sm text-muted-foreground mb-4">View server logs and activity</p>
          <button className="text-sm text-primary hover:underline">
            View logs &rarr;
          </button>
        </Card>
      </div>

      <Card className="p-6">
        <CardTitle className="mb-4">Quick Actions</CardTitle>
        <div className="flex gap-2">
          <Button>Create Server</Button>
          <Button variant="secondary">Create API Key</Button>
        </div>
      </Card>
    </div>
  );
}
