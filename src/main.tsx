import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Initialize DangerShield protection in production
import { dangerShield } from './utils/danger-shield';
dangerShield.init();

// Initialize Iframe Authentication Receiver Bridge immediately at startup
import { iframeReceiverService } from './services/iframe-receiver.service';
iframeReceiverService.init();

// Global chunk-load failure handler: reload the page to recover from
// stale/cached index.html referencing missing chunks (pragmatic fallback).
window.addEventListener('error', (e: any) => {
    const msg = e?.message || '';
    if (/Loading chunk \d+ failed/.test(msg) || /Loading CSS chunk \d+ failed/.test(msg)) {
        const lastReload = sessionStorage.getItem('chunk_reload_time');
        const now = Date.now();
        if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
            sessionStorage.setItem('chunk_reload_time', String(now));
            console.warn('Chunk load failure detected, reloading to recover.');
            window.location.reload();
        }
        return;
    }
    // Suppress benign unhandled errors from external trackers/adblockers (e.g. GTM reportAllChanges reading startTime)
    if (typeof msg === 'string' && msg.includes("Cannot read properties of undefined (reading 'startTime')")) {
        e.preventDefault();
        return;
    }
});

window.addEventListener('unhandledrejection', (ev: any) => {
    const reason = ev?.reason;
    const msg = typeof reason === 'string' ? reason : reason?.message;
    if (msg && /Loading chunk \d+ failed/.test(msg)) {
        const lastReload = sessionStorage.getItem('chunk_reload_time');
        const now = Date.now();
        if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
            sessionStorage.setItem('chunk_reload_time', String(now));
            console.warn('Chunk import rejection detected, reloading to recover.');
            window.location.reload();
        }
        return;
    }
    // Suppress browser extension messaging port closure rejections
    if (
        typeof msg === 'string' &&
        (msg.includes('A listener indicated an asynchronous response') ||
            msg.includes('message channel closed before a response was received'))
    ) {
        ev.preventDefault();
        return;
    }
});

// Render the app directly; startup splash is handled inside AppRoot
ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
