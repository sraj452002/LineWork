import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { readColors } from './lib/engines.js';
import { applyTheme } from './lib/theme.js';
import './styles.css';

applyTheme(); // before the first paint, so a chosen theme doesn't flash
readColors();
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
