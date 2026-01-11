import React from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import ReplaysPage from './pages/ReplaysPage';
import ReplayDetailPage from './pages/ReplayDetailPage';
import PoolPage from './pages/PoolPage';
import SettingsPage from './pages/SettingsPage';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16 }}>
          <div style={{ color: 'crimson', fontWeight: 700, marginBottom: 8 }}>UI crashed</div>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 12, borderRadius: 6 }}>
            {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <strong>Replay Studio</strong>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link to="/replays">Replays</Link>
            <Link to="/pool">Pool</Link>
            <Link to="/settings">Settings</Link>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<ReplaysPage />} />
          <Route path="/replays" element={<ReplaysPage />} />
          <Route path="/replays/:battleId" element={<ReplayDetailPage />} />
          <Route path="/pool" element={<PoolPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </ErrorBoundary>
  );
}
