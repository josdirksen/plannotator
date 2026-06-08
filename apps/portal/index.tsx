import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@plannotator/plan-review';
// Shared design system — same stylesheet the frontend uses, so the portal's
// plan editor looks identical. This folds in the plan-review-specific rules too.
import '@plannotator/ui/design-system.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);