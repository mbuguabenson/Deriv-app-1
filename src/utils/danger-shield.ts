/**
 * ProfitHub DangerShield - High-Security DevTools & Console Protection System
 *
 * Prevents unauthorized inspection, tampering, console log leakage, and debugger attachment in production.
 */
import { getSiteConfig } from './supabase-copy';

class DangerShieldService {
    private isShieldActive = false;
    private checkInterval: any = null;
    private overlayElement: HTMLDivElement | null = null;
    private hasInitialized = false;

    /**
     * Determines whether DangerShield should be enforced in the current environment.
     */
    private isEnforcementAllowed(): boolean {
        try {
            const hostname = window.location.hostname;
            // Never lock out local development environments
            if (
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '0.0.0.0' ||
                hostname.endsWith('.local') ||
                hostname.endsWith('.test')
            ) {
                return false;
            }

            // Check admin site config toggle
            const config = getSiteConfig();
            if (config && config.dangerShieldEnabled === false) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get configured links and branding for ProfitHub
     */
    private getConfigDetails() {
        const config = getSiteConfig();
        const hostname = window.location.hostname || 'profithubexpert.com';
        return {
            domain: config?.dangerShieldDomainName || hostname,
            whatsAppUrl: config?.dangerShieldWhatsAppUrl || 'https://whatsapp.com/channel/profithub',
            telegramUrl: config?.dangerShieldTelegramUrl || 'https://t.me/profithubofficial',
        };
    }

    /**
     * Initialize DangerShield protections
     */
    public init(): void {
        if (this.hasInitialized || typeof window === 'undefined') return;
        this.hasInitialized = true;

        if (!this.isEnforcementAllowed()) {
            return;
        }

        // 1. Sanitize console logs in production so tokens, state, or WS messages cannot be inspected
        this.sanitizeConsole();

        // 2. Intercept keyboard shortcuts used for opening DevTools
        this.interceptKeyCombos();

        // 3. Intercept context menu (Right Click Inspect)
        this.interceptContextMenu();

        // 4. Start DevTools detection heartbeat
        this.startDetectionHeartbeat();

        // 5. Listen for real-time site configuration updates from Admin Dashboard
        window.addEventListener('profithub_config_changed', () => {
            if (!this.isEnforcementAllowed() && this.isShieldActive) {
                this.hideShield();
            }
        });
    }

    /**
     * Disables and suppresses noisy or sensitive console logs in production
     */
    private sanitizeConsole(): void {
        try {
            const noop = () => {};
            // Mute standard verbose logs
            console.log = noop;
            console.info = noop;
            console.debug = noop;
            console.table = noop;
            console.dir = noop;

            // Clear console every 3 seconds to wipe any cached traces
            setInterval(() => {
                try {
                    console.clear();
                } catch {
                    /* ignore */
                }
            }, 3000);
        } catch {
            /* ignore */
        }
    }

    /**
     * Block F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S
     */
    private interceptKeyCombos(): void {
        window.addEventListener(
            'keydown',
            (e: KeyboardEvent) => {
                if (!this.isEnforcementAllowed()) return;

                const key = e.key.toUpperCase();
                const code = e.keyCode || e.which;

                // F12
                const isF12 = code === 123 || key === 'F12';

                // Ctrl + Shift + I (Inspect)
                const isInspect = (e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'I' || code === 73);

                // Ctrl + Shift + J (Console)
                const isConsole = (e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'J' || code === 74);

                // Ctrl + Shift + C (Inspect Element)
                const isInspectElement = (e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'C' || code === 67);

                // Ctrl + U (View Source)
                const isViewSource = (e.ctrlKey || e.metaKey) && (key === 'U' || code === 85);

                // Ctrl + S (Save Page)
                const isSavePage = (e.ctrlKey || e.metaKey) && (key === 'S' || code === 83);

                if (isF12 || isInspect || isConsole || isInspectElement || isViewSource || isSavePage) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showShield();
                }
            },
            true
        );
    }

    /**
     * Disable context menu on production to prevent right-click -> Inspect Element
     */
    private interceptContextMenu(): void {
        window.addEventListener(
            'contextmenu',
            (e: MouseEvent) => {
                if (!this.isEnforcementAllowed()) return;
                // Allow right-click on input/textarea if needed for paste
                const target = e.target as HTMLElement;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
            },
            true
        );
    }

    /**
     * Periodically monitors DevTools detection signals
     */
    private startDetectionHeartbeat(): void {
        if (this.checkInterval) clearInterval(this.checkInterval);

        // 1. Dimension delta check (docked devtools detection)
        const checkDimensions = () => {
            if (!this.isEnforcementAllowed()) return;
            const threshold = 160;
            const widthDiff = window.outerWidth - window.innerWidth > threshold;
            const heightDiff = window.outerHeight - window.innerHeight > threshold;

            if (widthDiff || heightDiff) {
                this.showShield();
            } else if (this.isShieldActive) {
                // If user closes DevTools, allow shield recovery
                this.hideShield();
            }
        };

        // 2. Debugger timing inspection (undocked devtools detection)
        const checkDebugger = () => {
            if (!this.isEnforcementAllowed()) return;
            const startTime = performance.now();
            // eslint-disable-next-line no-debugger
            debugger;
            const executionTime = performance.now() - startTime;
            if (executionTime > 100) {
                this.showShield();
            }
        };

        this.checkInterval = setInterval(() => {
            checkDimensions();
            checkDebugger();
        }, 1000);

        window.addEventListener('resize', checkDimensions, { passive: true });
    }

    /**
     * Displays the full-screen DangerShield overlay
     */
    public showShield(force = false): void {
        if (this.isShieldActive || (!force && !this.isEnforcementAllowed())) return;
        this.isShieldActive = true;

        const { domain, whatsAppUrl, telegramUrl } = this.getConfigDetails();

        let overlay = document.getElementById('profithub-danger-shield') as HTMLDivElement;
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'profithub-danger-shield';
            document.body.appendChild(overlay);
        }
        this.overlayElement = overlay;

        // Apply styles directly to ensure tamper-proof styling
        overlay.style.cssText = `
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483647 !important;
            background: radial-gradient(circle at 50% 30%, #1a0808 0%, #080203 70%, #030101 100%) !important;
            backdrop-filter: blur(30px) !important;
            -webkit-backdrop-filter: blur(30px) !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
            color: #ffffff !important;
            padding: 24px !important;
            box-sizing: border-box !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            text-align: center !important;
            overflow: hidden !important;
        `;

        overlay.innerHTML = `
            <style>
                @keyframes pulseDangerSiren {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { transform: scale(1.08); box-shadow: 0 0 0 30px rgba(239, 68, 68, 0); }
                    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                @keyframes radarScan {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes sirenBlink {
                    0%, 100% { opacity: 1; filter: drop-shadow(0 0 16px #ef4444); }
                    50% { opacity: 0.35; filter: drop-shadow(0 0 4px #b91c1c); }
                }
                .danger-shield-card {
                    max-width: 520px;
                    width: 100%;
                    background: rgba(18, 5, 8, 0.92);
                    border: 1.5px solid rgba(239, 68, 68, 0.45);
                    box-shadow: 0 25px 70px -10px rgba(0, 0, 0, 0.9), 0 0 50px rgba(239, 68, 68, 0.25);
                    border-radius: 24px;
                    padding: 38px 28px;
                    position: relative;
                    overflow: hidden;
                }
                .danger-shield-card::before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    background: conic-gradient(from 0deg, transparent 0deg, rgba(239, 68, 68, 0.12) 60deg, transparent 120deg);
                    animation: radarScan 4s linear infinite;
                    pointer-events: none;
                }
                .danger-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 16px;
                    border-radius: 9999px;
                    background: rgba(239, 68, 68, 0.16);
                    border: 1px solid rgba(239, 68, 68, 0.5);
                    font-size: 11.5px;
                    font-weight: 800;
                    letter-spacing: 0.12em;
                    color: #f87171;
                    text-transform: uppercase;
                    margin-bottom: 20px;
                }
                .danger-siren-box {
                    width: 80px;
                    height: 80px;
                    margin: 0 auto 20px auto;
                    border-radius: 50%;
                    background: radial-gradient(circle, #ef4444 0%, #7f1d1d 80%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: pulseDangerSiren 1.5s infinite;
                }
                .danger-siren-icon {
                    font-size: 38px;
                    animation: sirenBlink 0.8s infinite;
                }
                .danger-title {
                    font-size: 22px;
                    font-weight: 900;
                    letter-spacing: 0.05em;
                    color: #ffffff;
                    margin: 0 0 12px 0;
                    text-transform: uppercase;
                }
                .danger-desc {
                    font-size: 14px;
                    color: #cbd5e1;
                    line-height: 1.6;
                    margin: 0 0 18px 0;
                }
                .danger-alarm-text {
                    font-size: 12.5px;
                    font-family: monospace;
                    color: #fca5a5;
                    letter-spacing: 0.08em;
                    background: rgba(239, 68, 68, 0.15);
                    border: 1px dashed rgba(239, 68, 68, 0.35);
                    padding: 8px 14px;
                    border-radius: 10px;
                    margin-bottom: 24px;
                    display: inline-block;
                }
                .danger-follow-box {
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    padding-top: 20px;
                    margin-top: 10px;
                }
                .danger-follow-label {
                    font-size: 12px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    color: #94a3b8;
                    margin-bottom: 12px;
                }
                .danger-links-group {
                    display: flex;
                    gap: 12px;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                .danger-social-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 20px;
                    border-radius: 12px;
                    font-size: 13.5px;
                    font-weight: 700;
                    text-decoration: none;
                    transition: all 0.2s ease;
                    cursor: pointer;
                }
                .danger-btn-wa {
                    background: #25D366;
                    color: #0b2413;
                }
                .danger-btn-wa:hover {
                    background: #22bf5b;
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(37, 211, 102, 0.4);
                }
                .danger-btn-tg {
                    background: #229ED9;
                    color: #08202d;
                }
                .danger-btn-tg:hover {
                    background: #1e8ec3;
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(34, 158, 217, 0.4);
                }
                .danger-reload-btn {
                    margin-top: 22px;
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    color: #ffffff;
                    padding: 10px 24px;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }
                .danger-reload-btn:hover {
                    background: rgba(255, 255, 255, 0.16);
                }
            </style>
            <div class="danger-shield-card">
                <div class="danger-badge">
                    <span>⚠️</span>
                    <span>(Access restricted) Restricted danger zone</span>
                </div>
                <div class="danger-siren-box">
                    <span class="danger-siren-icon">🚨</span>
                </div>
                <h2 class="danger-title">Access Restricted</h2>
                <p class="danger-desc">
                    Developer tools are blocked on <strong>${domain}</strong>. Close inspection tools and reload the page to continue.
                </p>
                <div class="danger-alarm-text">
                    ⚠️ Alarm siren arming...
                </div>
                <div class="danger-follow-box">
                    <div class="danger-follow-label">Follow ProfitHub</div>
                    <div class="danger-links-group">
                        <a href="${whatsAppUrl}" target="_blank" rel="noopener noreferrer" class="danger-social-btn danger-btn-wa">
                            💬 WhatsApp
                        </a>
                        <a href="${telegramUrl}" target="_blank" rel="noopener noreferrer" class="danger-social-btn danger-btn-tg">
                            ✈️ Telegram
                        </a>
                    </div>
                </div>
                <button type="button" class="danger-reload-btn" onclick="window.location.reload()">
                    🔄 Reload Page
                </button>
            </div>
        `;
    }

    /**
     * Hides the DangerShield overlay once tools are closed
     */
    public hideShield(): void {
        if (!this.isShieldActive) return;
        this.isShieldActive = false;
        if (this.overlayElement && this.overlayElement.parentNode) {
            this.overlayElement.parentNode.removeChild(this.overlayElement);
            this.overlayElement = null;
        }
    }
}

export const dangerShield = new DangerShieldService();
