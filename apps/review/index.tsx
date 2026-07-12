import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@plannotator/review-editor';
import { ReviewWorkerPoolProvider } from '@plannotator/review-editor/worker-pool';
import { PORTABLE_GUIDED_REVIEW_SCRIPT_ID } from '@plannotator/shared/guide-export';
import '@plannotator/review-editor/styles';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const app = <App />;
const content = document.getElementById(PORTABLE_GUIDED_REVIEW_SCRIPT_ID)
  ? app
  : <ReviewWorkerPoolProvider>{app}</ReviewWorkerPoolProvider>;
root.render(
  <React.StrictMode>
    {content}
  </React.StrictMode>
);
