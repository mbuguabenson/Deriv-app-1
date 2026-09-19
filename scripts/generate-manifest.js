const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '../public/xml-uploads');
const manifestPath = path.join(uploadDir, 'bots.json');

// Ensure directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Read directory
const files = fs.readdirSync(uploadDir);
const xmlFiles = files.filter(f => f.toLowerCase().endsWith('.xml'));

// Read existing manifest to preserve custom descriptions/difficulty/strategy if they exist
let existingMap = {};
if (fs.existsSync(manifestPath)) {
    try {
        const existingData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(existingData)) {
            existingData.forEach(item => {
                if (item.file) {
                    existingMap[item.file] = item;
                }
            });
        }
    } catch (e) {
        console.warn('Failed to parse existing bots.json:', e.message);
    }
}

const list = xmlFiles.map(file => {
    const defaultName = path.basename(file, '.xml').replace(/[_-]/g, ' ');

    // If it already exists in the manifest, preserve it
    if (existingMap[file]) {
        return existingMap[file];
    }

    // Generate clean details based on name patterns
    let description = `Advanced trading strategy: ${defaultName}. Optimized for consistent returns and automated execution.`;
    let difficulty = 'Intermediate';
    let strategy = 'Multi-Strategy';

    const upperName = defaultName.toUpperCase();
    if (file === 'Speed Bot.xml') {
        description = 'ProfitHub Fast Lite Speed Bot powered by SV1 architecture with synchronized zero-latency execution.';
        difficulty = 'Advanced';
        strategy = 'Speed Run';
    } else if (file === 'Auto Differ.xml') {
        description = 'High-probability Differs bot powered by the Poverty Hunter 3-tick confirmation strategy. Safe middle digit targeting with auto-recovery.';
        difficulty = 'Intermediate';
        strategy = 'Poverty Hunter Differs';
    } else if (file === 'Elite Pro.xml') {
        description = 'ProfitHub Elite Pro AI Engine with dynamic Over 3 / Under 6 momentum split and adaptive risk management.';
        difficulty = 'Advanced';
        strategy = 'Elite Pro';
    } else if (file === 'Auto X.xml') {
        description = 'High-velocity Auto X Even/Odd algorithmic engine powered by consecutive reversal pattern recognition.';
        difficulty = 'Intermediate';
        strategy = 'Auto X E/O';
    } else if (upperName.includes('EVEN') || upperName.includes('ODD')) {
        strategy = 'Even/Odd';
    } else if (upperName.includes('SCANNER')) {
        strategy = 'Scanner';
        difficulty = 'Advanced';
    } else if (upperName.includes('AI') || upperName.includes('ROBOT')) {
        strategy = 'AI Grid';
        difficulty = 'Advanced';
    } else if (upperName.includes('SPEED')) {
        strategy = 'Speed Run';
    } else if (upperName.includes('BEGINNER')) {
        difficulty = 'Beginner';
    } else if (upperName.includes('RISE') || upperName.includes('FALL')) {
        strategy = 'Rise & Fall';
    }

    return {
        name: defaultName,
        file: file,
        description: description,
        difficulty: difficulty,
        strategy: strategy,
    };
});

// Top priority bots ordering
const TOP_PRIORITY = ['Speed Bot.xml', 'Auto Differ.xml', 'Elite Pro.xml', 'Auto X.xml'];
list.sort((a, b) => {
    const idxA = TOP_PRIORITY.indexOf(a.file);
    const idxB = TOP_PRIORITY.indexOf(b.file);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.name.localeCompare(b.name);
});

// Ensure all platform bots are locked with profithub_bot_lock so external sites fail to import them
const LOCK_BLOCK_STRING = '<block type="profithub_bot_lock" id="profithub_security_shield_root" deletable="false" movable="true" x="0" y="-120"></block>';
xmlFiles.forEach(file => {
    const fullPath = path.join(uploadDir, file);
    try {
        let content = fs.readFileSync(fullPath, 'utf8');
        if (!content.includes('type="profithub_bot_lock"') && !content.includes("type='profithub_bot_lock'")) {
            if (content.includes('</variables>')) {
                content = content.replace('</variables>', `</variables>\n  ${LOCK_BLOCK_STRING}`);
            } else if (content.includes('<xml')) {
                content = content.replace(/(<xml[^>]*>)/i, `$1\n  ${LOCK_BLOCK_STRING}`);
            }
            fs.writeFileSync(fullPath, content, 'utf8');
        }
    } catch (err) {
        console.warn(`Could not lock ${file}:`, err.message);
    }
});

fs.writeFileSync(manifestPath, JSON.stringify(list, null, 2), 'utf8');
console.log(`Successfully generated manifest with ${list.length} bots and ensured bot locks.`);
