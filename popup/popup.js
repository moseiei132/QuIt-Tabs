import { getSettings, saveSettings } from '../utils/storage.js';

let currentTab = null;
let allTabs = [];
let tabGroups = {}; // Store tab group info: { groupId: { title, color } }
let tabStates = {};
let settings = {};
let groupByWindow = false;
let searchQuery = '';
let editMode = false; // Edit mode for showing checkboxes

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

        // Update extension status in footer
        updateExtensionStatus();

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

// Load all tabs and groups
async function loadAllTabs() {
    try {
        allTabs = await chrome.tabs.query({});

        // Load tab groups
        const groups = await chrome.tabGroups.query({});
        tabGroups = {};
        groups.forEach(group => {
            tabGroups[group.id] = {
                title: group.title || 'Untitled',
                color: group.color,
                collapsed: group.collapsed
            };
        });

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

    // Update protect button
    updateProtectButton();
}

// Update protect button state
function updateProtectButton() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const protectBtn = document.getElementById('protectBtn');
    const protectIcon = document.getElementById('protectIcon');

    if (state && state.protected) {
        // Tab is protected - show filled shield
        protectIcon.innerHTML = '<use href="#icon-shield-filled"/>';
        protectBtn.classList.add('btn-protected');
        protectBtn.classList.remove('btn-secondary');
        protectBtn.title = 'Unprotect this tab';
    } else {
        // Tab is not protected - show outline shield
        protectIcon.innerHTML = '<use href="#icon-shield"/>';
        protectBtn.classList.remove('btn-protected');
        protectBtn.classList.add('btn-secondary');
        protectBtn.title = 'Protect this tab';
    }
}

// Update current tab countdown
function updateCurrentTabCountdown() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const countdownEl = document.getElementById('currentTabCountdown');
    const timeEl = countdownEl.querySelector('.countdown-time');

    // Show dash when extension is disabled
    if (!settings.enabled) {
        timeEl.textContent = '—';
        countdownEl.className = 'countdown';
        return;
    }

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

    if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
        timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg> ' + formatTime(state.countdown);
        countdownEl.className = 'countdown protected';
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



// Update compact tab info in header (when section collapsed)
function updateCompactTabInfo() {
    const compactTitle = document.getElementById('compactTitle');
    const compactStatus = document.getElementById('compactStatus');

    if (!compactTitle || !compactStatus || !currentTab) return;

    // Set title (truncated)
    const title = currentTab.title || 'Untitled';
    compactTitle.textContent = title.length > 25 ? title.substring(0, 25) + '...' : title;

    // Determine status
    const state = tabStates[currentTab.id];

    // Current tab is always "active" when popup is open (user is viewing it)
    if (!state) {
        // No state = active tab
        compactStatus.textContent = 'Active';
        compactStatus.className = 'compact-status active';
    } else if (state.protected) {
        // Tab is protected
        compactStatus.innerHTML = '<svg width="12" height="12" class="shield-icon"><use href="#icon-shield-filled"/></svg> Protected';
        compactStatus.className = 'compact-status protected';
    } else if (currentTab.active) {
        // This is the active tab in the current window - always show Active
        compactStatus.textContent = 'Active';
        compactStatus.className = 'compact-status active';
    } else if (state.countdown !== null && state.countdown > 0) {
        // Has active countdown (not the current active tab)
        compactStatus.textContent = formatTime(state.countdown);
        compactStatus.className = 'compact-status countdown';
    } else {
        // Default - show as active
        compactStatus.textContent = 'Active';
        compactStatus.className = 'compact-status active';
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
        // Default to tab groups view
        renderGroupsByTabGroups(filteredTabs);
    }
}

// Render tabs grouped by window (maintaining real tab order within each window)
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
        // Sort tabs by index within this window
        windowTabs.sort((a, b) => a.index - b.index);

        html += `<div class="window-group">
          <div class="window-group-header">
            🪟 Window ${windowId} (${windowTabs.length} tabs)
          </div>`;

        // Group consecutive tabs that share the same groupId
        const sections = [];
        let currentSection = null;

        windowTabs.forEach(tab => {
            const tabGroupId = tab.groupId;
            const isGrouped = tabGroupId && tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && tabGroupId !== -1;

            if (!currentSection || currentSection.groupId !== tabGroupId) {
                currentSection = {
                    groupId: tabGroupId,
                    isGrouped: isGrouped,
                    tabs: [tab]
                };
                sections.push(currentSection);
            } else {
                currentSection.tabs.push(tab);
            }
        });

        // Render sections in order
        sections.forEach(section => {
            if (section.isGrouped) {
                const groupInfo = tabGroups[section.groupId];
                const groupTitle = groupInfo?.title || 'Unknown Group';
                const groupColor = groupInfo?.color || 'grey';

                html += `
                <div class="tab-group-inline">
                  <div class="tab-group-header-inline" data-color="${groupColor}">
                    <span class="group-indicator-small" style="background-color: var(--group-${groupColor});"></span>
                    <span class="group-title-small">${escapeHtml(groupTitle)}</span>
                  </div>
                  ${section.tabs.map(tab => renderTabItem(tab, groupColor)).join('')}
                </div>`;
            } else {
                html += section.tabs.map(tab => renderTabItem(tab)).join('');
            }
        });

        html += `</div>`;
    });

    listEl.innerHTML = html;
    attachTabClickListeners();
}

// Render tabs grouped by Chrome tab groups (respecting real tab order)
function renderGroupsByTabGroups(tabs) {
    const listEl = document.getElementById('tabsList');

    // Sort tabs by windowId first, then by their actual index (Chrome tab order)
    // This ensures tabs from different windows are not mixed together
    const sortedTabs = [...tabs].sort((a, b) => {
        if (a.windowId !== b.windowId) {
            return a.windowId - b.windowId;
        }
        return a.index - b.index;
    });

    // Group consecutive tabs that share the same groupId
    const sections = [];
    let currentSection = null;

    sortedTabs.forEach(tab => {
        const tabGroupId = tab.groupId;
        const isGrouped = tabGroupId && tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && tabGroupId !== -1;

        // Check if we should start a new section
        if (!currentSection || currentSection.groupId !== tabGroupId) {
            currentSection = {
                groupId: tabGroupId,
                isGrouped: isGrouped,
                tabs: [tab]
            };
            sections.push(currentSection);
        } else {
            // Add to current section
            currentSection.tabs.push(tab);
        }
    });

    // Render sections
    let html = '';
    sections.forEach(section => {
        if (section.isGrouped) {
            // Render grouped section
            const groupInfo = tabGroups[section.groupId];
            const groupTitle = groupInfo?.title || 'Unknown Group';
            const groupColor = groupInfo?.color || 'grey';

            html += `
      <div class="tab-group">
        <div class="tab-group-header" data-color="${groupColor}">
          <span class="group-indicator" style="background-color: var(--group-${groupColor});"></span>
          <span class="group-title">${escapeHtml(groupTitle)}</span>
          <span class="group-count">(${section.tabs.length})</span>
        </div>
        ${section.tabs.map(tab => renderTabItem(tab, groupColor)).join('')}
      </div>
    `;
        } else {
            // Render ungrouped section (no header)
            html += section.tabs.map(tab => renderTabItem(tab)).join('');
        }
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
function renderTabItem(tab, groupColor = null) {
    const state = tabStates[tab.id];
    const isActive = currentTab && tab.id === currentTab.id;

    let favicon = '<svg width="16" height="16" style="opacity: 0.3;"><use href="#icon-globe"/></svg>';
    if (tab.favIconUrl) {
        favicon = `<img src="${tab.favIconUrl}" alt="">`;
    }

    let countdown = '—';
    let countdownLabel = '';
    let countdownClass = '';

    // Show dash when extension is disabled
    if (!settings.enabled) {
        countdown = '—';
        countdownLabel = '';
        countdownClass = '';
    } else if (state) {
        if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
            // Tab is protected or media playing - show shield indicator
            countdown = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg>';
            countdownLabel = state.protected ? 'Protected' : 'Media';
            countdownClass = 'protected';
        } else {
            countdown = formatTime(state.countdown);
            countdownLabel = '';
            if (state.countdown > 180) countdownClass = 'high';
            else if (state.countdown > 60) countdownClass = 'medium';
            else countdownClass = 'low';
        }
    }

    const badges = [];
    // Protected status is shown via shield icon in countdown, no badge needed
    if (tab.pinned) {
        badges.push('<span class="badge badge-pinned">Pinned</span>');
    }
    if (tab.audible) {
        badges.push('<span class="badge badge-media"><svg width="10" height="10"><use href="#icon-play" /></svg></span>');
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

    // Add group color indicator if tab is in a group
    const groupIndicatorStyle = groupColor
        ? `style="border-left: 3px solid var(--group-${groupColor});"`
        : '';

    return `
    <div class="tab-row">
      <input type="checkbox" class="tab-checkbox-outer" data-tab-id="${tab.id}">
      <div class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-group-id="${tab.groupId || ''}" ${groupIndicatorStyle}>
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
        <button class="tab-close-btn" data-tab-id="${tab.id}" title="Close tab">×</button>
      </div>
    </div>
  `;
}

// Attach click listeners to tab items
function attachTabClickListeners() {
    // Attach checkbox handlers
    document.querySelectorAll('.tab-checkbox-outer').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            updateBatchActionsBar();
        });
    });

    // Attach tab item click handlers
    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const windowId = parseInt(item.dataset.windowId);

        // Click on tab item - focus tab
        item.addEventListener('click', async (e) => {
            // Don't switch if clicking buttons or close
            if (e.target.closest('.btn') || e.target.closest('.tab-close-btn')) return;

            await focusTab(tabId, windowId);
        });

        // Add drag and drop
        attachDragHandlers(item);
    });

    // Attach close button handlers
    document.querySelectorAll('.tab-close-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const tabId = parseInt(btn.dataset.tabId);
            await closeTab(tabId);
        });
    });
}

// Selection state
let selectedTabIds = new Set();

// Update batch actions bar visibility and populate dropdowns
function updateBatchActionsBar() {
    const checkboxes = document.querySelectorAll('.tab-checkbox-outer:checked');
    selectedTabIds = new Set([...checkboxes].map(cb => parseInt(cb.dataset.tabId)));

    const batchBar = document.getElementById('batchActionsBar');
    const selectedCount = document.getElementById('selectedCount');

    if (selectedTabIds.size > 0) {
        batchBar.style.display = 'flex';
        selectedCount.textContent = selectedTabIds.size;

        // Populate group dropdown
        const groupSelect = document.getElementById('moveToGroupSelect');
        groupSelect.innerHTML = '<option value="">Group...</option>';
        Object.entries(tabGroups).forEach(([id, info]) => {
            groupSelect.innerHTML += `<option value="${id}">${escapeHtml(info.title)}</option>`;
        });

        // Populate window dropdown
        const windowSelect = document.getElementById('moveToWindowSelect');
        const windows = [...new Set(allTabs.map(t => t.windowId))];
        windowSelect.innerHTML = '<option value="">Window...</option>';
        windows.forEach(wId => {
            windowSelect.innerHTML += `<option value="${wId}">Window ${wId}</option>`;
        });
    } else {
        batchBar.style.display = 'none';
    }
}

// Batch action: Move selected tabs to group
async function moveSelectedToGroup(groupId) {
    try {
        const tabIds = [...selectedTabIds];
        await chrome.tabs.group({ tabIds, groupId: parseInt(groupId) });
        clearSelection();
        await loadAllTabs();
        updateBatchActionsBar(); // Force update after reload
    } catch (error) {
        console.error('Error moving tabs to group:', error);
    }
}

// Batch action: Move selected tabs to window
async function moveSelectedToWindow(windowId) {
    try {
        for (const tabId of selectedTabIds) {
            await chrome.tabs.move(tabId, { windowId: parseInt(windowId), index: -1 });
        }
        clearSelection();
        await loadAllTabs();
        updateBatchActionsBar(); // Force update after reload
    } catch (error) {
        console.error('Error moving tabs to window:', error);
    }
}

// Batch action: Ungroup selected tabs
async function ungroupSelected() {
    try {
        const tabIds = [...selectedTabIds];
        await chrome.tabs.ungroup(tabIds);
        clearSelection();
        await loadAllTabs();
        updateBatchActionsBar(); // Force update after reload
    } catch (error) {
        console.error('Error ungrouping tabs:', error);
    }
}

// Clear all selections
function clearSelection() {
    document.querySelectorAll('.tab-checkbox-outer').forEach(cb => cb.checked = false);
    selectedTabIds.clear();
    updateBatchActionsBar();
}

// Close a single tab
async function closeTab(tabId) {
    try {
        await chrome.tabs.remove(tabId);
        // Remove from allTabs array
        allTabs = allTabs.filter(t => t.id !== tabId);
        renderTabsList();
    } catch (err) {
        console.error('Failed to close tab:', err);
    }
}

// Close selected tabs
async function closeSelectedTabs() {
    if (selectedTabIds.size === 0) return;

    const tabIds = Array.from(selectedTabIds);

    try {
        await chrome.tabs.remove(tabIds);
        // Remove from allTabs array
        allTabs = allTabs.filter(t => !tabIds.includes(t.id));
        clearSelection();
        renderTabsList();
    } catch (err) {
        console.error('Failed to close tabs:', err);
    }
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

    // Skip tab list updates when extension is disabled
    if (!settings.enabled) return;

    // Update tab list countdowns
    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const state = tabStates[tabId];
        const countdownEl = item.querySelector('.countdown');
        const timeEl = countdownEl.querySelector('.countdown-time');

        if (!state || state.countdown === null) return;

        if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
            // Protected or media playing - show shield icon
            timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg>';
            countdownEl.className = 'countdown protected';
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

// Set up event listeners  
function setupEventListeners() {
    // Current tab toggle
    const toggleCurrentTabBtn = document.getElementById('toggleCurrentTab');
    const currentTabContent = document.querySelector('.current-tab-content');
    const toggleIcon = toggleCurrentTabBtn?.querySelector('.toggle-eye-icon');
    const compactTabInfo = document.getElementById('compactTabInfo');

    if (toggleCurrentTabBtn && currentTabContent && toggleIcon) {
        toggleCurrentTabBtn.addEventListener('click', () => {
            const isCollapsed = currentTabContent.classList.toggle('collapsed');
            toggleIcon.classList.toggle('collapsed');

            // Show/hide compact tab info
            if (compactTabInfo) {
                compactTabInfo.style.display = isCollapsed ? 'flex' : 'none';
                if (isCollapsed) {
                    updateCompactTabInfo();
                }
            }
        });
    }

    // Protect/Unprotect button
    document.getElementById('protectBtn').addEventListener('click', async () => {
        if (!currentTab) return;
        const state = tabStates[currentTab.id];

        if (state && state.protected) {
            await chrome.runtime.sendMessage({ type: 'unprotectTab', tabId: currentTab.id });
        } else {
            await chrome.runtime.sendMessage({ type: 'protectTab', tabId: currentTab.id });
        }

        // Refresh states
        const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
        if (response.success) {
            tabStates = response.data;
            updateProtectButton();
            updateCurrentTabCountdown();
            renderTabsList();
        }
    });

    // Edit Mode toggle
    document.getElementById('editModeBtn').addEventListener('click', () => {
        editMode = !editMode;
        document.getElementById('editModeBtn').classList.toggle('active', editMode);
        document.getElementById('tabsList').classList.toggle('edit-mode', editMode);

        // Clear selections when exiting edit mode
        if (!editMode) {
            clearSelection();
        }
    });

    // Group by window toggle
    document.getElementById('groupByWindowBtn').addEventListener('click', () => {
        groupByWindow = !groupByWindow;
        document.getElementById('groupByWindowBtn').classList.toggle('active', groupByWindow);
        renderTabsList();
    });

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('clearSearch');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        clearSearch.style.display = searchQuery ? 'block' : 'none';
        renderTabsList();
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearch.style.display = 'none';
        renderTabsList();
    });

    // Batch action handlers
    document.getElementById('moveToGroupSelect').addEventListener('change', async (e) => {
        if (e.target.value) {
            await moveSelectedToGroup(e.target.value);
            e.target.value = '';
        }
    });

    document.getElementById('moveToWindowSelect').addEventListener('change', async (e) => {
        if (e.target.value) {
            await moveSelectedToWindow(e.target.value);
            e.target.value = '';
        }
    });

    // Batch action dropdown (ungroup, close)
    document.getElementById('batchActionSelect').addEventListener('change', async (e) => {
        const action = e.target.value;
        if (!action) return;

        if (action === 'ungroup') {
            await ungroupSelected();
        } else if (action === 'close') {
            await closeSelectedTabs();
        }

        e.target.value = ''; // Reset dropdown
    });

    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);

    // Merge duplicate tabs button
    document.getElementById('mergeDuplicatesBtn').addEventListener('click', async () => {
        await mergeDuplicateTabs();
    });

    // Settings panel handlers
    setupSettingsPanel();
}

// Setup settings panel
function setupSettingsPanel() {
    const settingsBtn = document.getElementById('settingsBtn');
    const backToTabsBtn = document.getElementById('backToTabsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const currentTab = document.querySelector('.current-tab');
    const tabsSection = document.querySelector('.tabs-section');

    // Open settings panel
    settingsBtn.addEventListener('click', () => {
        currentTab.style.display = 'none';
        tabsSection.style.display = 'none';
        settingsPanel.style.display = 'flex';

        // Populate settings values
        document.getElementById('popupEnabledToggle').checked = settings.enabled;
        document.getElementById('popupCountdownInput').value = settings.globalCountdown / 60;
        document.getElementById('popupAutoClosePinned').checked = settings.autoClosePinned;
        document.getElementById('popupPauseOnMedia').checked = settings.pauseOnMedia;
    });

    // Close settings panel
    backToTabsBtn.addEventListener('click', () => {
        settingsPanel.style.display = 'none';
        currentTab.style.display = '';
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
    });

    // Pause on media toggle
    document.getElementById('popupPauseOnMedia').addEventListener('change', async (e) => {
        settings.pauseOnMedia = e.target.checked;
        await saveSettings(settings);
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    });
}

// Refresh tab states from background
async function refreshTabStates() {
    const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
    if (response.success) {
        tabStates = response.data;
    }
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
        // NEVER close protected tabs
        let closedCount = 0;
        const tabsToClose = [];

        duplicateGroups.forEach(group => {
            // Sort: protected first, then active, then by id (newer tabs have higher ids)
            group.sort((a, b) => {
                const aProtected = tabStates[a.id]?.protected;
                const bProtected = tabStates[b.id]?.protected;
                // Protected tabs always kept first
                if (aProtected && !bProtected) return -1;
                if (!aProtected && bProtected) return 1;
                // Then active tabs
                if (a.active && !b.active) return -1;
                if (!a.active && b.active) return 1;
                return b.id - a.id; // Keep most recent (highest id)
            });

            // Keep the first tab (protected/active or most recent), close the rest
            // But NEVER close protected tabs
            const toClose = group.slice(1).filter(t => !tabStates[t.id]?.protected);
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

// Update extension status in footer
function updateExtensionStatus() {
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');

    if (settings.enabled) {
        statusIndicator.className = 'status-indicator active';
        statusText.textContent = 'Active';
    } else {
        statusIndicator.className = 'status-indicator disabled';
        statusText.textContent = 'Disabled';
    }
}

// ============================================================================
// Tab Group Management Functions
// ============================================================================

// Move tab to a specific group
async function moveTabToGroup(tabId, targetGroupId) {
    try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId });
        await loadAllTabs();
    } catch (error) {
        console.error('Error moving tab to group:', error);
    }
}

// Remove tab from its current group
async function removeTabFromGroup(tabId) {
    try {
        await chrome.tabs.ungroup([tabId]);
        await loadAllTabs();
    } catch (error) {
        console.error('Error removing tab from group:', error);
    }
}

// Move all tabs in a group to another group
async function moveAllTabsInGroup(sourceGroupId, targetGroupId) {
    try {
        const tabsInGroup = allTabs.filter(tab => tab.groupId === sourceGroupId);
        const tabIds = tabsInGroup.map(tab => tab.id);

        if (targetGroupId === 'ungroup') {
            await chrome.tabs.ungroup(tabIds);
        } else {
            await chrome.tabs.group({ tabIds, groupId: targetGroupId });
        }

        await loadAllTabs();
    } catch (error) {
        console.error('Error moving all tabs in group:', error);
    }
}

// Ungroup all tabs in a group
async function ungroupAllInGroup(groupId) {
    try {
        const tabsInGroup = allTabs.filter(tab => tab.groupId === groupId);
        const tabIds = tabsInGroup.map(tab => tab.id);
        await chrome.tabs.ungroup(tabIds);
        await loadAllTabs();
    } catch (error) {
        console.error('Error ungrouping all:', error);
    }
}

// Move tab to a different window
async function moveTabToWindow(tabId, windowId) {
    try {
        await chrome.tabs.move(tabId, { windowId, index: -1 });
        await loadAllTabs();
    } catch (error) {
        console.error('Error moving tab to window:', error);
    }
}

// ============================================================================
// Context Menu
// ============================================================================

let contextMenuState = {
    visible: false,
    targetTabId: null,
    targetGroupId: null,
    type: null // 'tab' or 'group'
};

// Show context menu
function showContextMenu(x, y, type, targetId, event) {
    event.preventDefault();
    event.stopPropagation();

    const menu = document.getElementById('contextMenu');
    const menuItems = document.querySelector('.context-menu-items');

    contextMenuState = {
        visible: true,
        targetTabId: type === 'tab' ? targetId : null,
        targetGroupId: type === 'group' ? targetId : null,
        type
    };

    // Build menu items based on type
    if (type === 'tab') {
        const tab = allTabs.find(t => t.id === targetId);
        menuItems.innerHTML = buildTabContextMenu(tab);
    } else if (type === 'group') {
        menuItems.innerHTML = buildGroupContextMenu(targetId);
    }

    // Position menu
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';

    // Add click handlers
    attachContextMenuHandlers();

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
    }, 0);
}

// Hide context menu
function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'none';
    contextMenuState.visible = false;
    document.removeEventListener('click', hideContextMenu);
}

// Build tab context menu
function buildTabContextMenu(tab) {
    const otherGroups = Object.entries(tabGroups)
        .filter(([id]) => parseInt(id) !== tab.groupId)
        .map(([id, info]) => `
            <div class="context-menu-item" data-action="moveToGroup" data-group-id="${id}">
                <span class="group-indicator-tiny" style="background-color: var(--group-${info.color});"></span>
                ${escapeHtml(info.title)}
</div>
        `).join('');

    const windows = [...new Set(allTabs.map(t => t.windowId))]
        .filter(wId => wId !== tab.windowId)
        .map(wId => `
            <div class="context-menu-item" data-action="moveToWindow" data-window-id="${wId}">
                🪟 Window ${wId}
            </div>
        `).join('');

    return `
        ${tab.groupId && tab.groupId !== -1 ? `
            <div class="context-menu-item" data-action="removeFromGroup">
                Remove from Group
            </div>
            <div class="context-menu-divider"></div>
        ` : ''}
        ${otherGroups ? `
            <div class="context-menu-item has-submenu">
                Move to Group
                <div class="context-submenu">
                    ${otherGroups}
                </div>
            </div>
        ` : ''}
        ${windows ? `
            <div class="context-menu-item has-submenu">
                Move to Window
                <div class="context-submenu">
                    ${windows}
                </div>
            </div>
        ` : ''}
    `;
}

// Build group context menu
function buildGroupContextMenu(groupId) {
    const otherGroups = Object.entries(tabGroups)
        .filter(([id]) => parseInt(id) !== groupId)
        .map(([id, info]) => `
            <div class="context-menu-item" data-action="moveAllToGroup" data-group-id="${id}">
                <span class="group-indicator-tiny" style="background-color: var(--group-${info.color});"></span>
                ${escapeHtml(info.title)}
            </div>
        `).join('');

    return `
        <div class="context-menu-item" data-action="ungroupAll">
            Ungroup All
        </div>
        ${otherGroups ? `
            <div class="context-menu-divider"></div>
            <div class="context-menu-item has-submenu">
                Move All to Group
                <div class="context-submenu">
                    ${otherGroups}
                </div>
            </div>
        ` : ''}
    `;
}

// Attach context menu action handlers
function attachContextMenuHandlers() {
    document.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = item.dataset.action;

            switch (action) {
                case 'removeFromGroup':
                    await removeTabFromGroup(contextMenuState.targetTabId);
                    break;
                case 'moveToGroup':
                    await moveTabToGroup(contextMenuState.targetTabId, parseInt(item.dataset.groupId));
                    break;
                case 'moveToWindow':
                    await moveTabToWindow(contextMenuState.targetTabId, parseInt(item.dataset.windowId));
                    break;
                case 'ungroupAll':
                    await ungroupAllInGroup(contextMenuState.targetGroupId);
                    break;
                case 'moveAllToGroup':
                    await moveAllTabsInGroup(contextMenuState.targetGroupId, parseInt(item.dataset.groupId));
                    break;
            }

            hideContextMenu();
        });
    });
}

// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
