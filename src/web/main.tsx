// Placeholder entry: the UI agent replaces this file.
import { createRoot } from 'react-dom/client';

function App() {
  return <h1 style={{ fontWeight: 600 }}>My Finance</h1>;
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
