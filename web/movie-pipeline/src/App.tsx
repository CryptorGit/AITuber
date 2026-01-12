import { Routes, Route, Link } from 'react-router-dom';
import AssetsPage from './routes/AssetsPage.tsx';
import ProjectPage from './routes/ProjectPage.tsx';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">MP</div>
          <div>
            <div className="brand-title">Movie Pipeline</div>
            <div className="brand-subtitle">Replay + Live2D + TTS + Subtitles</div>
          </div>
        </div>
        <nav className="app-nav">
          <Link to="/" className="nav-link">Assets</Link>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<AssetsPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
        </Routes>
      </main>
    </div>
  );
}
