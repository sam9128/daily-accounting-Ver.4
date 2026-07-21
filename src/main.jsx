import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './styles.css';
import './dark.css';
import './mobile.css';
import './layout-fixes.css';

if (import.meta.env.PROD) registerSW({ onNeedRefresh: () => window.dispatchEvent(new Event('book-update-ready')) });
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
