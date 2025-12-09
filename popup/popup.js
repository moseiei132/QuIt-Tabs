import { getSettings, addExclusionRule, removeExclusionRule } from '../utils/storage.js';
import { extractDomain } from '../utils/matcher.js';

let currentTab = null;
let allTabs = [];
let tabStates = {};
let settings = {};
let groupByWindow = false;
let searchQuery = '';

// Initialize popup
async function init() {
    try {
        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tabs[0];

        // Get settings and tab states from background
        settings = await getSettings();
        await refreshTabStates(); // Use new refresh function

        // Load all tabs
        await loadAllTabs();

        // Update current tab display
        updateCurrentTab();

        // Set up event listeners
        setupEventListeners();

        // Start real-time countdown updates (local calculation, no polling!)
        setInterval(updateCountdowns, 1000);

        // Listen for tab changes to refresh states
        chrome.tabs.onCreated.addListener(async () => {
            await loadAllTabs();
            await refreshTabStates();
        });
        chrome.tabs.onRemoved.addListener(async () => {
            await loadAllTabs();
            await refreshTabStates();
        });
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
            // Only reload if title or URL changed
            if (changeInfo.title || changeInfo.url) {
                await loadAllTabs();
                await refreshTabStates();
            }
        });

        // Listen for state updates from background (when rules change, etc.)
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'stateUpdated') {
                refreshTabStates();
            }
        });
    } catch (error) {
        console.error('Error initializing popup:', error);
    }
}

// Load all tabs
async function loadAllTabs() {
    try {
        allTabs = await chrome.tabs.query({});
        renderTabsList();
    } catch (error) {
        console.error('Error loading tabs:', error);
    }
}

// Update current tab display
function updateCurrentTab() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const infoEl = document.getElementById('currentTabInfo');

    // Update favicon
    const faviconEl = document.getElementById('currentFavicon');
    if (currentTab.favIconUrl) {
        faviconEl.innerHTML = `<img src="${currentTab.favIconUrl}" alt="">`;
    } else {
        faviconEl.innerHTML = '<svg width="16" height="16" style="opacity: 0.3;"><use href="#icon-globe"/></svg>';
    }

    // Update title and URL
    const titleEl = infoEl.querySelector('.tab-title');
    const urlEl = infoEl.querySelector('.tab-url');
    titleEl.textContent = currentTab.title || 'Untitled';

    // Show hostname + path (no query string)
    try {
        const url = new URL(currentTab.url);
        const displayUrl = url.hostname + (url.pathname !== '/' ? url.pathname : '');
        urlEl.textContent = displayUrl;
    } catch {
        urlEl.textContent = currentTab.url;
    }

    // Update countdown
    updateCurrentTabCountdown();

    // Update pause button
    updatePauseButton();

    // Update exclude button
    updateExcludeButton();
}

// Update exclude button based on current tab state
function updateExcludeButton() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const excludeBtn = document.getElementById('addDomainBtn');
    const shieldIcon = excludeBtn.querySelector('svg use');

    if (state?.matchedRule) {
        // Tab is excluded - show un-exclude
        excludeBtn.innerHTML = '<svg width="14" height="14"><use href="#icon-shield"/></svg> Protected';
        excludeBtn.classList.add('btn-protected');
        excludeBtn.classList.remove('btn-secondary');
    } else {
        // Tab is not excluded
        excludeBtn.innerHTML = '<svg width="14" height="14"><use href="#icon-shield"/></svg> Exclude';
        excludeBtn.classList.remove('btn-protected');
        excludeBtn.classList.add('btn-secondary');
    }
}

// Update current tab countdown
function updateCurrentTabCountdown() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const countdownEl = document.getElementById('currentTabCountdown');
    const timeEl = countdownEl.querySelector('.countdown-time');

    if (!state) {
        timeEl.textContent = '—';
        countdownEl.className = 'countdown';
        return;
    }

    if (state.countdown === null) {
        timeEl.textContent = '∞';
        countdownEl.className = 'countdown excluded';
        return;
    }

    if (state.paused) {
        timeEl.textContent = '⏸ ' + formatTime(state.countdown);
        countdownEl.className = 'countdown';
        return;
    }

    // Calculate remaining time based on background's tracking
    let time;
    if (state.lastActiveTime === null) {
        // Tab is active - show active text like protected
        timeEl.textContent = 'Active';
        countdownEl.className = 'countdown high'; // Green/high color for active
        return;
    } else {
        // Tab is inactive - calculate elapsed time
        const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
        time = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
    }

    timeEl.textContent = formatTime(time);

    // Color coding
    if (time > 180) {
        countdownEl.className = 'countdown high';
    } else if (time > 60) {
        countdownEl.className = 'countdown medium';
    } else {
        countdownEl.className = 'countdown low';
    }
}

// Update pause button state
function updatePauseButton() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const pauseBtn = document.getElementById('pauseBtn');
    const pauseIcon = document.getElementById('pauseIcon');

    if (state && state.paused) {
        pauseIcon.innerHTML = '<use href="#icon-play"/>';
        pauseBtn.title = 'Resume';
    } else {
        pauseIcon.innerHTML = '<use href="#icon-pause"/>';
        pauseBtn.title = 'Pause';
    }
}

// Render tabs list
function renderTabsList() {
    const listEl = document.getElementById('tabsList');
    const countEl = document.getElementById('tabCount');

    // Filter tabs by search query
    let filteredTabs = allTabs.filter(tab => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            tab.title?.toLowerCase().includes(query) ||
            tab.url?.toLowerCase().includes(query)
        );
    });

    countEl.textContent = filteredTabs.length;

    if (filteredTabs.length === 0) {
        listEl.innerHTML = '<div class="empty">No tabs found</div>';
        return;
    }

    if (groupByWindow) {
        renderGroupedTabs(filteredTabs);
    } else {
        renderFlatTabs(filteredTabs);
    }
}

// Render tabs grouped by window
function renderGroupedTabs(tabs) {
    const listEl = document.getElementById('tabsList');
    const windows = {};

    // Group tabs by window
    tabs.forEach(tab => {
        if (!windows[tab.windowId]) {
            windows[tab.windowId] = [];
        }
        windows[tab.windowId].push(tab);
    });

    // Render each window group
    let html = '';
    Object.entries(windows).forEach(([windowId, windowTabs]) => {
        html += `
      <div class="window-group">
        <div class="window-group-header">
          🪟 Window ${windowId} (${windowTabs.length} tabs)
        </div>
        ${windowTabs.map(tab => renderTabItem(tab)).join('')}
      </div>
    `;
    });

    listEl.innerHTML = html;
    attachTabClickListeners();
}

// Render tabs in flat list
function renderFlatTabs(tabs) {
    const listEl = document.getElementById('tabsList');
    listEl.innerHTML = tabs.map(tab => renderTabItem(tab)).join('');
    attachTabClickListeners();
}

// Render a single tab item
function renderTabItem(tab) {
    const state = tabStates[tab.id];
    const isActive = currentTab && tab.id === currentTab.id;

    let favicon = '<svg width="16" height="16" style="opacity: 0.3;"><use href="#icon-globe"/></svg>';
    if (tab.favIconUrl) {
        favicon = `<img src="${tab.favIconUrl}" alt="">`;
    }

    let countdown = '—';
    let countdownLabel = '';
    let countdownClass = '';
    if (state) {
        if (state.countdown === null) {
            countdown = '∞';
            countdownLabel = 'Safe';
            countdownClass = 'excluded';
        } else if (state.paused) {
            countdown = '⏸';
            countdownLabel = 'Paused';
            countdownClass = '';
        } else {
            countdown = formatTime(state.countdown);
            countdownLabel = 'Left';
            if (state.countdown > 180) countdownClass = 'high';
            else if (state.countdown > 60) countdownClass = 'medium';
            else countdownClass = 'low';
        }
    }

    const badges = [];
    if (state?.matchedRule) {
        badges.push('<span class="badge badge-excluded">Protected</span>');
    }
    if (tab.pinned) {
        badges.push('<span class="badge badge-pinned">Pinned</span>');
    }
    if (tab.audible) {
        badges.push('<span class="badge badge-media">🔊</span>');
    }

    const title = tab.title || 'Untitled';

    // Show hostname + path (no query string)
    let displayUrl;
    try {
        const url = new URL(tab.url);
        displayUrl = url.hostname + (url.pathname !== '/' ? url.pathname : '');
    } catch {
        displayUrl = tab.url;
    }

    return `
    <div class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}">
      <div class="tab-favicon">${favicon}</div>
      <div class="tab-details">
        <div class="tab-title">${escapeHtml(title)}</div>
        <div class="tab-url">${escapeHtml(displayUrl)}</div>
      </div>
      <div class="countdown ${countdownClass}">
        <span class="countdown-time">${countdown}</span>
        ${countdownLabel ? `<span class="countdown-label">${countdownLabel}</span>` : ''}
      </div>
      ${badges.length > 0 ? '<div class="badges">' + badges.join('') + '</div>' : ''}
    </div>
  `;
}

// Attach click listeners to tab items
function attachTabClickListeners() {
    document.querySelectorAll('.tab-item').forEach(item => {
        item.addEventListener('click', async () => {
            const tabId = parseInt(item.dataset.tabId);
            const windowId = parseInt(item.dataset.windowId);
            await focusTab(tabId, windowId);
        });
    });
}

// Focus a tab
async function focusTab(tabId, windowId) {
    try {
        // Activate the tab first
        await chrome.tabs.update(tabId, { active: true });
        // Then focus the window
        await chrome.windows.update(windowId, { focused: true });
        // Close popup after a brief delay to ensure tab switch completes
        setTimeout(() => window.close(), 50);
    } catch (error) {
        console.error('Error focusing tab:', error);
    }
}

// Update all countdowns (calculated locally for real-time performance)
function updateCountdowns() {
    // Update current tab countdown
    updateCurrentTabCountdown();

    // Update tab list countdowns
    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const state = tabStates[tabId];
        const countdownEl = item.querySelector('.countdown');
        const timeEl = countdownEl.querySelector('.countdown-time');

        if (!state || state.countdown === null) return;

        if (state.paused) {
            timeEl.textContent = '⏸';
            return;
        }

        // Calculate current countdown based on background's tracking
        let remaining;
        if (state.lastActiveTime === null) {
            // Tab is active - show active text
            timeEl.textContent = 'Active';
            countdownEl.className = 'countdown high';
            return;
        } else {
            // Tab is inactive - calculate elapsed time
            const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
            remaining = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
        }

        timeEl.textContent = formatTime(remaining);

        // Update color
        countdownEl.className = 'countdown';
        if (remaining > 180) countdownEl.classList.add('high');
        else if (remaining > 60) countdownEl.classList.add('medium');
        else countdownEl.classList.add('low');
    });
}

// Refresh tab states from background (only when needed, not every second)
async function refreshTabStates() {
    const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
    if (response.success) {
        tabStates = response.data;
    }
}

// Set up event listeners
function setupEventListeners() {
    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Add domain exclusion - open modal (or show un-exclude if already protected)
    document.getElementById('addDomainBtn').addEventListener('click', () => {
        if (!currentTab) return;

        const state = tabStates[currentTab.id];
        if (state?.matchedRule) {
            // Show un-exclude modal
            openUnexcludeModal(state.matchedRule);
        } else {
            // Show exclude modal
            openExclusionModal();
        }
    });

    // Modal close handlers
    document.getElementById('closeModal').addEventListener('click', closeExclusionModal);
    document.querySelector('.modal-backdrop').addEventListener('click', closeExclusionModal);

    // Cancel button - either cancel or remove
    document.getElementById('cancelExclude').addEventListener('click', async () => {
        const cancelBtn = document.getElementById('cancelExclude');
        const mode = cancelBtn.dataset.mode;

        if (mode === 'remove') {
            // Remove the rule
            const ruleId = cancelBtn.dataset.ruleId;

            if (confirm('Remove protection from this tab?')) {
                await removeExclusionRule(ruleId);
                await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

                closeExclusionModal();

                // Refresh states to update button
                const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
                if (response.success) {
                    tabStates = response.data;
                    updateExcludeButton();
                }

                const statusText = document.getElementById('statusText');
                const originalText = statusText.textContent;
                statusText.textContent = 'Protection removed';
                setTimeout(() => {
                    statusText.textContent = originalText;
                }, 2000);
            }
        } else {
            // Just close modal
            closeExclusionModal();
        }
    });

    // Radio button change - update preview
    document.querySelectorAll('input[name="ruleType"]').forEach(radio => {
        radio.addEventListener('change', updateModalPreview);
    });

    // Confirm exclusion
    document.getElementById('confirmExclude').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('confirmExclude');
        const mode = confirmBtn.dataset.mode;

        if (mode === 'remove') {
            // Remove existing rule
            const ruleId = confirmBtn.dataset.ruleId;
            await removeExclusionRule(ruleId);
            await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

            closeExclusionModal();

            // Refresh states to update button
            const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
            if (response.success) {
                tabStates = response.data;
                updateExcludeButton();
            }

            const statusText = document.getElementById('statusText');
            const originalText = statusText.textContent;
            statusText.textContent = 'Protection removed';
            setTimeout(() => {
                statusText.textContent = originalText;
            }, 2000);
        } else if (mode === 'update') {
            // Update existing rule
            const ruleId = confirmBtn.dataset.ruleId;
            const originalType = confirmBtn.dataset.originalType;
            const selectedType = document.querySelector('input[name="ruleType"]:checked').value;
            const pattern = getRulePattern(selectedType);

            if (!pattern) return;

            // If type changed, remove old rule and add new one
            if (selectedType !== originalType) {
                await removeExclusionRule(ruleId);
                await addExclusionRule({
                    type: selectedType,
                    pattern: pattern,
                    customCountdown: null
                });
            }

            await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

            closeExclusionModal();

            // Refresh states to update button
            const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
            if (response.success) {
                tabStates = response.data;
                updateExcludeButton();
            }

            const statusText = document.getElementById('statusText');
            const originalText = statusText.textContent;
            statusText.textContent = selectedType !== originalType ? `Updated: ${pattern}` : 'Rule unchanged';
            setTimeout(() => {
                statusText.textContent = originalText;
            }, 2000);
        } else {
            // Add new rule
            const selectedType = document.querySelector('input[name="ruleType"]:checked').value;
            const pattern = getRulePattern(selectedType);

            if (!pattern) return;

            await addExclusionRule({
                type: selectedType,
                pattern: pattern,
                customCountdown: null
            });

            await chrome.runtime.sendMessage({ type: 'settingsUpdated' });

            closeExclusionModal();

            // Refresh states to update button
            const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
            if (response.success) {
                tabStates = response.data;
                updateExcludeButton();
            }

            const statusText = document.getElementById('statusText');
            const originalText = statusText.textContent;
            statusText.textContent = `Protected: ${pattern}`;
            setTimeout(() => {
                statusText.textContent = originalText;
            }, 2000);
        }
    });

    // Pause/Resume button
    document.getElementById('pauseBtn').addEventListener('click', async () => {
        if (!currentTab) return;
        const state = tabStates[currentTab.id];

        if (state && state.paused) {
            await chrome.runtime.sendMessage({ type: 'resumeTab', tabId: currentTab.id });
        } else {
            await chrome.runtime.sendMessage({ type: 'pauseTab', tabId: currentTab.id });
        }

        // Refresh states
        const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
        if (response.success) {
            tabStates = response.data;
            updatePauseButton();
        }
    });

    // Search input
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTabsList();
        clearBtn.style.display = searchQuery ? 'block' : 'none';
    });

    clearBtn.addEventListener('click', () => {
        searchQuery = '';
        searchInput.value = '';
        clearBtn.style.display = 'none';
        renderTabsList();
    });

    // Group by window toggle
    document.getElementById('groupByWindowBtn').addEventListener('click', () => {
        groupByWindow = !groupByWindow;
        document.getElementById('groupByWindowBtn').classList.toggle('active', groupByWindow);
        renderTabsList();
    });
}

// Format time in MM:SS
function formatTime(seconds) {
    if (seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================

// Open exclusion modal
function openExclusionModal() {
    if (!currentTab) return;

    const modal = document.getElementById('exclusionModal');

    // Update preview patterns for current URL
    updateModalPatterns();

    // Update preview examples
    updateModalPreview();

    // Show modal
    modal.style.display = 'flex';

    // Reset to current path only (most common use case)
    document.querySelector('input[name="ruleType"][value="path_exact"]').checked = true;
    updateModalPreview();

    // Show add mode
    document.getElementById('confirmExclude').textContent = 'Add Rule';
    document.getElementById('confirmExclude').dataset.mode = 'add';

    // Reset cancel button
    document.getElementById('cancelExclude').textContent = 'Cancel';
    document.getElementById('cancelExclude').dataset.mode = '';
    document.getElementById('cancelExclude').dataset.ruleId = '';

    // Re-enable radio buttons
    document.querySelectorAll('input[name="ruleType"]').forEach(input => {
        input.disabled = false;
    });
}

// Open un-exclude modal (show current rule)
function openUnexcludeModal(rule) {
    if (!currentTab) return;

    const modal = document.getElementById('exclusionModal');

    // Update modal to show current rule
    const ruleInput = document.querySelector(`input[name="ruleType"][value="${rule.type}"]`);
    if (ruleInput) {
        ruleInput.checked = true;
    }

    // Update patterns (will show current rule's pattern)
    updateModalPatterns();
    updateModalPreview();

    // Show modal
    modal.style.display = 'flex';

    // Change to update/remove mode
    const confirmBtn = document.getElementById('confirmExclude');
    const cancelBtn = document.getElementById('cancelExclude');

    confirmBtn.textContent = 'Update Rule';
    confirmBtn.dataset.mode = 'update';
    confirmBtn.dataset.ruleId = rule.id;
    confirmBtn.dataset.originalType = rule.type;

    // Change cancel button to "Remove Protection"
    cancelBtn.textContent = 'Remove Protection';
    cancelBtn.dataset.mode = 'remove';
    cancelBtn.dataset.ruleId = rule.id;

    // Keep radio buttons enabled for editing
    document.querySelectorAll('input[name="ruleType"]').forEach(input => {
        input.disabled = false;
    });
}

// Close exclusion modal
function closeExclusionModal() {
    document.getElementById('exclusionModal').style.display = 'none';

    // Re-enable radio buttons
    document.querySelectorAll('input[name="ruleType"]').forEach(input => {
        input.disabled = false;
    });

    // Reset cancel button text
    document.getElementById('cancelExclude').textContent = 'Cancel';
    document.getElementById('cancelExclude').dataset.mode = '';
}

// Update modal patterns based on current URL
function updateModalPatterns() {
    if (!currentTab) return;

    try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;
        const pathname = url.pathname;

        // Update pattern previews
        document.getElementById('previewDomain').textContent = hostname;
        document.getElementById('previewDomainAll').textContent = `**.${hostname}`;
        document.getElementById('previewSubdomain').textContent = `*.${hostname}`;

        // Path previews
        if (pathname === '/') {
            document.getElementById('previewPathExact').textContent = hostname + '/';
            document.getElementById('previewPath').textContent = hostname + '/';
        } else {
            document.getElementById('previewPathExact').textContent = hostname + pathname;
            const pathWithWildcard = hostname + pathname + (pathname.endsWith('/') ? '*' : '/*');
            document.getElementById('previewPath').textContent = pathWithWildcard;
        }

        // Domain + all paths
        document.getElementById('previewDomainPath').textContent = hostname + '/*';

        document.getElementById('previewExact').textContent = currentTab.url;
    } catch (error) {
        console.error('Error updating modal patterns:', error);
    }
}

// Update modal preview examples
function updateModalPreview() {
    if (!currentTab) return;

    const selectedType = document.querySelector('input[name="ruleType"]:checked').value;
    const previewContainer = document.getElementById('previewExamples');

    try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;
        const parts = hostname.split('.');
        const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;

        let examples = [];

        switch (selectedType) {
            case 'domain':
                examples = [
                    { text: hostname, match: true },
                    { text: `www.${hostname}`, match: false }
                ];
                break;

            case 'domain_all':
                examples = [
                    { text: hostname, match: true },
                    { text: `www.${hostname}`, match: true }
                ];
                break;

            case 'subdomain':
                examples = [
                    { text: hostname, match: false },
                    { text: `www.${hostname}`, match: true }
                ];
                break;

            case 'path_exact':
                const pathname = url.pathname;
                const exactPath = pathname === '/' ? '/' : pathname;
                examples = [
                    { text: hostname + exactPath, match: true },
                    { text: hostname + exactPath + (exactPath === '/' ? 'about' : '/more'), match: false }
                ];
                break;

            case 'path':
                const currentPath = url.pathname;
                examples = [
                    { text: hostname + currentPath, match: true },
                    { text: hostname + currentPath + (currentPath.endsWith('/') ? 'sub' : '/sub'), match: true }
                ];
                break;

            case 'domain_path':
                examples = [
                    { text: hostname + '/', match: true },
                    { text: hostname + '/any/page', match: true }
                ];
                break;

            case 'exact':
                examples = [
                    { text: currentTab.url, match: true },
                    { text: currentTab.url + '?query=value', match: false }
                ];
                break;
        }

        previewContainer.innerHTML = examples.map(ex => `
      <div class="preview-item ${ex.match ? 'preview-match' : 'preview-no-match'}">
        ${ex.match ? '✓' : '✗'} ${escapeHtml(ex.text)}
      </div>
    `).join('');
    } catch (error) {
        console.error('Error updating preview:', error);
    }
}

// Get rule pattern based on type
function getRulePattern(type) {
    if (!currentTab) return null;

    try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;
        const pathname = url.pathname;

        switch (type) {
            case 'domain':
                return hostname;

            case 'domain_all':
                return `**.${hostname}`;

            case 'subdomain':
                return `*.${hostname}`;

            case 'path_exact':
                // Exact path only, no subpaths
                return hostname + pathname;

            case 'path':
                // Current path + all subpaths
                if (pathname === '/') {
                    return hostname + '/';
                }
                return hostname + pathname + (pathname.endsWith('/') ? '*' : '/*');

            case 'domain_path':
                // All pages on this domain
                return hostname + '/*';

            case 'exact':
                return currentTab.url;

            default:
                return null;
        }
    } catch (error) {
        console.error('Error getting rule pattern:', error);
        return null;
    }
}

// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
