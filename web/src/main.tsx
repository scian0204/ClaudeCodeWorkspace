import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';

function render() {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Static GitHub Pages demo: swap the network layer for the in-memory mock before first render.
if (import.meta.env.VITE_DEMO) {
  import('./demo/install').then(({ installDemo }) => {
    installDemo();
    // Expose the store in the demo build so screenshot/e2e tooling can drive views deterministically.
    import('./lib/store').then(({ useStore }) => { (window as any).__store = useStore; });
    render();
  });
} else {
  render();
}
