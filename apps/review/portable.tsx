import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@plannotator/review-editor';
import '@plannotator/review-editor/styles';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

// Portable exports intentionally omit the worker-pool provider. Pierre renders
// the same FileDiff UI on the main thread, avoiding file:// blob-worker failures
// while preserving the production component tree and styling byte-for-byte.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
