import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { watchForUpdates } from './lib/updates.js';
import App from './App.jsx';
import './styles.css';
import './logic.css';
import './mobile.css';

if (import.meta.env.PROD) watchForUpdates(() => window.dispatchEvent(new Event('book-update-ready')));
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
