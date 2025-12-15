/**
 * Settings Module
 * Settings panel and per-site timeout configuration
 */

import { getSettings, saveSettings } from '../../utils/storage.js';
import { settings, currentTab, setSettings } from './state.js';
import { escapeHtml, updateExtensionStatus } from './utils.js';
import { renderTabsList } from './tabs.js';

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
    const currentTabEl = document.querySelector('.current-tab');
    const tabsSection = document.querySelector('.tabs-section');

    // Open settings panel
    settingsBtn.addEventListener('click', () => {
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

    // Per-Site Timeout: Add button
    document.getElementById('addPerSiteTimeoutBtn').addEventListener('click', () => {
        showPerSiteTimeoutDialog();
    });

    // Per-Site Timeout: Cancel button
    document.getElementById('cancelPerSiteTimeout').addEventListener('click', () => {
        hidePerSiteTimeoutDialog();
    });

    // Per-Site Timeout: Save button
    document.getElementById('savePerSiteTimeout').addEventListener('click', async () => {
        await savePerSiteTimeoutRule();
    });

    // Load per-site timeouts
    renderPerSiteTimeouts();
}

// ============================================================================
// Per-Site Timeout Management
// ============================================================================

/**
 * Render per-site timeout rules
 */
export async function renderPerSiteTimeouts() {
    const listEl = document.getElementById('perSiteTimeoutsList');
    const rules = settings.perSiteTimeouts || [];

    if (rules.length === 0) {
        listEl.innerHTML = '<div class="empty-message">No site-specific timeouts set</div>';
        return;
    }

    listEl.innerHTML = rules.map(rule => `
        <div class="per-site-rule">
            <div class="per-site-info">
                <div class="per-site-pattern">${escapeHtml(rule.pattern)}</div>
                <div class="per-site-timeout">${Math.floor(rule.timeout / 60)} minutes</div>
            </div>
            <button class="btn-icon" data-pattern="${escapeHtml(rule.pattern)}" title="Remove rule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" />
                </svg>
            </button>
        </div>
    `).join('');

    // Attach delete handlers
    listEl.querySelectorAll('.btn-icon').forEach(btn => {
        btn.addEventListener('click', async () => {
            const pattern = btn.dataset.pattern;
            await removePerSiteTimeoutRule(pattern);
        });
    });
}

/**
 * Show per-site timeout dialog
 */
export function showPerSiteTimeoutDialog() {
    const dialog = document.getElementById('perSiteTimeoutDialog');
    const patternInput = document.getElementById('sitePattern');
    const timeoutInput = document.getElementById('siteTimeout');

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

    timeoutInput.value = 30; // Default 30 minutes
    dialog.style.display = 'flex';
    patternInput.focus();
}

/**
 * Hide per-site timeout dialog
 */
export function hidePerSiteTimeoutDialog() {
    const dialog = document.getElementById('perSiteTimeoutDialog');
    dialog.style.display = 'none';
}

/**
 * Save per-site timeout rule
 */
export async function savePerSiteTimeoutRule() {
    const pattern = document.getElementById('sitePattern').value.trim();
    const minutes = parseInt(document.getElementById('siteTimeout').value);

    if (!pattern) {
        alert('Please enter a domain pattern');
        return;
    }

    if (!minutes || minutes < 1 || minutes > 1440) {
        alert('Please enter a valid timeout between 1-1440 minutes');
        return;
    }

    const timeout = minutes * 60; // Convert to seconds

    // Add rule to settings
    if (!settings.perSiteTimeouts) {
        settings.perSiteTimeouts = [];
    }

    // Remove existing rule for this pattern
    settings.perSiteTimeouts = settings.perSiteTimeouts.filter(r => r.pattern !== pattern);

    // Add new rule
    settings.perSiteTimeouts.push({ pattern, timeout });

    await saveSettings(settings);
    await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

    hidePerSiteTimeoutDialog();
    renderPerSiteTimeouts();
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
