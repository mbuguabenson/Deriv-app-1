import React, { useState, useEffect } from 'react';
import {
    UploadCloud,
    Download,
    Trash2,
    AlertCircle,
    FileCode,
    Plus,
    Clock,
    Search,
} from 'lucide-react';
import {
    UploadedBot,
    fetchUploadedBotsApi,
    pushUploadedBotApi,
    deleteUploadedBotApi,
} from '@/utils/admin-api';

export const BotsTab: React.FC = () => {
    const [bots, setBots] = useState<UploadedBot[]>([]);
    const [loading, setLoading] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [botName, setBotName] = useState('');
    const [botDesc, setBotDesc] = useState('');
    const [botXml, setBotXml] = useState('');
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const loadBots = async () => {
        setLoading(true);
        const data = await fetchUploadedBotsApi();
        setBots(data || []);
        setLoading(false);
    };

    useEffect(() => {
        loadBots();
    }, []);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!botName) {
            setBotName(file.name.replace(/\.[^/.]+$/, ''));
        }

        const reader = new FileReader();
        reader.onload = ev => {
            const content = ev.target?.result as string;
            setBotXml(content);
        };
        reader.readAsText(file);
    };

    const handleCreateBot = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!botName.trim() || !botXml.trim()) {
            setUploadError('Bot name and XML contents are required');
            return;
        }

        setUploading(true);
        setUploadError(null);

        const res = await pushUploadedBotApi({
            name: botName.trim(),
            description: botDesc.trim() || 'Automated ProfitHub XML Trading Strategy',
            xml: botXml.trim(),
        });

        setUploading(false);

        if (res) {
            setShowUploadModal(false);
            setBotName('');
            setBotDesc('');
            setBotXml('');
            loadBots();
        } else {
            setUploadError('Failed to upload bot strategy to server');
        }
    };

    const handleDeleteBot = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to delete bot '${name}'?`)) return;
        const res = await deleteUploadedBotApi(id);
        if (res) {
            loadBots();
        } else {
            alert('Failed to delete bot');
        }
    };

    const handleDownloadXml = (bot: UploadedBot) => {
        const blob = new Blob([bot.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bot.name.toLowerCase().replace(/\s+/g, '_')}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const filteredBots = bots.filter(b =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className='ph-tab-content ph-bots-tab'>
            {/* Top Metric Strip */}
            <div className='ph-stats-strip'>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Total XML Bots</span>
                    <strong className='ph-strip-val'>{bots.length}</strong>
                    <span className='ph-strip-sub'>Published trading strategies</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Available to Users</span>
                    <strong className='ph-strip-val ph-neon-green'>{bots.length}</strong>
                    <span className='ph-strip-sub'>Active in bot library</span>
                </div>
                <div className='ph-strip-card'>
                    <span className='ph-strip-label'>Format Compatibility</span>
                    <strong className='ph-strip-val'>Blockly XML</strong>
                    <span className='ph-strip-sub'>Deriv Bot & ProfitHub engine</span>
                </div>
            </div>

            {/* Bots Table Panel */}
            <div className='ph-panel'>
                <div className='ph-panel-header'>
                    <div>
                        <h3>XML Strategy Bot Library</h3>
                        <p>Upload and distribute custom automated trading algorithms to your traders</p>
                    </div>

                    <div className='ph-header-actions'>
                        <div className='ph-search-wrap'>
                            <Search size={16} className='ph-search-icon' />
                            <input
                                type='text'
                                placeholder='Search bot name...'
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <button className='ph-btn-primary' onClick={() => setShowUploadModal(true)}>
                            <Plus size={16} />
                            <span>Upload New Bot</span>
                        </button>
                    </div>
                </div>

                <div className='ph-table-wrap'>
                    <table className='ph-data-table'>
                        <thead>
                            <tr>
                                <th>Bot Strategy</th>
                                <th>Description</th>
                                <th>XML Size</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBots.length > 0 ? (
                                filteredBots.map(bot => (
                                    <tr key={bot.id}>
                                        <td className='ph-cell-loginid'>
                                            <div className='ph-trader-id-pill'>
                                                <FileCode size={16} className='ph-icon-neon' />
                                                <strong>{bot.name}</strong>
                                            </div>
                                        </td>
                                        <td className='ph-dim-text'>{bot.description}</td>
                                        <td>
                                            <code>{Math.round((bot.xml?.length || 0) / 1024)} KB</code>
                                        </td>
                                        <td className='ph-cell-time'>
                                            <Clock size={12} />
                                            <span>
                                                {bot.created_at ? new Date(bot.created_at).toLocaleDateString() : 'Active'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className='ph-actions-row'>
                                                <button
                                                    className='ph-action-icon-btn'
                                                    title='Download XML File'
                                                    onClick={() => handleDownloadXml(bot)}
                                                >
                                                    <Download size={14} />
                                                </button>
                                                <button
                                                    className='ph-action-icon-btn is-danger'
                                                    title='Delete Bot'
                                                    onClick={() => handleDeleteBot(bot.id, bot.name)}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className='ph-empty-cell'>
                                        {loading ? 'Loading bot repository...' : 'No automated XML bots uploaded yet.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Upload Bot Modal */}
            {showUploadModal && (
                <div className='ph-modal-backdrop'>
                    <div className='ph-modal-card'>
                        <div className='ph-modal-header'>
                            <div className='ph-modal-title'>
                                <UploadCloud size={20} />
                                <h3>Upload XML Bot Strategy</h3>
                            </div>
                            <button className='ph-close-btn' onClick={() => setShowUploadModal(false)}>
                                ×
                            </button>
                        </div>

                        {uploadError && (
                            <div className='ph-login-alert'>
                                <AlertCircle size={16} />
                                <span>{uploadError}</span>
                            </div>
                        )}

                        <form onSubmit={handleCreateBot} className='ph-modal-form'>
                            <div className='ph-form-group'>
                                <label>Bot Name</label>
                                <input
                                    type='text'
                                    placeholder='e.g. Even/Odd Digit Assassin Pro'
                                    value={botName}
                                    onChange={e => setBotName(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Description</label>
                                <input
                                    type='text'
                                    placeholder='Strategy summary, recommended stakes or volatility index'
                                    value={botDesc}
                                    onChange={e => setBotDesc(e.target.value)}
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Load XML File</label>
                                <input
                                    type='file'
                                    accept='.xml'
                                    onChange={handleFileUpload}
                                    className='ph-file-input'
                                />
                            </div>

                            <div className='ph-form-group'>
                                <label>Or Paste XML Block Definition</label>
                                <textarea
                                    rows={5}
                                    placeholder='<xml xmlns="https://developers.google.com/blockly/xml">...'
                                    value={botXml}
                                    onChange={e => setBotXml(e.target.value)}
                                    required
                                />
                            </div>

                            <div className='ph-modal-actions'>
                                <button
                                    type='button'
                                    className='ph-btn-outline'
                                    onClick={() => setShowUploadModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type='submit'
                                    className='ph-btn-primary'
                                    disabled={uploading}
                                >
                                    {uploading ? 'Uploading...' : 'Publish Bot to Platform'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
