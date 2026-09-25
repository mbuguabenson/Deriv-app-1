import React, { useState, useEffect } from 'react';
import {
    Save,
    CheckCircle2,
    Palette,
    Layers,
} from 'lucide-react';
import { SiteConfig, saveSiteConfigApi } from '@/utils/admin-api';

interface SiteEngineTabProps {
    siteConfig: SiteConfig | null;
    onConfigUpdated: (config: SiteConfig) => void;
}

export const SiteEngineTab: React.FC<SiteEngineTabProps> = ({ siteConfig, onConfigUpdated }) => {
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [maintenanceNotice, setMaintenanceNotice] = useState('ProfitHub Expert is currently undergoing scheduled platform upgrades. Automated trading is temporarily paused.');
    const [announcementActive, setAnnouncementActive] = useState(false);
    const [announcementText, setAnnouncementText] = useState('Welcome to ProfitHub Expert. Access professional Deriv bot automation & analysis tools.');
    const [primaryColor, setPrimaryColor] = useState('#f5c542');
    const [tabSettings, setTabSettings] = useState<Record<string, boolean>>({
        dashboard: true,
        bot_builder: true,
        chart: true,
        trading_bots: true,
        analysis_tool: true,
        copy_trading: true,
        signals: true,
        auto_x_eo: true,
        digit_cracker: true,
    });
    const [saving, setSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    useEffect(() => {
        if (siteConfig) {
            setMaintenanceMode(!!(siteConfig as any).maintenanceMode);
            if ((siteConfig as any).maintenanceNotice) {
                setMaintenanceNotice((siteConfig as any).maintenanceNotice);
            }
            if ((siteConfig as any).announcementActive !== undefined) {
                setAnnouncementActive(!!(siteConfig as any).announcementActive);
            }
            if ((siteConfig as any).announcementText) {
                setAnnouncementText((siteConfig as any).announcementText);
            }
            if (siteConfig.primaryColor) {
                setPrimaryColor(siteConfig.primaryColor);
            }
            if (Array.isArray(siteConfig.tabConfig)) {
                const nextTabs: Record<string, boolean> = { ...tabSettings };
                siteConfig.tabConfig.forEach((t: any) => {
                    nextTabs[t.key] = t.enabled !== false;
                });
                setTabSettings(nextTabs);
            }
        }
    }, [siteConfig]);

    const toggleTab = (key: string) => {
        setTabSettings(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setSavedSuccess(false);

        const updatedTabs = Object.entries(tabSettings).map(([key, enabled], idx) => ({
            key,
            label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            enabled,
            order: idx,
        }));

        const newConfig = {
            ...(siteConfig || {}),
            primaryColor,
            maintenanceMode,
            maintenanceNotice,
            announcementActive,
            announcementText,
            tabConfig: updatedTabs,
        };

        const res = await saveSiteConfigApi(newConfig);
        setSaving(false);

        if (res) {
            setSavedSuccess(true);
            onConfigUpdated(res);
            setTimeout(() => setSavedSuccess(false), 3500);
        } else {
            alert('Failed to save configuration to server');
        }
    };

    return (
        <div className='ph-tab-content ph-site-engine-tab'>
            {savedSuccess && (
                <div className='ph-alert-banner is-success'>
                    <CheckCircle2 size={18} />
                    <span>Configuration successfully updated and synced across all nodes.</span>
                </div>
            )}

            {/* Maintenance & Emergency Switch */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Platform Maintenance & Public Mode</h3>
                        <p>Toggle emergency pause or scheduled maintenance message</p>
                    </div>
                    <div className='ph-toggle-wrap'>
                        <button
                            type='button'
                            className={`ph-toggle-pill ${maintenanceMode ? 'is-danger' : 'is-inactive'}`}
                            onClick={() => setMaintenanceMode(!maintenanceMode)}
                        >
                            {maintenanceMode ? 'Maintenance Mode ACTIVE' : 'Normal Operations'}
                        </button>
                    </div>
                </div>

                {maintenanceMode && (
                    <div className='ph-form-group ph-mt-3'>
                        <label>Maintenance Banner Message (displayed to visitors)</label>
                        <textarea
                            rows={3}
                            value={maintenanceNotice}
                            onChange={e => setMaintenanceNotice(e.target.value)}
                        />
                    </div>
                )}
            </div>

            {/* Public Announcement Banner */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Site Announcement Bar</h3>
                        <p>Broadcast notices, telegram community links, or updates to traders</p>
                    </div>
                    <button
                        type='button'
                        className={`ph-toggle-pill ${announcementActive ? 'is-active' : 'is-inactive'}`}
                        onClick={() => setAnnouncementActive(!announcementActive)}
                    >
                        {announcementActive ? 'Banner Enabled' : 'Banner Disabled'}
                    </button>
                </div>

                <div className='ph-form-group'>
                    <label>Announcement Notice Content</label>
                    <input
                        type='text'
                        value={announcementText}
                        onChange={e => setAnnouncementText(e.target.value)}
                        placeholder='Enter headline or announcement'
                    />
                </div>
            </div>

            {/* Feature Flags / Enabled Tools */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Feature Flags & Tool Availability</h3>
                        <p>Instantly enable or disable individual trading modules</p>
                    </div>
                    <Layers size={18} className='ph-icon-dim' />
                </div>

                <div className='ph-flags-grid'>
                    {Object.entries(tabSettings).map(([key, enabled]) => {
                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return (
                            <div key={key} className='ph-flag-card'>
                                <div className='ph-flag-info'>
                                    <strong>{label}</strong>
                                    <span className='ph-dim-text'>Module status</span>
                                </div>
                                <button
                                    type='button'
                                    className={`ph-flag-btn ${enabled ? 'is-enabled' : 'is-disabled'}`}
                                    onClick={() => toggleTab(key)}
                                >
                                    {enabled ? 'Enabled' : 'Disabled'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Brand Theme Customization */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>Brand Styling & Appearance</h3>
                        <p>Customize primary gold accent color for the platform</p>
                    </div>
                    <Palette size={18} className='ph-icon-dim' />
                </div>

                <div className='ph-color-picker-row'>
                    <label>Primary Theme Color</label>
                    <div className='ph-color-controls'>
                        <input
                            type='color'
                            value={primaryColor}
                            onChange={e => setPrimaryColor(e.target.value)}
                            className='ph-color-input'
                        />
                        <code>{primaryColor}</code>
                        <button
                            type='button'
                            className='ph-btn-sm ph-btn-outline'
                            onClick={() => setPrimaryColor('#f5c542')}
                        >
                            Reset Default Gold
                        </button>
                    </div>
                </div>
            </div>

            {/* Save Action Floating / Bottom Bar */}
            <div className='ph-save-bar'>
                <div className='ph-save-bar-info'>
                    <span>Ensure you save after toggling features or maintenance controls.</span>
                </div>
                <button
                    className='ph-btn-primary ph-btn-lg'
                    onClick={handleSave}
                    disabled={saving}
                >
                    <Save size={18} />
                    <span>{saving ? 'Saving...' : 'Save Configuration Changes'}</span>
                </button>
            </div>
        </div>
    );
};
