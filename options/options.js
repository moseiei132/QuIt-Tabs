import { getSettings, saveSettings, addExclusionRule, removeExclusionRule, updateExclusionRule } from '../utils/storage.js';

let settings = {};
let editingRuleId = null;

// Examples for each rule type
const PATTERN_EXAMPLES = {
    'domain': {
        example: 'example.com',
        hint: 'Matches only example.com (not subdomains)'
    },
    'domain_all': {
        example: '**.example.com',
        hint: 'Matches example.com and all subdomains (sub.example.com, etc.)'
    },
    'subdomain': {
        example: '*.example.com',
        hint: 'Matches subdomains only (sub.example.com but NOT example.com)'
    },
    'path': {
        example: 'example.com/docs/*',
        hint: 'Matches domain and path pattern'
    },
    'exact': {
        example: 'https://example.com/page',
        hint: 'Matches this exact URL only'
    }
};

// Initialize options page
async function init() {
    try {
        settings = await getSettings();
        renderSettings();
        renderRules();
        setupEventListeners();
    } catch (error) {
        console.error('Error initializing options page:', error);
    }
}

// Render general settings
function renderSettings() {
    document.getElementById('enabledToggle').checked = settings.enabled;
    document.getElementById('globalCountdown').value = settings.globalCountdown / 60;
    document.getElementById('countdownValue').textContent = settings.globalCountdown / 60;
    document.getElementById('autoClosePinned').checked = settings.autoClosePinned;
    document.getElementById('pauseOnMedia').checked = settings.pauseOnMedia;
}

// Render exclusion rules
function renderRules() {
    const container = document.getElementById('rulesContainer');

    if (settings.exclusionRules.length === 0) {
        container.innerHTML = '<div class="empty-state">No exclusion rules yet. Add one to protect tabs from auto-closing.</div>';
        return;
    }

    container.innerHTML = settings.exclusionRules
        .map(rule => renderRuleItem(rule))
        .join('');

    attachRuleListeners();
}

// Render a single rule item
function renderRuleItem(rule) {
    const countdownText = rule.customCountdown === null
        ? 'Never close'
        : `${rule.customCountdown / 60} min`;

    return `
    <div class="rule-item ${!rule.enabled ? 'disabled' : ''}" data-rule-id="${rule.id}">
      <div class="rule-toggle">
        <label class="toggle">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} class="rule-enabled-toggle">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="rule-info">
        <div class="rule-pattern">${escapeHtml(rule.pattern)}</div>
        <div class="rule-meta">
          <span class="rule-type">${rule.type}</span>
          <span class="rule-countdown">⏱️ ${countdownText}</span>
        </div>
      </div>
      <div class="rule-actions">
        <button class="btn btn-small btn-secondary edit-rule-btn">Edit</button>
        <button class="btn btn-small btn-danger delete-rule-btn">Delete</button>
      </div>
    </div>
  `;
}

// Attach event listeners to rule items
function attachRuleListeners() {
    // Toggle enabled/disabled
    document.querySelectorAll('.rule-enabled-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const ruleId = e.target.closest('.rule-item').dataset.ruleId;
            await updateExclusionRule(ruleId, { enabled: e.target.checked });
            settings = await getSettings();
            await notifyBackgroundSettingsChanged();
            showSaveStatus('Rule updated');
        });
    });

    // Edit rule
    document.querySelectorAll('.edit-rule-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ruleId = e.target.closest('.rule-item').dataset.ruleId;
            const rule = settings.exclusionRules.find(r => r.id === ruleId);
            if (rule) {
                openRuleForm(rule);
            }
        });
    });

    // Delete rule
    document.querySelectorAll('.delete-rule-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const ruleId = e.target.closest('.rule-item').dataset.ruleId;
            if (confirm('Are you sure you want to delete this rule?')) {
                await removeExclusionRule(ruleId);
                settings = await getSettings();
                renderRules();
                await notifyBackgroundSettingsChanged();
                showSaveStatus('Rule deleted');
            }
        });
    });
}

// Open rule form for adding or editing
function openRuleForm(rule = null) {
    const form = document.getElementById('ruleForm');
    const title = document.getElementById('formTitle');

    if (rule) {
        // Edit mode
        editingRuleId = rule.id;
        title.textContent = 'Edit Exclusion Rule';
        document.getElementById('ruleType').value = rule.type;
        document.getElementById('rulePattern').value = rule.pattern;
        document.getElementById('customCountdown').value = rule.customCountdown === null ? 'null' : rule.customCountdown;
    } else {
        // Add mode
        editingRuleId = null;
        title.textContent = 'Add Exclusion Rule';
        document.getElementById('ruleType').value = 'domain';
        document.getElementById('rulePattern').value = '';
        document.getElementById('customCountdown').value = 'null';
    }

    updatePatternHint();
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Close rule form
function closeRuleForm() {
    document.getElementById('ruleForm').style.display = 'none';
    editingRuleId = null;
}

// Update pattern hint based on selected type
function updatePatternHint() {
    const type = document.getElementById('ruleType').value;
    const hint = document.getElementById('patternHint');
    const pattern = document.getElementById('rulePattern');

    if (PATTERN_EXAMPLES[type]) {
        pattern.placeholder = PATTERN_EXAMPLES[type].example;
        hint.textContent = PATTERN_EXAMPLES[type].hint;
    }
}

// Save rule
async function saveRule() {
    const type = document.getElementById('ruleType').value;
    const pattern = document.getElementById('rulePattern').value.trim();
    const customCountdown = document.getElementById('customCountdown').value;

    if (!pattern) {
        alert('Please enter a pattern');
        return;
    }

    const ruleData = {
        type,
        pattern,
        customCountdown: customCountdown === 'null' ? null : parseInt(customCountdown)
    };

    if (editingRuleId) {
        // Update existing rule
        await updateExclusionRule(editingRuleId, ruleData);
        showSaveStatus('Rule updated');
    } else {
        // Add new rule
        await addExclusionRule(ruleData);
        showSaveStatus('Rule added');
    }

    settings = await getSettings();
    renderRules();
    closeRuleForm();
    await notifyBackgroundSettingsChanged();
}

// Setup event listeners
function setupEventListeners() {
    // Enabled toggle
    document.getElementById('enabledToggle').addEventListener('change', async (e) => {
        settings.enabled = e.target.checked;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Global countdown slider
    const slider = document.getElementById('globalCountdown');
    const valueDisplay = document.getElementById('countdownValue');

    slider.addEventListener('input', (e) => {
        valueDisplay.textContent = e.target.value;
    });

    slider.addEventListener('change', async (e) => {
        settings.globalCountdown = parseInt(e.target.value) * 60;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Auto-close pinned toggle
    document.getElementById('autoClosePinned').addEventListener('change', async (e) => {
        settings.autoClosePinned = e.target.checked;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Pause on media toggle
    document.getElementById('pauseOnMedia').addEventListener('change', async (e) => {
        settings.pauseOnMedia = e.target.checked;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Add rule button
    document.getElementById('addRuleBtn').addEventListener('click', () => {
        openRuleForm();
    });

    // Rule type change
    document.getElementById('ruleType').addEventListener('change', updatePatternHint);

    // Save rule button
    document.getElementById('saveRuleBtn').addEventListener('click', saveRule);

    // Cancel rule button
    document.getElementById('cancelRuleBtn').addEventListener('click', closeRuleForm);

    // Export rules
    document.getElementById('exportBtn').addEventListener('click', exportRules);

    // Import rules
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    document.getElementById('importFile').addEventListener('change', importRules);
}

// Export rules to JSON
function exportRules() {
    const data = {
        version: 1,
        exportDate: new Date().toISOString(),
        rules: settings.exclusionRules
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quit-tab-manager-rules-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSaveStatus('Rules exported');
}

// Import rules from JSON
async function importRules(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.rules || !Array.isArray(data.rules)) {
            alert('Invalid file format');
            return;
        }

        if (confirm(`Import ${data.rules.length} rules? This will add to your existing rules.`)) {
            for (const rule of data.rules) {
                await addExclusionRule(rule);
            }

            settings = await getSettings();
            renderRules();
            await notifyBackgroundSettingsChanged();
            showSaveStatus(`Imported ${data.rules.length} rules`);
        }
    } catch (error) {
        console.error('Error importing rules:', error);
        alert('Error importing file: ' + error.message);
    }

    // Reset file input
    e.target.value = '';
}

// Notify background script that settings changed
async function notifyBackgroundSettingsChanged() {
    try {
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    } catch (error) {
        console.error('Error notifying background:', error);
    }
}

// Show save status message
function showSaveStatus(message) {
    const status = document.getElementById('saveStatus');
    status.textContent = message;
    status.style.opacity = '1';

    setTimeout(() => {
        status.style.opacity = '0';
    }, 2000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
