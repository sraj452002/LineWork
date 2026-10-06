import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { readColors } from './lib/engines.js';
import './styles.css';

readColors();
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
