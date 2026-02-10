import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './ProtectedRoute';
import { notify } from '../lib/toast';

export function Layout() {
  const { logout } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    notify.success('Logged out successfully');
    window.location.href = '/login';
  };

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/servers', label: 'Servers' },
    { path: '/keys', label: 'API Keys' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Gird</h1>
          <div className="flex items-center gap-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`text-sm transition-colors hover:text-foreground ${
                  location.pathname === item.path
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <button
              onClick={handleLogout}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
