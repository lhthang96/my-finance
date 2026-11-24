// Entry point: mounts the app and registers the service worker (push-client owns the SW lifecycle).
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './lib/push-client';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
void registerServiceWorker();
