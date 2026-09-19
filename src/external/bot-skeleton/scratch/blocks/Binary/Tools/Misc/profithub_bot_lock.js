import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../../utils';

window.Blockly.Blocks.profithub_bot_lock = {
    init() {
        this.jsonInit(this.definition());
        this.setDeletable(false);
    },
    definition() {
        return {
            message0: '%1 %2',
            message1: '%1',
            message2: '%1',
            args0: [
                {
                    type: 'field_label',
                    text: '🛡️ ProfitHub Proprietary Bot Security Shield',
                    class: 'blocklyTextRootBlockHeader',
                },
                {
                    type: 'input_dummy',
                },
            ],
            args1: [
                {
                    type: 'field_label',
                    text: localize('Status: [LOCKED] • Execution: ProfitHub Platform Verified Only'),
                },
            ],
            args2: [
                {
                    type: 'field_label',
                    text: localize('This proprietary strategy is digitally signed for ProfitHub. External platform imports are strictly prohibited.'),
                },
            ],
            colour: '#0f4c81',
            colourSecondary: '#0b355a',
            colourTertiary: '#072138',
            tooltip: localize('ProfitHub Proprietary Bot Lock. This block protects intellectual property and prevents this strategy from being exported to or imported on external platforms.'),
            category: window.Blockly?.Categories?.Miscellaneous || 'Miscellaneous',
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
    meta() {
        return {
            display_name: localize('ProfitHub Bot Lock'),
            description: localize(
                'Proprietary bot lock ensuring the strategy runs on ProfitHub authenticated domains and fails to import on external platforms.'
            ),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.profithub_bot_lock = () => {
    return `
// === ProfitHub Algorithmic Security Shield ===
(function() {
    if (typeof window !== 'undefined') {
        var _validDomains = ['profithubexpert', 'hazelhub', 'vercel.app', 'localhost', '127.0.0.1', 'github.io'];
        var _h = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
        var _allowed = _validDomains.some(function(d) { return _h.indexOf(d) !== -1; });
        if (!_allowed) {
            throw new Error('SECURITY VIOLATION: Unauthorized platform execution. This proprietary bot is locked exclusively to ProfitHub.');
        }
    }
})();
`;
};

export const PROFITHUB_LOCK_BLOCK_TYPE = 'profithub_bot_lock';

/**
 * Ensures an XML string has the ProfitHub Bot Lock block attached.
 * External sites (like bot.deriv.com) will fail to import this XML because
 * they lack the 'profithub_bot_lock' block definition.
 */
export const injectProfitHubBotLock = (xmlString) => {
    if (!xmlString || typeof xmlString !== 'string') return xmlString;
    if (xmlString.includes('type="profithub_bot_lock"') || xmlString.includes("type='profithub_bot_lock'")) {
        return xmlString;
    }

    const lockBlock = '<block type="profithub_bot_lock" id="profithub_security_shield_root" deletable="false" movable="true" x="0" y="-120"></block>';

    if (xmlString.includes('</variables>')) {
        return xmlString.replace('</variables>', `</variables>\n  ${lockBlock}`);
    } else if (xmlString.includes('<xml')) {
        return xmlString.replace(/(<xml[^>]*>)/i, `$1\n  ${lockBlock}`);
    }
    return xmlString;
};
