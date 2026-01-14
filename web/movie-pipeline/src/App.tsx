import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import WorkspacePage from './routes/WorkspacePage.tsx';
import ProjectPage from './routes/ProjectPage.tsx';

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
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark">MP</div>
            <div>
              <div className="brand-title">Movie Pipeline</div>
              <div className="brand-subtitle">Assets + Project (stages)</div>
            </div>
          </div>
          <nav className="app-nav">
            <Link className="nav-link" to="/">Workspace</Link>
          </nav>
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<WorkspacePage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  );
}
