
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installVitePreloadErrorRecovery } from './utils/routePreloadRecovery.mjs';

installVitePreloadErrorRecovery({
  target: window,
  storage: window.sessionStorage,
  reload: () => window.location.reload(),
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <div>
    <App />
  </div>
);
