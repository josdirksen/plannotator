import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@plannotator/code-review';
// Design system + code-review styles + the @source scan for the package.
import './index.css';

// No SessionProvider here on purpose: the code-review App's `/api/diff` call
// falls through to globalThis.fetch, fails (no daemon), and the App loads its
// built-in DEMO_DIFF. That's what makes this harness daemon-free.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
