import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './index.css';

const queryClient = new QueryClient();

function HomePage() {

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Gird</h1>
          <div className="flex gap-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Dashboard</Link>
            <Link to="/servers" className="text-muted-foreground hover:text-foreground">Servers</Link>
            <Link to="/keys" className="text-muted-foreground hover:text-foreground">API Keys</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold">Welcome to Gird</h2>
            <p className="text-muted-foreground">MCP Server Manager - Deploy and manage MCP servers</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">Servers</h3>
              <p className="text-sm text-muted-foreground mb-4">Manage your MCP servers</p>
              <Link to="/servers" className="text-sm text-primary hover:underline">
                View servers →
              </Link>
            </div>

            <div className="border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">API Keys</h3>
              <p className="text-sm text-muted-foreground mb-4">Manage API keys for access control</p>
              <Link to="/keys" className="text-sm text-primary hover:underline">
                View keys →
              </Link>
            </div>

            <div className="border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-2">Logs</h3>
              <p className="text-sm text-muted-foreground mb-4">View server logs and activity</p>
              <button className="text-sm text-primary hover:underline">
                View logs →
              </button>
            </div>
          </div>

          <div className="border border-border rounded-lg p-6">
            <h3 className="font-semibold mb-4">Quick Actions</h3>
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90">
                Create Server
              </button>
              <button className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:opacity-90">
                Create API Key
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ServersPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Gird</h1>
          <div className="flex gap-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Dashboard</Link>
            <Link to="/servers" className="text-foreground">Servers</Link>
            <Link to="/keys" className="text-muted-foreground hover:text-foreground">API Keys</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Servers</h2>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90">
            Create Server
          </button>
        </div>

        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          No servers yet. Create your first server to get started.
        </div>
      </main>
    </div>
  );
}

function KeysPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Gird</h1>
          <div className="flex gap-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Dashboard</Link>
            <Link to="/servers" className="text-muted-foreground hover:text-foreground">Servers</Link>
            <Link to="/keys" className="text-foreground">API Keys</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">API Keys</h2>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90">
            Create API Key
          </button>
        </div>

        <div className="border border-border rounded-lg p-8 text-center text-muted-foreground">
          No API keys yet. Create your first key to access your servers.
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/keys" element={<KeysPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
