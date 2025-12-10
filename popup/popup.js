import { getSettings, addExclusionRule, removeExclusionRule } from '../utils/storage.js';
import { extractDomain } from '../utils/matcher.js';
import { getPresetForUrl, applyLabelTemplate } from '../utils/website-presets.js';

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
            countdownLabel = ''; // Removed "Left" label
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

        // Add drag and drop
        attachDragHandlers(item);
    });
}

// Attach drag-and-drop handlers to tab items
function attachDragHandlers(item) {
    item.setAttribute('draggable', 'true');

    item.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.tabId);
    });

    item.addEventListener('dragend', (e) => {
        e.stopPropagation();
        item.classList.remove('dragging');
        document.querySelectorAll('.tab-item').forEach(i => i.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const draggingItem = document.querySelector('.dragging');
        if (draggingItem && draggingItem !== item) {
            item.classList.add('drag-over');
        }
    });

    item.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        item.classList.remove('drag-over');
    });

    item.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drag-over');

        const draggedTabId = parseInt(e.dataTransfer.getData('text/plain'));
        const targetTabId = parseInt(item.dataset.tabId);
        const targetWindowId = parseInt(item.dataset.windowId);

        if (draggedTabId === targetTabId) return;

        await moveTab(draggedTabId, targetTabId, targetWindowId);
    });
}

// Move tab to new position or window
async function moveTab(draggedTabId, targetTabId, targetWindowId) {
    try {
        const draggedTab = allTabs.find(t => t.id === draggedTabId);
        const targetTab = allTabs.find(t => t.id === targetTabId);

        if (!draggedTab || !targetTab) return;

        const draggedWindowId = draggedTab.windowId;
        const sameWindow = draggedWindowId === targetWindowId;

        if (sameWindow) {
            // Reorder within same window
            const targetIndex = targetTab.index;
            await chrome.tabs.move(draggedTabId, { index: targetIndex });
        } else {
            // Move to different window
            const targetIndex = targetTab.index;
            await chrome.tabs.move(draggedTabId, {
                windowId: targetWindowId,
                index: targetIndex
            });

            // Check if source window is now empty and close it
            await cleanupEmptyWindow(draggedWindowId);
        }

        // Reload tabs list
        await loadAllTabs();
    } catch (error) {
        console.error('Error moving tab:', error);
    }
}

// Clean up empty windows (with only new tab page)
async function cleanupEmptyWindow(windowId) {
    try {
        const tabs = await chrome.tabs.query({ windowId });

        // If window has only 1 tab and it's a new tab page, close the window
        if (tabs.length === 1) {
            const tab = tabs[0];
            const isEmptyTab = tab.url === 'chrome://newtab/' ||
                tab.url === 'about:blank' ||
                tab.url === 'edge://newtab/' ||
                tab.url === 'brave://newtab/';

            if (isEmptyTab) {
                await chrome.windows.remove(windowId);
            }
        }
    } catch (error) {
        // Window might already be closed, ignore
        console.log('Window cleanup skipped:', error);
    }
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

    // Radio button change - update preview and show/hide querystring checkbox and regex input
    document.querySelectorAll('input[name="ruleType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateModalPreview();
            toggleQueryStringCheckbox();
            toggleRegexInput();
        });
    });

    // Query string checkbox change - update preview
    document.getElementById('includeQueryString').addEventListener('change', updateModalPreview);

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
        renderTabsList();

        // Update button state
        document.getElementById('groupByWindowBtn').style.opacity = groupByWindow ? '1' : '0.5';
    });

    // Merge duplicate tabs button
    document.getElementById('mergeDuplicatesBtn').addEventListener('click', async () => {
        await mergeDuplicateTabs();
    });
}

// Merge duplicate tabs (same URL)
async function mergeDuplicateTabs() {
    try {
        // Group tabs by URL
        const urlGroups = {};
        allTabs.forEach(tab => {
            // Normalize URL (remove hash and some query params)
            let normalizedUrl = tab.url;
            try {
                const url = new URL(tab.url);
                // Remove hash
                url.hash = '';
                normalizedUrl = url.toString();
            } catch (e) {
                // Use original URL if parsing fails
            }

            if (!urlGroups[normalizedUrl]) {
                urlGroups[normalizedUrl] = [];
            }
            urlGroups[normalizedUrl].push(tab);
        });

        // Find duplicates (groups with more than 1 tab)
        const duplicateGroups = Object.values(urlGroups).filter(group => group.length > 1);

        if (duplicateGroups.length === 0) {
            // Show brief feedback - no duplicates
            const btn = document.getElementById('mergeDuplicatesBtn');
            const originalTitle = btn.title;
            btn.title = 'No duplicates found!';
            btn.style.opacity = '0.5';
            setTimeout(() => {
                btn.title = originalTitle;
                btn.style.opacity = '1';
            }, 2000);
            return;
        }

        // For each duplicate group, keep the most recently active tab and close the rest
        let closedCount = 0;
        const tabsToClose = [];

        duplicateGroups.forEach(group => {
            // Sort by active status first, then by id (newer tabs have higher ids)
            group.sort((a, b) => {
                if (a.active && !b.active) return -1;
                if (!a.active && b.active) return 1;
                return b.id - a.id; // Keep most recent (highest id)
            });

            // Keep the first tab (active or most recent), close the rest
            const toClose = group.slice(1);
            tabsToClose.push(...toClose.map(t => t.id));
            closedCount += toClose.length;
        });

        // Close duplicate tabs
        if (tabsToClose.length > 0) {
            await chrome.tabs.remove(tabsToClose);

            // Show feedback
            const btn = document.getElementById('mergeDuplicatesBtn');
            const originalTitle = btn.title;
            btn.title = `Closed ${closedCount} duplicate tab${closedCount === 1 ? '' : 's'}!`;
            btn.style.color = 'var(--macos-green)';
            setTimeout(() => {
                btn.title = originalTitle;
                btn.style.color = '';
            }, 2000);

            // Reload tabs list
            await loadAllTabs();
        }
    } catch (error) {
        console.error('Error merging duplicates:', error);
    }
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

/**
 * Apply website preset labels to modal UI
 * @param {Object} preset - Website preset object
 */
function applyPresetLabels(preset) {
    if (!currentTab || !preset.labels) return;

    // Update each rule type label if preset provides it
    const ruleTypes = ['path_exact', 'domain_path', 'domain_all', 'regex'];

    ruleTypes.forEach(type => {
        if (preset.labels[type]) {
            const radio = document.querySelector(`input[name="ruleType"][value="${type}"]`);
            if (radio) {
                const labelDiv = radio.parentElement.querySelector('.radio-label');
                if (labelDiv) {
                    const titleEl = labelDiv.querySelector('.radio-title');
                    const descEl = labelDiv.querySelector('.radio-desc');

                    if (titleEl && preset.labels[type].title) {
                        titleEl.textContent = preset.labels[type].title;
                    }

                    if (descEl && preset.labels[type].description) {
                        const description = applyLabelTemplate(preset.labels[type].description, currentTab.url);
                        descEl.textContent = description;
                    }
                }
            }
        }
    });
}

/**
 * Apply default (generic) labels to modal UI
 */
function applyDefaultLabels() {
    if (!currentTab) return;

    try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;

        // Default labels (generic, not website-specific)
        const defaultLabels = {
            path_exact: {
                title: 'Just this page',
                description: hostname + url.pathname
            },
            domain_path: {
                title: 'This whole site',
                description: `Any page on ${hostname}`
            },
            domain_all: {
                title: 'Site + related sites',
                description: `${hostname} + subdomains`
            },
            regex: {
                title: 'Custom pattern (advanced)',
                description: 'Use your own regex pattern'
            }
        };

        // Apply default labels
        Object.keys(defaultLabels).forEach(type => {
            const radio = document.querySelector(`input[name="ruleType"][value="${type}"]`);
            if (radio) {
                const labelDiv = radio.parentElement.querySelector('.radio-label');
                if (labelDiv) {
                    const titleEl = labelDiv.querySelector('.radio-title');
                    const descEl = labelDiv.querySelector('.radio-desc');

                    if (titleEl) {
                        titleEl.textContent = defaultLabels[type].title;
                    }

                    if (descEl) {
                        descEl.textContent = defaultLabels[type].description;
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error applying default labels:', error);
    }
}


// Open exclusion modal
async function openExclusionModal() {
    if (!currentTab) return;

    const modal = document.getElementById('exclusionModal');

    // Detect website preset for custom labels
    const preset = await getPresetForUrl(currentTab.url);

    // Apply custom labels if preset exists
    if (preset && preset.labels) {
        applyPresetLabels(preset);
    } else {
        applyDefaultLabels();
    }

    // Update preview patterns for current URL
    updateModalPatterns();

    // Update preview examples
    updateModalPreview();

    // Show modal
    modal.style.display = 'flex';

    // Reset to path_exact (most common use case)
    document.querySelector('input[name="ruleType"][value="path_exact"]').checked = true;
    toggleQueryStringCheckbox();
    toggleRegexInput();
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
async function openUnexcludeModal(rule) {
    if (!currentTab) return;

    const modal = document.getElementById('exclusionModal');

    // Detect website preset for custom labels
    const preset = await getPresetForUrl(currentTab.url);

    // Apply custom labels if preset exists
    if (preset && preset.labels) {
        applyPresetLabels(preset);
    } else {
        applyDefaultLabels();
    }

    // Update modal to show current rule
    const ruleInput = document.querySelector(`input[name="ruleType"][value="${rule.type}"]`);
    if (ruleInput) {
        ruleInput.checked = true;
    }

    // Update patterns (will show current rule's pattern)
    updateModalPatterns();
    toggleQueryStringCheckbox();
    toggleRegexInput();
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

// Toggle query string checkbox visibility
function toggleQueryStringCheckbox() {
    const selectedType = document.querySelector('input[name="ruleType"]:checked').value;
    const queryStringGroup = document.getElementById('queryStringGroup');

    // Hide for regex type (regex handles this internally), show for all others
    queryStringGroup.style.display = selectedType === 'regex' ? 'none' : 'block';
}

// Toggle regex input visibility
function toggleRegexInput() {
    const selectedType = document.querySelector('input[name="ruleType"]:checked').value;
    const regexInputGroup = document.getElementById('regexInputGroup');

    // Show regex input only when regex is selected
    regexInputGroup.style.display = selectedType === 'regex' ? 'block' : 'none';
}

// Update modal patterns based on current URL
function updateModalPatterns() {
    if (!currentTab) return;

    try {
        const url = new URL(currentTab.url);
        const hostname = url.hostname;
        const pathname = url.pathname;

        // Update pattern previews for new simplified rules

        // 1. Just this page
        document.getElementById('previewPageOnly').textContent = hostname + pathname;

        // 2. This whole site  
        document.getElementById('previewWholeSite').textContent = `Any page on ${hostname}`;

        // 3. Site + related sites
        // Extract domain parts for subdomain example
        const parts = hostname.split('.');
        const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
        document.getElementById('previewSiteAndRelated').textContent =
            parts.length > 2 ? `${baseDomain} + ${hostname}` : `${hostname} + api.${hostname}`;

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
        const pathname = url.pathname;
        const includeQueryString = document.getElementById('includeQueryString').checked;

        let examples = [];

        switch (selectedType) {
            case 'path_exact':
                // Just this page
                const fullPath = hostname + pathname;
                const differentPath = hostname + (pathname === '/' ? '/about' : '/different-page');

                if (includeQueryString && url.search) {
                    // With querystring CHECKED: specific item (e.g., YouTube video)
                    examples = [
                        { text: `✓ ${hostname + pathname + url.search}`, match: true },
                        { text: `✗ ${fullPath} (without params)`, match: false },
                        { text: `✗ ${hostname + pathname}?different=value`, match: false }
                    ];
                } else if (url.search) {
                    // With querystring UNCHECKED: any variation (e.g., search pages)
                    examples = [
                        { text: `✓ ${fullPath} (ignores params ✓)`, match: true },
                        { text: `✓ ${hostname + pathname + url.search} (ignores params ✓)`, match: true },
                        { text: `✓ ${fullPath}?page=2 (ignores params ✓)`, match: true }
                    ];
                } else {
                    // No querystring in current URL
                    examples = [
                        { text: `✓ ${fullPath}`, match: true },
                        { text: includeQueryString ? `✗ ${fullPath}?id=123 (params not in current URL)` : `✓ ${fullPath}?id=123 (ignores params ✓)`, match: !includeQueryString },
                        { text: `✗ ${differentPath}`, match: false }
                    ];
                }
                break;

            case 'domain_path':
                // This whole site - querystring setting still applies
                if (includeQueryString && url.search) {
                    examples = [
                        { text: `✓ ${hostname + pathname + url.search}`, match: true },
                        { text: `✓ ${hostname}/other${url.search}`, match: true },
                        { text: `✗ ${hostname + pathname} (no params)`, match: false }
                    ];
                } else {
                    examples = [
                        { text: `✓ ${hostname + pathname}`, match: true },
                        { text: `✓ ${hostname}/other/page`, match: true },
                        { text: `✓ ${hostname}/?any=params`, match: true }
                    ];
                }
                break;

            case 'domain_all':
                // Site + related sites
                const parts = hostname.split('.');
                const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
                const subdomain = parts.length > 2 ? `api.${baseDomain}` : `api.${hostname}`;

                examples = [
                    { text: `✓ ${hostname}/any/page`, match: true },
                    { text: `✓ ${subdomain}/api/v1`, match: true },
                    { text: `✗ other-domain.com`, match: false }
                ];
                break;

            case 'regex':
                // Custom regex pattern
                const regexValue = document.getElementById('regexPattern').value.trim();
                if (regexValue) {
                    examples = [
                        { text: `Pattern: ${regexValue}`, match: true },
                        { text: `Test against current URL`, match: true }
                    ];
                } else {
                    examples = [
                        { text: 'Enter regex above to see examples', match: true },
                        { text: 'Example: ^https://github\\.com/.*/issues$', match: true }
                    ];
                }
                break;

            default:
                examples = [{ text: 'Unknown rule type', match: false }];
        }

        previewContainer.innerHTML = examples.map(ex => `
      <div class="preview-item ${ex.match ? 'preview-match' : 'preview-no-match'}">
        ${escapeHtml(ex.text)}
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
        const includeQueryString = document.getElementById('includeQueryString').checked;

        switch (type) {
            case 'path_exact':
                // Just this page
                if (includeQueryString && url.search) {
                    // Include query params: exact URL
                    return hostname + pathname + url.search;
                } else {
                    // Exclude query params: path only
                    return hostname + pathname;
                }

            case 'domain_path':
                // This whole site - all pages on domain
                return hostname + '/*';

            case 'domain_all':
                // Site + related sites - domain and all subdomains
                return `**.${hostname}`;

            case 'regex':
                // Custom regex pattern - get from input field
                const regexPattern = document.getElementById('regexPattern').value.trim();
                if (!regexPattern) {
                    alert('Please enter a regex pattern');
                    return null;
                }
                // Validate regex
                try {
                    new RegExp(regexPattern);
                    return regexPattern;
                } catch (e) {
                    alert('Invalid regex pattern: ' + e.message);
                    return null;
                }

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
