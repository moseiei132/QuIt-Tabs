/**
 * Settings Module
 * Settings panel and per-site timeout configuration
 */

import { getSettings, saveSettings } from '../../utils/storage.js';
import { settings, currentTab, setSettings } from './state.js';
import { escapeHtml, updateExtensionStatus } from './utils.js';
import { renderTabsList } from './tabs.js';

// ============================================================================
// Theme
// ============================================================================

/**
 * Apply theme to the document root element
 * @param {'system'|'light'|'dark'} theme
 */
export function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

// ============================================================================
// Settings Panel Setup
// ============================================================================

/**
 * Setup settings panel event handlers
 */
export function setupSettingsPanel() {
    const settingsBtn = document.getElementById('settingsBtn');
    const backToTabsBtn = document.getElementById('backToTabsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const historyPanel = document.getElementById('historyPanel');
    const currentTabEl = document.querySelector('.current-tab');
    const tabsSection = document.querySelector('.tabs-section');

    // Open settings panel
    settingsBtn.addEventListener('click', () => {
        if (historyPanel) historyPanel.style.display = 'none';
        currentTabEl.style.display = 'none';
        tabsSection.style.display = 'none';
        settingsPanel.style.display = 'flex';

        // Populate settings values
        document.getElementById('popupEnabledToggle').checked = settings.enabled;
        document.getElementById('popupCountdownInput').value = settings.globalCountdown / 60;
        document.getElementById('popupAutoClosePinned').checked = settings.autoClosePinned;
        document.getElementById('popupAutoCloseSpecial').checked = settings.autoCloseSpecial;
        document.getElementById('popupPauseOnMedia').checked = settings.pauseOnMedia;
        document.getElementById('popupFocusedWindowOnly').checked = settings.focusedWindowOnly;
        document.getElementById('popupProtectSharedGroups').checked = settings.protectSharedGroups ?? true;

        // Sync timeout action picker & 2-step follow-up input
        const currentTimeoutAction = settings.timeoutAction || 'close';
        document.querySelectorAll('#timeoutActionPicker .theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.timeoutAction === currentTimeoutAction);
        });
        const closeAfterRow = document.getElementById('closeAfterDiscardRow');
        const closeAfterInput = document.getElementById('popupCloseAfterDiscardInput');
        if (closeAfterRow) {
            closeAfterRow.style.display = currentTimeoutAction === 'discard_then_close' ? '' : 'none';
        }
        if (closeAfterInput) {
            closeAfterInput.value = Math.max(1, Math.round((settings.closeAfterDiscard ?? 1800) / 60));
        }

        // Sync theme picker active state
        const currentTheme = settings.theme || 'system';
        document.querySelectorAll('#themePicker .theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === currentTheme);
        });

        // Set version from manifest
        const manifest = chrome.runtime.getManifest();
        document.getElementById('extensionVersion').textContent = 'v' + manifest.version;
    });

    // Close settings panel
    backToTabsBtn.addEventListener('click', () => {
        settingsPanel.style.display = 'none';
        currentTabEl.style.display = '';
        tabsSection.style.display = '';
    });

    // Enable toggle
    document.getElementById('popupEnabledToggle').addEventListener('change', async (e) => {
        settings.enabled = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
        updateExtensionStatus();
        renderTabsList();
    });

    // Countdown number input
    const countdownInput = document.getElementById('popupCountdownInput');

    countdownInput.addEventListener('change', async (e) => {
        let value = parseInt(e.target.value);
        // Clamp value between 1 and 60
        if (isNaN(value) || value < 1) value = 1;
        if (value > 60) value = 60;
        e.target.value = value;

        settings.globalCountdown = value * 60;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    });

    // Auto-close pinned toggle
    document.getElementById('popupAutoClosePinned').addEventListener('change', async (e) => {
        settings.autoClosePinned = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
        renderTabsList();
    });

    // Auto-close special toggle
    document.getElementById('popupAutoCloseSpecial').addEventListener('change', async (e) => {
        settings.autoCloseSpecial = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
        renderTabsList();
    });

    // Pause on media toggle
    document.getElementById('popupPauseOnMedia').addEventListener('change', async (e) => {
        settings.pauseOnMedia = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    });

    // Focused window only toggle
    document.getElementById('popupFocusedWindowOnly').addEventListener('change', async (e) => {
        settings.focusedWindowOnly = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    });

    // Protect Shared Tab Groups toggle
    document.getElementById('popupProtectSharedGroups').addEventListener('change', async (e) => {
        settings.protectSharedGroups = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
        renderTabsList();
    });

    // Timeout action picker (Close vs Sleep vs 2-Step Sleep -> Close)
    document.querySelectorAll('#timeoutActionPicker .theme-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.timeoutAction;
            settings.timeoutAction = action;
            await saveSettings(settings);
            await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
            document.querySelectorAll('#timeoutActionPicker .theme-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            const closeAfterRow = document.getElementById('closeAfterDiscardRow');
            if (closeAfterRow) {
                closeAfterRow.style.display = action === 'discard_then_close' ? '' : 'none';
            }
            renderTabsList();
        });
    });

    // Close After Sleep input (2-Step mode)
    const closeAfterDiscardInput = document.getElementById('popupCloseAfterDiscardInput');
    if (closeAfterDiscardInput) {
        closeAfterDiscardInput.addEventListener('change', async (e) => {
            let value = parseInt(e.target.value);
            if (isNaN(value) || value < 1) value = 1;
            if (value > 1440) value = 1440;
            e.target.value = value;

            settings.closeAfterDiscard = value * 60;
            await saveSettings(settings);
            await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
            renderTabsList();
        });
    }

    // Open Full Changelog in a new tab
    document.getElementById('openChangelogBtn')?.addEventListener('click', async () => {
        await chrome.tabs.create({ url: chrome.runtime.getURL('changelog/changelog.html') });
    });

    // Per-Site Timeout: Add button
    document.getElementById('addPerSiteTimeoutBtn').addEventListener('click', () => {
        showPerSiteTimeoutDialog();
    });

    // Theme picker
    document.querySelectorAll('#themePicker .theme-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const theme = btn.dataset.theme;
            settings.theme = theme;
            await saveSettings(settings);
            applyTheme(theme);
            // Update active state
            document.querySelectorAll('#themePicker .theme-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
        });
    });

    // Per-Site Timeout: Cancel button
    document.getElementById('cancelPerSiteTimeout').addEventListener('click', () => {
        hidePerSiteTimeoutDialog();
    });

    // Per-Site Rule: Save button
    document.getElementById('savePerSiteTimeout').addEventListener('click', async () => {
        await savePerSiteTimeoutRule();
    });

    // Per-Site Rule: Timeout mode picker (Global vs Custom)
    document.querySelectorAll('#siteTimeoutModePicker .theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSiteTimeoutMode(btn.dataset.siteTimeoutMode);
        });
    });

    // Per-Site Rule: Action mode picker (Global vs Close vs Sleep vs 2-Step)
    document.querySelectorAll('#siteActionModePicker .theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setSiteActionMode(btn.dataset.siteActionMode);
        });
    });

    // Load per-site rules
    renderPerSiteTimeouts();
}

// ============================================================================
// Per-Site Rule Management
// ============================================================================

let editingSitePattern = null;
let selectedSiteTimeoutMode = 'global';
let selectedSiteActionMode = 'global';

function setSiteTimeoutMode(mode) {
    selectedSiteTimeoutMode = mode;
    document.querySelectorAll('#siteTimeoutModePicker .theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.siteTimeoutMode === mode);
    });
    const customGroup = document.getElementById('siteCustomTimeoutGroup');
    if (customGroup) {
        customGroup.style.display = mode === 'custom' ? '' : 'none';
    }
}

function setSiteActionMode(mode) {
    selectedSiteActionMode = mode;
    document.querySelectorAll('#siteActionModePicker .theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.siteActionMode === mode);
    });
    const closeAfterGroup = document.getElementById('siteCloseAfterDiscardGroup');
    if (closeAfterGroup) {
        closeAfterGroup.style.display = mode === 'discard_then_close' ? '' : 'none';
    }
}

function formatRuleSummary(rule) {
    const timeoutMode = rule.timeoutMode || 'custom';
    const actionMode = rule.actionMode || 'global';

    const timeoutPart = timeoutMode === 'global'
        ? 'Global timer'
        : `${Math.max(1, Math.round((rule.timeout || 1800) / 60))} min`;

    let actionPart = 'Global action';
    if (actionMode === 'close') actionPart = 'Close';
    else if (actionMode === 'discard') actionPart = 'Sleep';
    else if (actionMode === 'discard_then_close') {
        const afterMin = Math.max(1, Math.round((rule.closeAfterDiscard ?? settings.closeAfterDiscard ?? 1800) / 60));
        actionPart = `2-Step (+${afterMin}m)`;
    }

    return `${timeoutPart} · ${actionPart}`;
}

/**
 * Render per-site rules
 */
export async function renderPerSiteTimeouts() {
    const listEl = document.getElementById('perSiteTimeoutsList');
    const rules = settings.perSiteTimeouts || [];

    if (rules.length === 0) {
        listEl.innerHTML = '<div class="empty-message">No site-specific rules set</div>';
        return;
    }

    listEl.innerHTML = rules.map(rule => `
        <div class="per-site-rule" data-edit-pattern="${escapeHtml(rule.pattern)}" title="Click to edit rule">
            <div class="per-site-info">
                <div class="per-site-pattern">${escapeHtml(rule.pattern)}</div>
                <div class="per-site-timeout">${escapeHtml(formatRuleSummary(rule))}</div>
            </div>
            <button class="btn-icon" data-pattern="${escapeHtml(rule.pattern)}" title="Remove rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" />
                </svg>
            </button>
        </div>
    `).join('');

    // Click row to edit
    listEl.querySelectorAll('.per-site-rule').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.btn-icon')) return;
            const pattern = row.dataset.editPattern;
            const existingRule = (settings.perSiteTimeouts || []).find(r => r.pattern === pattern);
            if (existingRule) {
                showPerSiteTimeoutDialog(existingRule);
            }
        });
    });

    // Attach delete handlers
    listEl.querySelectorAll('.btn-icon').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pattern = btn.dataset.pattern;
            await removePerSiteTimeoutRule(pattern);
        });
    });
}

/**
 * Show per-site rule dialog (for adding a new rule or editing an existing one)
 * @param {Object|null} existingRule
 */
export function showPerSiteTimeoutDialog(existingRule = null) {
    const dialog = document.getElementById('perSiteTimeoutDialog');
    const titleEl = document.getElementById('siteRuleDialogTitle');
    const patternInput = document.getElementById('sitePattern');
    const timeoutInput = document.getElementById('siteTimeout');
    const closeAfterInput = document.getElementById('siteCloseAfterDiscard');

    if (existingRule) {
        editingSitePattern = existingRule.pattern;
        if (titleEl) titleEl.textContent = 'Edit Site Rule';
        patternInput.value = existingRule.pattern;
        const timeoutMode = existingRule.timeoutMode || 'custom';
        const actionMode = existingRule.actionMode || 'global';
        setSiteTimeoutMode(timeoutMode);
        setSiteActionMode(actionMode);
        timeoutInput.value = Math.max(1, Math.round((existingRule.timeout || settings.globalCountdown || 1800) / 60));
        closeAfterInput.value = Math.max(1, Math.round((existingRule.closeAfterDiscard ?? settings.closeAfterDiscard ?? 1800) / 60));
    } else {
        editingSitePattern = null;
        if (titleEl) titleEl.textContent = 'Add Site Rule';

        // Pre-fill with current tab's domain if available
        if (currentTab && currentTab.url) {
            try {
                const url = new URL(currentTab.url);
                patternInput.value = url.hostname;
            } catch {
                patternInput.value = '';
            }
        } else {
            patternInput.value = '';
        }

        setSiteTimeoutMode('global');
        setSiteActionMode('global');
        timeoutInput.value = Math.max(1, Math.round((settings.globalCountdown || 1800) / 60));
        closeAfterInput.value = Math.max(1, Math.round((settings.closeAfterDiscard ?? 1800) / 60));
    }

    dialog.style.display = 'flex';
    patternInput.focus();
}

/**
 * Hide per-site rule dialog
 */
export function hidePerSiteTimeoutDialog() {
    const dialog = document.getElementById('perSiteTimeoutDialog');
    dialog.style.display = 'none';
    editingSitePattern = null;
}

/**
 * Save per-site rule
 */
export async function savePerSiteTimeoutRule() {
    const pattern = document.getElementById('sitePattern').value.trim();

    if (!pattern) {
        alert('Please enter a domain pattern');
        return;
    }

    const rule = {
        pattern,
        timeoutMode: selectedSiteTimeoutMode,
        actionMode: selectedSiteActionMode
    };

    if (selectedSiteTimeoutMode === 'custom') {
        const minutes = parseInt(document.getElementById('siteTimeout').value);
        if (!minutes || minutes < 1 || minutes > 1440) {
            alert('Please enter a valid timeout between 1-1440 minutes');
            return;
        }
        rule.timeout = minutes * 60;
    }

    if (selectedSiteActionMode === 'discard_then_close') {
        const closeAfterMinutes = parseInt(document.getElementById('siteCloseAfterDiscard').value);
        if (!closeAfterMinutes || closeAfterMinutes < 1 || closeAfterMinutes > 1440) {
            alert('Please enter a valid "Close After Sleep" duration between 1-1440 minutes');
            return;
        }
        rule.closeAfterDiscard = closeAfterMinutes * 60;
    }

    if (!settings.perSiteTimeouts) {
        settings.perSiteTimeouts = [];
    }

    // Remove previous entry if editing or overwriting same pattern
    settings.perSiteTimeouts = settings.perSiteTimeouts.filter(
        r => r.pattern !== pattern && r.pattern !== editingSitePattern
    );

    settings.perSiteTimeouts.push(rule);

    await saveSettings(settings);
    await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

    hidePerSiteTimeoutDialog();
    renderPerSiteTimeouts();
    renderTabsList();
}

/**
 * Remove per-site timeout rule
 * @param {string} pattern - Pattern to remove
 */
export async function removePerSiteTimeoutRule(pattern) {
    settings.perSiteTimeouts = settings.perSiteTimeouts.filter(r => r.pattern !== pattern);
    await saveSettings(settings);
    await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    renderPerSiteTimeouts();
}
