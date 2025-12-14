import { getSettings, saveSettings } from '../utils/storage.js';

let currentTab = null;
let allTabs = [];
let tabGroups = {}; // Store tab group info: { groupId: { title, color } }
let tabStates = {};
let settings = {};
let groupByWindow = true; // Always show window groups
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

    // Skip if icon doesn't exist (button might be in Cancel mode)
    if (!protectIcon) return;

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
    const compactFavicon = document.getElementById('compactFavicon');
    const compactTitle = document.getElementById('compactTitle');
    const compactCountdown = document.getElementById('compactCountdown');

    if (!compactTitle || !compactCountdown || !currentTab) return;

    // Set favicon
    if (compactFavicon && currentTab.favIconUrl) {
        compactFavicon.src = currentTab.favIconUrl;
        compactFavicon.style.display = 'block';
    } else if (compactFavicon) {
        compactFavicon.style.display = 'none';
    }

    // Set title (truncated)
    const title = currentTab.title || 'Untitled';
    compactTitle.textContent = title.length > 20 ? title.substring(0, 20) + '…' : title;

    // Determine countdown display
    const state = tabStates[currentTab.id];

    if (!state || currentTab.active) {
        // Active tab
        compactCountdown.textContent = 'Active';
        compactCountdown.className = 'compact-countdown active';
    } else if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
        // Tab is protected or media playing
        compactCountdown.textContent = state.protected ? 'Protected' : 'Media';
        compactCountdown.className = 'compact-countdown protected';
    } else if (state.countdown !== null && state.countdown > 0) {
        // Has active countdown
        compactCountdown.textContent = formatTime(state.countdown);
        compactCountdown.className = 'compact-countdown countdown';
    } else {
        compactCountdown.textContent = 'Active';
        compactCountdown.className = 'compact-countdown active';
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

        // Add window header as a non-draggable row
        html += `<div class="tab-row window-header-row" data-window-id="${windowId}">
          <div class="window-group-header">
            🪟 Window ${windowId} (${windowTabs.length} tabs)
          </div>
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

                // Render group header as a special row
                html += `<div class="tab-row group-header-row" data-group-id="${section.groupId}" data-color="${groupColor}">
                  <div class="tab-group-header-inline" data-color="${groupColor}">
                    <span class="group-indicator-small" style="background-color: var(--group-${groupColor});"></span>
                    <span class="group-title-small">${escapeHtml(groupTitle)}</span>
                  </div>
                </div>`;

                // Render tabs in the group
                html += section.tabs.map(tab => renderTabItem(tab, groupColor)).join('');
            } else {
                html += section.tabs.map(tab => renderTabItem(tab)).join('');
            }
        });
    });

    listEl.innerHTML = html;
    attachTabClickListeners();
    initializeSortable();
}

// Render tabs grouped by Chrome tab groups (respecting real tab order)
// Uses flat structure with group headers as separator items
function renderGroupsByTabGroups(tabs) {
    const listEl = document.getElementById('tabsList');

    // Sort tabs by windowId first, then by their actual index (Chrome tab order)
    const sortedTabs = [...tabs].sort((a, b) => {
        if (a.windowId !== b.windowId) {
            return a.windowId - b.windowId;
        }
        return a.index - b.index;
    });

    // Build flat list with group headers inserted
    let html = '';
    let lastGroupId = null;

    sortedTabs.forEach(tab => {
        const tabGroupId = tab.groupId;
        const isGrouped = tabGroupId && tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && tabGroupId !== -1;

        // If group changed, insert group header
        if (isGrouped && lastGroupId !== tabGroupId) {
            const groupInfo = tabGroups[tabGroupId];
            const groupTitle = groupInfo?.title || 'Unknown Group';
            const groupColor = groupInfo?.color || 'grey';

            html += `
                <div class="tab-row group-header-row" data-group-id="${tabGroupId}">
                    <div class="group-header-item" data-color="${groupColor}">
                        <span class="group-indicator" style="background-color: var(--group-${groupColor});"></span>
                        <span class="group-title">${escapeHtml(groupTitle)}</span>
                    </div>
                </div>
            `;
        }

        // Render the tab item (all tabs are now in .tab-row for consistent dragging)
        html += renderTabItem(tab, isGrouped ? tabGroups[tabGroupId]?.color : null);

        lastGroupId = tabGroupId;
    });

    listEl.innerHTML = html;
    attachTabClickListeners();
    initializeSortable();
}

// Render tabs in flat list
function renderFlatTabs(tabs) {
    const listEl = document.getElementById('tabsList');
    listEl.innerHTML = tabs.map(tab => renderTabItem(tab)).join('');
    attachTabClickListeners();
}

// Check if a tab is a special tab (extension, new tab, chrome:// etc.)
function isSpecialTab(tab) {
    if (!tab.url) return true;
    const url = tab.url.toLowerCase();
    return url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://') ||
        url === 'chrome://newtab/';
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
        // Check if tab is protected (explicit, media, pinned, or special with setting disabled)
        const isPinnedProtected = tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state.hasMedia && settings.pauseOnMedia;

        if (state.protected || isMediaProtected || isPinnedProtected || isSpecialProtected) {
            // Tab is protected - show shield with label (vertical stack)
            let label = 'Protected';
            if (isSpecialProtected) label = 'Special';
            else if (isPinnedProtected) label = 'Pinned';
            else if (isMediaProtected) label = 'Media';
            countdown = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg><span>' + label + '</span>';
            countdownLabel = '';
            countdownClass = 'protected';
        } else {
            // Regular countdown - time with LEFT label
            countdown = '<span class="time-value">' + formatTime(state.countdown) + '</span><span>Left</span>';
            countdownLabel = '';
            if (state.countdown > 180) countdownClass = 'high';
            else if (state.countdown > 60) countdownClass = 'medium';
            else countdownClass = 'low';
        }
    }

    const badges = [];
    // Protected/Media status is shown via shield icon in countdown, no badge needed
    if (tab.pinned) {
        badges.push('<span class="badge badge-pinned">Pinned</span>');
    }
    // Removed audible badge since media status is shown in countdown area

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

        // Right-click on tab item - show context menu
        item.addEventListener('contextmenu', (e) => {
            showContextMenu(e.clientX, e.clientY, 'tab', tabId, e);
        });

        // Sortable.js will handle drag and drop now
    });

    // Attach close button handlers
    document.querySelectorAll('.tab-close-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const tabId = parseInt(btn.dataset.tabId);
            await closeTab(tabId);
        });
    });

    // Attach context menu to group headers
    document.querySelectorAll('.group-header-row').forEach(header => {
        const groupId = parseInt(header.dataset.groupId);
        if (groupId) {
            header.addEventListener('contextmenu', (e) => {
                showContextMenu(e.clientX, e.clientY, 'group', groupId, e);
            });
        }
    });

    // Attach context menu to window headers
    document.querySelectorAll('.window-header-row').forEach(header => {
        const windowId = parseInt(header.dataset.windowId);
        if (windowId) {
            header.addEventListener('contextmenu', (e) => {
                showContextMenu(e.clientX, e.clientY, 'window', windowId, e);
            });
        }
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

        // Populate window dropdown with active tab titles
        const windowSelect = document.getElementById('moveToWindowSelect');
        const windowIds = [...new Set(allTabs.map(t => t.windowId))];
        windowSelect.innerHTML = '<option value="">Window...</option>';

        windowIds.forEach(wId => {
            // Find active tab in this window
            const windowTabs = allTabs.filter(t => t.windowId === wId);
            const activeTab = windowTabs.find(t => t.active) || windowTabs[0];
            const activeTitle = activeTab?.title || 'Window';

            // Truncate title for display
            const displayTitle = activeTitle.length > 25 ? activeTitle.substring(0, 25) + '…' : activeTitle;

            // Create tooltip with all tab titles (truncated)
            const allTitles = windowTabs.map(t => {
                const title = t.title || 'Untitled';
                return title.length > 30 ? title.substring(0, 30) + '...' : title;
            }).join('\n• ');
            const tooltip = `${windowTabs.length} tabs:\n• ${allTitles}`;

            const option = document.createElement('option');
            option.value = wId;
            option.textContent = displayTitle;
            option.title = tooltip;
            windowSelect.appendChild(option);
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
        // Use new message handler to close tab with history tracking
        await chrome.runtime.sendMessage({
            type: 'closeTabWithHistory',
            tabId: tabId,
            isBatch: false
        });
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
        // Close each tab with history tracking
        for (const tabId of tabIds) {
            await chrome.runtime.sendMessage({
                type: 'closeTabWithHistory',
                tabId: tabId,
                isBatch: true
            });
        }
        // Remove from allTabs array
        allTabs = allTabs.filter(t => !tabIds.includes(t.id));
        clearSelection();
        renderTabsList();
    } catch (err) {
        console.error('Failed to close tabs:', err);
    }
}


// Initialize Sortable.js for drag-and-drop
let sortableInstance = null;

function initializeSortable() {
    const tabsList = document.getElementById('tabsList');
    if (!tabsList) return;

    // Destroy previous instance if exists
    if (sortableInstance) {
        sortableInstance.destroy();
    }

    // Initialize Sortable on the main tabs list
    sortableInstance = new Sortable(tabsList, {
        animation: 200,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.tab-item, .group-header-row',  // Allow dragging tabs AND Chrome tab group headers (NOT window headers)
        draggable: '.tab-row', // The row is what moves
        filter: '.window-header-row', // Exclude window headers from dragging
        // Smooth animations
        forceFallback: false,

        // Called when dragging starts
        onStart: function (evt) {
            const tabsList = document.getElementById('tabsList');
            if (tabsList) tabsList.classList.add('dragging-active');

            // If dragging a group header, hide all tabs in that group
            const draggedRow = evt.item;
            if (draggedRow.classList.contains('group-header-row')) {
                const groupId = parseInt(draggedRow.dataset.groupId);
                const allRows = Array.from(tabsList.querySelectorAll('.tab-row'));

                allRows.forEach(row => {
                    const item = row.querySelector('.tab-item');
                    if (item && parseInt(item.dataset.groupId) === groupId) {
                        row.classList.add('hidden-by-group-drag');
                    }
                });
            }
        },

        // Called when dragging ends (drop or cancel)
        onEnd: async function (evt) {
            const tabsList = document.getElementById('tabsList');
            if (tabsList) tabsList.classList.remove('dragging-active');

            // Show any hidden group tabs
            document.querySelectorAll('.hidden-by-group-drag').forEach(el => {
                el.classList.remove('hidden-by-group-drag');
            });

            // If position didn't change, do nothing
            if (evt.oldIndex === evt.newIndex) return;

            const draggedRow = evt.item;

            // HANDLE GROUP MOVE
            if (draggedRow.classList.contains('group-header-row')) {
                const draggedGroupId = parseInt(draggedRow.dataset.groupId);

                // Calculate new index
                // We need the index of the tab immediately following the dropped header
                // ignoring the tabs of the moved group (since they move with it)
                const allRows = Array.from(tabsList.querySelectorAll('.tab-row'));
                const newIndex = allRows.indexOf(draggedRow);

                // Check if dropped onto another group (either header or tabs)
                let targetGroupId = null;
                let shouldMerge = false;

                // Check the row immediately before the dropped position
                if (newIndex > 0) {
                    const previousRow = allRows[newIndex - 1];
                    if (previousRow.classList.contains('group-header-row')) {
                        // Dropped right after another group's header - merge into that group
                        targetGroupId = parseInt(previousRow.dataset.groupId);
                        shouldMerge = true;
                    } else {
                        // Check if previous row is a tab in a group
                        const previousItem = previousRow.querySelector('.tab-item');
                        if (previousItem) {
                            const previousGroupId = parseInt(previousItem.dataset.groupId || -1);
                            // If previous tab is in a group (and not the same group being dragged)
                            if (previousGroupId && previousGroupId !== -1 &&
                                previousGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
                                previousGroupId !== draggedGroupId) {

                                // Check if next row is also in the same group (to ensure we're inside, not at the end)
                                const nextRow = allRows[newIndex + 1];
                                if (nextRow && !nextRow.classList.contains('group-header-row')) {
                                    const nextItem = nextRow.querySelector('.tab-item');
                                    if (nextItem) {
                                        const nextGroupId = parseInt(nextItem.dataset.groupId || -1);
                                        // Only merge if next tab is also in the same group (we're inside the group)
                                        if (nextGroupId === previousGroupId) {
                                            targetGroupId = previousGroupId;
                                            shouldMerge = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // If we should merge groups
                if (shouldMerge && targetGroupId) {
                    try {
                        console.log('Merging group', draggedGroupId, 'into group', targetGroupId);

                        // Get all tabs from the dragged group
                        const draggedGroupTabs = allTabs.filter(t => t.groupId === draggedGroupId);
                        const draggedTabIds = draggedGroupTabs.map(t => t.id);

                        // Move all tabs from dragged group to target group
                        if (draggedTabIds.length > 0) {
                            await chrome.tabs.group({
                                tabIds: draggedTabIds,
                                groupId: targetGroupId
                            });
                            console.log('Successfully merged', draggedTabIds.length, 'tabs from group', draggedGroupId, 'into group', targetGroupId);
                        }

                        await loadAllTabs();
                    } catch (error) {
                        console.error('Error merging groups:', error);
                        await loadAllTabs();
                    }
                    return;
                }

                // Otherwise, handle normal group reordering
                // Use the same window-aware position calculation as single tabs

                // Get all tabs from the dragged group
                const draggedGroupTabs = allTabs.filter(t => t.groupId === draggedGroupId);
                const draggedGroupTabIds = new Set(draggedGroupTabs.map(t => t.id));

                // Determine target window for the group
                let targetWindowId = draggedGroupTabs[0]?.windowId; // Groups always stay in same window

                // In window mode, verify which window the group was dropped into
                if (groupByWindow) {
                    const windowGroupContainer = draggedRow.closest('.window-group');
                    if (windowGroupContainer) {
                        const windowHeader = windowGroupContainer.querySelector('.window-group-header');
                        if (windowHeader) {
                            const headerText = windowHeader.textContent;
                            const match = headerText.match(/Window (\d+)/);
                            if (match) {
                                targetWindowId = parseInt(match[1]);
                            }
                        }
                    }
                }

                // Build list of all tab items with their window and group info, excluding tabs in the dragged group
                const allTabItemsExcludingGroup = allRows
                    .filter(row => !row.classList.contains('group-header-row'))
                    .map(row => {
                        const item = row.querySelector('.tab-item');
                        if (!item) return null;
                        const tabId = parseInt(item.dataset.tabId);
                        // Skip tabs that are part of the dragged group
                        if (draggedGroupTabIds.has(tabId)) return null;
                        return {
                            id: tabId,
                            windowId: parseInt(item.dataset.windowId),
                            groupId: parseInt(item.dataset.groupId || -1)
                        };
                    })
                    .filter(t => t !== null);

                // Count tabs in the target window that appear before the dragged group header in DOM
                let targetIndex = 0;
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];

                    // Stop when we reach the dragged group header
                    if (row === draggedRow) {
                        break;
                    }

                    // Skip group headers
                    if (row.classList.contains('group-header-row')) {
                        continue;
                    }

                    // Count tabs in the target window (excluding tabs from the dragged group)
                    const item = row.querySelector('.tab-item');
                    if (item) {
                        const tabId = parseInt(item.dataset.tabId);
                        const tabWindowId = parseInt(item.dataset.windowId);

                        // Only count if in target window and not part of dragged group
                        if (tabWindowId === targetWindowId && !draggedGroupTabIds.has(tabId)) {
                            targetIndex++;
                        }
                    }
                }

                try {
                    console.log('Moving group', draggedGroupId, 'to index', targetIndex, 'in window', targetWindowId);
                    await chrome.tabGroups.move(draggedGroupId, { index: targetIndex });
                    await loadAllTabs();
                } catch (error) {
                    console.error('Error moving group:', error);
                    await loadAllTabs();
                }
                return;
            }

            // HANDLE SINGLE TAB MOVE
            const draggedItem = draggedRow.querySelector('.tab-item');
            if (!draggedItem) return;

            const draggedTabId = parseInt(draggedItem.dataset.tabId);

            // Get all tab rows in their new order
            const allRows = Array.from(tabsList.querySelectorAll('.tab-row'));
            const newIndex = allRows.indexOf(draggedRow);

            // Determine if tab should be added to a group
            // Only add to group if dropped IMMEDIATELY after a group header
            let targetGroupId = null;
            let shouldAddToGroup = false;
            let shouldUngroup = false;

            // Check the row immediately before the dropped position
            if (newIndex > 0) {
                const previousRow = allRows[newIndex - 1];
                if (previousRow.classList.contains('group-header-row')) {
                    // Dropped right after a group header - add to that group
                    targetGroupId = parseInt(previousRow.dataset.groupId);
                    shouldAddToGroup = true;
                } else {
                    // Dropped after a regular tab - check if we should ungroup
                    const previousItem = previousRow.querySelector('.tab-item');
                    if (previousItem) {
                        const previousGroupId = parseInt(previousItem.dataset.groupId || -1);
                        // If previous tab is ungrouped, ungroup this tab too
                        if (!previousGroupId || previousGroupId === -1 || previousGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                            shouldUngroup = true;
                        } else {
                            // Previous tab is grouped
                            // Check if the dragged tab is ALREADY in this same group
                            const draggedGroupId = parseInt(draggedItem.dataset.groupId || -1);

                            if (draggedGroupId === previousGroupId) {
                                // Dragged tab is already in this group - keep it in the group (reordering within group)
                                targetGroupId = previousGroupId;
                                shouldAddToGroup = true;
                            } else {
                                // Dragged tab is from a different group - check if we're at the boundary
                                // Look at the next row to see if it's also in the same group
                                const nextRow = allRows[newIndex + 1];
                                if (nextRow && !nextRow.classList.contains('group-header-row')) {
                                    const nextItem = nextRow.querySelector('.tab-item');
                                    if (nextItem) {
                                        const nextGroupId = parseInt(nextItem.dataset.groupId || -1);
                                        if (nextGroupId === previousGroupId) {
                                            // Next tab is also in the same group - we're in the middle
                                            targetGroupId = previousGroupId;
                                            shouldAddToGroup = true;
                                        } else {
                                            // Next tab is NOT in the same group - we're after the group
                                            shouldUngroup = true;
                                        }
                                    } else {
                                        shouldUngroup = true;
                                    }
                                } else {
                                    // Next row is a group header or doesn't exist - we're after the group
                                    shouldUngroup = true;
                                }
                            }
                        }
                    }
                }
            } else {
                // Dropped at the very top - ungroup
                shouldUngroup = true;
            }

            // Get the actual Chrome tab indices
            const allTabItems = allRows
                .filter(row => !row.classList.contains('group-header-row') && !row.classList.contains('window-header-row'))
                .map(row => {
                    const item = row.querySelector('.tab-item');
                    return item ? {
                        id: parseInt(item.dataset.tabId),
                        windowId: parseInt(item.dataset.windowId),
                        groupId: parseInt(item.dataset.groupId || -1)
                    } : null;
                }).filter(t => t !== null);

            const draggedTab = allTabs.find(t => t.id === draggedTabId);
            if (!draggedTab) {
                console.error('Could not find dragged tab');
                await loadAllTabs();
                return;
            }

            // Calculate the correct Chrome index (excluding group headers and window headers)
            const tabsOnly = allRows.filter(row => !row.classList.contains('group-header-row') && !row.classList.contains('window-header-row'));
            const positionInTabsOnly = tabsOnly.indexOf(draggedRow);

            // Determine target window by checking which window section the tab is in
            let targetWindowId = draggedTab.windowId; // Default to same window
            let isCrossWindowMove = false;

            // In window mode, find the nearest window header above the dragged row
            if (groupByWindow) {
                const allRowsArray = Array.from(allRows);
                const draggedRowIndex = allRowsArray.indexOf(draggedRow);

                // Look backwards from the dragged row to find the nearest window header
                for (let i = draggedRowIndex - 1; i >= 0; i--) {
                    const row = allRowsArray[i];
                    if (row.classList.contains('window-header-row')) {
                        const detectedWindowId = parseInt(row.dataset.windowId);
                        if (detectedWindowId !== draggedTab.windowId) {
                            targetWindowId = detectedWindowId;
                            isCrossWindowMove = true;
                        } else {
                            targetWindowId = detectedWindowId;
                        }
                        break;
                    }
                }
            }
            // NOTE: When NOT in window mode (flat view), tabs should NEVER move across windows
            // They should always stay in their original window during reordering
            // So we don't check neighboring tabs - just keep targetWindowId = draggedTab.windowId

            // Calculate position within the TARGET window (not source window)
            const targetWindowTabs = allTabItems.filter(t => t.windowId === targetWindowId);

            // Find position within target window's tabs by counting tabs in target window that appear before the dragged tab
            let positionInTargetWindow = 0;
            for (let i = 0; i < allTabItems.length; i++) {
                if (allTabItems[i].id === draggedTabId) {
                    // Found the dragged tab, stop counting
                    break;
                }
                // Only count tabs that are in the target window
                if (allTabItems[i].windowId === targetWindowId) {
                    positionInTargetWindow++;
                }
            }

            // For same-window moves, Chrome removes the tab first before inserting
            // So if we're moving down within the same window, the position is already correct
            // If moving up, the position is also correct because we stopped counting before finding the dragged tab
            // No adjustment needed!

            try {
                // Move the tab in Chrome
                // Always include windowId when in window mode to prevent cross-window moves
                const moveOptions = (isCrossWindowMove || groupByWindow)
                    ? { windowId: targetWindowId, index: positionInTargetWindow }
                    : { index: positionInTargetWindow };

                await chrome.tabs.move(draggedTabId, moveOptions);

                console.log('Moved tab', draggedTabId, 'to', isCrossWindowMove ? `window ${targetWindowId},` : '', 'index', positionInTargetWindow);

                // Add to group if needed
                if (shouldAddToGroup && targetGroupId) {
                    await chrome.tabs.group({
                        tabIds: [draggedTabId],
                        groupId: targetGroupId
                    });
                    console.log('Added tab', draggedTabId, 'to group', targetGroupId);
                } else if (shouldUngroup || (!shouldAddToGroup && draggedTab.groupId && draggedTab.groupId !== -1)) {
                    // If should ungroup OR moving to an ungrouped area, ungroup it
                    await chrome.tabs.ungroup([draggedTabId]);
                    console.log('Ungrouped tab', draggedTabId);
                }

                // Clean up empty source window if cross-window move
                if (isCrossWindowMove) {
                    await cleanupEmptyWindow(draggedTab.windowId);
                }

                // Reload to reflect actual state
                await loadAllTabs();
            } catch (error) {
                console.error('Error moving tab:', error);
                await loadAllTabs(); // Reload to fix UI
            }
        }
    });
}

// Modified moveTab function to accept dropAfter parameter
async function moveTab(draggedTabId, targetTabId, targetWindowId, dropAfter = false) {
    try {
        const draggedTab = allTabs.find(t => t.id === draggedTabId);
        const targetTab = allTabs.find(t => t.id === targetTabId);

        if (!draggedTab || !targetTab) {
            console.error('Could not find dragged or target tab', { draggedTabId, targetTabId });
            return;
        }

        const draggedWindowId = draggedTab.windowId;
        const sameWindow = draggedWindowId === targetWindowId;

        console.log('Moving tab:', {
            draggedTabId,
            targetTabId,
            draggedIndex: draggedTab.index,
            targetIndex: targetTab.index,
            dropAfter,
            sameWindow
        });

        if (sameWindow) {
            // Reorder within same window
            let newIndex = targetTab.index;

            // Calculate the correct index based on current positions
            if (draggedTab.index < targetTab.index) {
                // Moving down: if dropAfter, use target index, otherwise target index - 1
                newIndex = dropAfter ? targetTab.index : targetTab.index - 1;
            } else {
                // Moving up: if dropAfter, use target index + 1, otherwise target index
                newIndex = dropAfter ? targetTab.index + 1 : targetTab.index;
            }

            console.log('Calculated new index:', newIndex);
            await chrome.tabs.move(draggedTabId, { index: newIndex });
        } else {
            // Move to different window
            let targetIndex = targetTab.index;
            if (dropAfter) targetIndex++;

            console.log('Moving to different window, index:', targetIndex);
            await chrome.tabs.move(draggedTabId, {
                windowId: targetWindowId,
                index: targetIndex
            });

            // Check if source window is now empty and close it
            await cleanupEmptyWindow(draggedWindowId);
        }

        // Reload tabs list with smooth transition
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

// Batch protect/unprotect selected tabs
async function batchProtect(protect) {
    const checkboxes = document.querySelectorAll('.tab-checkbox-outer:checked');
    const tabIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.tabId));

    if (tabIds.length === 0) return;

    // Send protect/unprotect message for each tab
    for (const tabId of tabIds) {
        const messageType = protect ? 'protectTab' : 'unprotectTab';
        await chrome.runtime.sendMessage({ type: messageType, tabId });
    }

    // Wait for background to reinitialize states (especially important for unprotect)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Refresh states and UI
    await refreshTabStates();
    renderTabsList();
    clearSelection();
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
        const tab = allTabs.find(t => t.id === tabId);

        if (!state || state.countdown === null) return;

        // Check if tab is protected (explicit, media, pinned, or special with setting disabled)
        const isPinnedProtected = tab && tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = tab && isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state.hasMedia && settings.pauseOnMedia;

        if (state.protected || isMediaProtected || isPinnedProtected || isSpecialProtected) {
            // Protected - show shield icon with label
            let label = 'Protected';
            if (isSpecialProtected) label = 'Special';
            else if (isPinnedProtected) label = 'Pinned';
            else if (isMediaProtected) label = 'Media';
            timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg><span>' + label + '</span>';
            countdownEl.className = 'countdown protected';
            return;
        }

        // Calculate current countdown based on background's tracking
        let remaining;
        if (state.lastActiveTime === null) {
            // Tab is active - show eye icon with Active text (vertical stack)
            timeEl.innerHTML = '<svg width="14" height="14" class="active-icon"><use href="#icon-eye"/></svg><span>Active</span>';
            countdownEl.className = 'countdown active';
            return;
        } else {
            // Tab is inactive - calculate elapsed time
            const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
            remaining = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
        }

        timeEl.innerHTML = '<span class="time-value">' + formatTime(remaining) + '</span><span>Left</span>';

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
    const compactTabInfo = document.getElementById('compactTabInfo');

    if (toggleCurrentTabBtn && currentTabContent) {
        // Default state: expanded (active)
        toggleCurrentTabBtn.classList.add('active');

        toggleCurrentTabBtn.addEventListener('click', () => {
            const isCollapsed = currentTabContent.classList.toggle('collapsed');
            toggleCurrentTabBtn.classList.toggle('active', !isCollapsed);

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

    // Quit All button - close all countdown tabs (exclude protected, active, pinned)
    const quitAllBtn = document.getElementById('quitAllBtn');
    let quitConfirmMode = false;

    quitAllBtn.addEventListener('click', async () => {
        if (!quitConfirmMode) {
            // First click - enter confirm mode
            quitConfirmMode = true;
            quitAllBtn.textContent = 'Confirm';
            protectBtn.innerHTML = 'Cancel';
            protectBtn.classList.add('btn-cancel');
            // Swap positions to prevent accidental double-click
            protectBtn.style.order = '2';
            quitAllBtn.style.order = '1';
            return;
        }

        // Second click - execute quit all
        const tabsToClose = [];

        for (const tab of allTabs) {
            // Skip current active tab
            if (tab.active && tab.windowId === currentTab?.windowId) continue;

            const state = tabStates[tab.id];
            if (!state) continue;

            // Skip protected tabs
            if (state.protected) continue;

            // Skip pinned tabs if setting is disabled
            if (tab.pinned && !settings.autoClosePinned) continue;

            // Skip media playing tabs if setting is enabled
            if (state.hasMedia && settings.pauseOnMedia) continue;

            // Skip tabs without countdown
            if (state.countdown === null) continue;

            tabsToClose.push(tab.id);
        }

        if (tabsToClose.length > 0) {
            // Close each tab with history tracking
            for (const tabId of tabsToClose) {
                await chrome.runtime.sendMessage({
                    type: 'closeTabWithHistory',
                    tabId: tabId,
                    isBatch: true  // This will mark as 'batch_close' in history
                });
            }
            await loadAllTabs();
        }

        // Reset confirm mode
        resetQuitConfirmMode();
    });

    // Cancel quit all when clicking protect button in confirm mode
    protectBtn.addEventListener('click', async (e) => {
        if (quitConfirmMode) {
            e.stopImmediatePropagation();
            resetQuitConfirmMode();
            return;
        }
    }, true);

    function resetQuitConfirmMode() {
        quitConfirmMode = false;
        quitAllBtn.textContent = 'Quit All';
        // Restore protected button HTML with icon
        protectBtn.innerHTML = '<svg width="14" height="14" id="protectIcon"><use href="#icon-shield" /></svg> Protected';
        protectBtn.classList.remove('btn-cancel');
        // Reset positions
        protectBtn.style.order = '';
        quitAllBtn.style.order = '';
        updateProtectButton();
    }

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

    // Batch action dropdown (protect, unprotect, ungroup, close)
    document.getElementById('batchActionSelect').addEventListener('change', async (e) => {
        const action = e.target.value;
        if (!action) return;

        if (action === 'protect') {
            await batchProtect(true);
        } else if (action === 'unprotect') {
            await batchProtect(false);
        } else if (action === 'ungroup') {
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

    // History button
    document.getElementById('historyBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
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
    targetWindowId: null,
    type: null // 'tab', 'group', or 'window'
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
        targetWindowId: type === 'window' ? targetId : null,
        type
    };

    // Build menu items based on type
    if (type === 'tab') {
        const tab = allTabs.find(t => t.id === targetId);
        menuItems.innerHTML = buildTabContextMenu(tab);
    } else if (type === 'group') {
        menuItems.innerHTML = buildGroupContextMenu(targetId);
    } else if (type === 'window') {
        menuItems.innerHTML = buildWindowContextMenu(targetId);
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
        ` : `
            <div class="context-menu-item" data-action="createNewGroup">
                Create New Group
            </div>
        `}
        <div class="context-menu-divider"></div>
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
        <div class="context-menu-item" data-action="moveToNewWindow">
            Move to New Window
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="duplicateTab">
            Duplicate Tab
        </div>
        <div class="context-menu-item" data-action="togglePin">
            ${tab.pinned ? 'Unpin Tab' : 'Pin Tab'}
        </div>
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

    const groupTabs = allTabs.filter(t => t.groupId === groupId);
    const currentWindowId = groupTabs[0]?.windowId;
    const windows = [...new Set(allTabs.map(t => t.windowId))]
        .filter(wId => wId !== currentWindowId)
        .map(wId => `
            <div class="context-menu-item" data-action="moveGroupToWindow" data-window-id="${wId}">
                🪟 Window ${wId}
            </div>
        `).join('');

    const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const colorOptions = colors.map(color => `
        <div class="context-menu-item" data-action="changeGroupColor" data-color="${color}">
            <span class="group-indicator-tiny" style="background-color: var(--group-${color});"></span>
            ${color.charAt(0).toUpperCase() + color.slice(1)}
        </div>
    `).join('');

    return `
        <div class="context-menu-item" data-action="renameGroup">
            Rename Group
        </div>
        <div class="context-menu-item has-submenu">
            Change Color
            <div class="context-submenu">
                ${colorOptions}
            </div>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="ungroupAll">
            Ungroup All
        </div>
        ${otherGroups ? `
            <div class="context-menu-item has-submenu">
                Merge to Group
                <div class="context-submenu">
                    ${otherGroups}
                </div>
            </div>
        ` : ''}
        <div class="context-menu-divider"></div>
        ${windows ? `
            <div class="context-menu-item has-submenu">
                Move Group to Window
                <div class="context-submenu">
                    ${windows}
                </div>
            </div>
        ` : ''}
        <div class="context-menu-item" data-action="moveGroupToNewWindow">
            Move Group to New Window
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="closeAllInGroup">
            Close All in Group
        </div>
    `;
}

// Build window context menu
function buildWindowContextMenu(windowId) {
    const otherWindows = [...new Set(allTabs.map(t => t.windowId))]
        .filter(wId => wId !== windowId)
        .map(wId => `
            <div class="context-menu-item" data-action="moveWindowToWindow" data-target-window-id="${wId}">
                🪟 Window ${wId}
            </div>
        `).join('');

    return `
        ${otherWindows ? `
            <div class="context-menu-item has-submenu">
                Move All Tabs to Window
                <div class="context-submenu">
                    ${otherWindows}
                </div>
            </div>
        ` : ''}
        <div class="context-menu-item" data-action="closeAllInWindow">
            Close All Tabs
        </div>
    `;
}

// Attach context menu action handlers
function attachContextMenuHandlers() {
    document.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = item.dataset.action;

            switch (action) {
                // Tab actions
                case 'removeFromGroup':
                    await removeTabFromGroup(contextMenuState.targetTabId);
                    break;
                case 'moveToGroup':
                    await moveTabToGroup(contextMenuState.targetTabId, parseInt(item.dataset.groupId));
                    break;
                case 'moveToWindow':
                    await moveTabToWindow(contextMenuState.targetTabId, parseInt(item.dataset.windowId));
                    break;
                case 'createNewGroup':
                    await createNewGroupWithTab(contextMenuState.targetTabId);
                    break;
                case 'moveToNewWindow':
                    await moveTabToNewWindow(contextMenuState.targetTabId);
                    break;
                case 'duplicateTab':
                    await duplicateTab(contextMenuState.targetTabId);
                    break;
                case 'togglePin':
                    await togglePinTab(contextMenuState.targetTabId);
                    break;

                // Group actions
                case 'ungroupAll':
                    await ungroupAllInGroup(contextMenuState.targetGroupId);
                    break;
                case 'moveAllToGroup':
                    await moveAllTabsInGroup(contextMenuState.targetGroupId, parseInt(item.dataset.groupId));
                    break;
                case 'renameGroup':
                    await renameGroupPrompt(contextMenuState.targetGroupId);
                    break;
                case 'changeGroupColor':
                    await changeGroupColor(contextMenuState.targetGroupId, item.dataset.color);
                    break;
                case 'closeAllInGroup':
                    await closeAllTabsInGroup(contextMenuState.targetGroupId);
                    break;
                case 'moveGroupToWindow':
                    await moveGroupToWindow(contextMenuState.targetGroupId, parseInt(item.dataset.windowId));
                    break;
                case 'moveGroupToNewWindow':
                    await moveGroupToNewWindow(contextMenuState.targetGroupId);
                    break;

                // Window actions
                case 'moveWindowToWindow':
                    await moveAllTabsToWindow(contextMenuState.targetWindowId, parseInt(item.dataset.targetWindowId));
                    break;
                case 'closeAllInWindow':
                    await closeAllTabsInWindow(contextMenuState.targetWindowId);
                    break;
            }

            hideContextMenu();
            await loadAllTabs();
        });
    });
}

// ============================================================================
// Helper Functions for Context Menu Actions
// ============================================================================

// Create a new group with a single tab
async function createNewGroupWithTab(tabId) {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    await chrome.tabGroups.update(groupId, {
        title: `Group ${Object.keys(tabGroups).length + 1}`,
        color: randomColor
    });
}

// Move tab to a new window
async function moveTabToNewWindow(tabId) {
    await chrome.windows.create({ tabId: tabId });
}

// Duplicate a tab
async function duplicateTab(tabId) {
    await chrome.tabs.duplicate(tabId);
}

// Toggle pin status of a tab
async function togglePinTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { pinned: !tab.pinned });
}

// Rename group with prompt
async function renameGroupPrompt(groupId) {
    const groupInfo = tabGroups[groupId];
    const currentName = groupInfo?.title || 'Unnamed Group';
    const newName = prompt('Enter new group name:', currentName);
    if (newName && newName.trim() !== '') {
        await chrome.tabGroups.update(groupId, { title: newName.trim() });
    }
}

// Change group color
async function changeGroupColor(groupId, color) {
    await chrome.tabGroups.update(groupId, { color: color });
}

// Close all tabs in a group
async function closeAllTabsInGroup(groupId) {
    const tabsInGroup = allTabs.filter(t => t.groupId === groupId);
    const tabIds = tabsInGroup.map(t => t.id);
    if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
    }
}

// Duplicate a group
async function duplicateGroup(groupId) {
    const groupInfo = tabGroups[groupId];
    const tabsInGroup = allTabs.filter(t => t.groupId === groupId).sort((a, b) => a.index - b.index);

    if (tabsInGroup.length === 0) return;

    // Duplicate all tabs in the group
    const newTabIds = [];
    for (const tab of tabsInGroup) {
        const newTab = await chrome.tabs.duplicate(tab.id);
        newTabIds.push(newTab.id);
    }

    // Create a new group with the duplicated tabs
    const newGroupId = await chrome.tabs.group({ tabIds: newTabIds });
    await chrome.tabGroups.update(newGroupId, {
        title: `${groupInfo?.title || 'Group'} (Copy)`,
        color: groupInfo?.color || 'grey'
    });
}

// Move entire group to another window
async function moveGroupToWindow(groupId, windowId) {
    const tabsInGroup = allTabs.filter(t => t.groupId === groupId).sort((a, b) => a.index - b.index);
    if (tabsInGroup.length === 0) return;

    const groupInfo = tabGroups[groupId];
    const tabIds = tabsInGroup.map(t => t.id);

    // Move all tabs to the target window
    await chrome.tabs.move(tabIds, { windowId: windowId, index: -1 });

    // Recreate the group in the new window
    const newGroupId = await chrome.tabs.group({ tabIds: tabIds });
    await chrome.tabGroups.update(newGroupId, {
        title: groupInfo?.title || 'Moved Group',
        color: groupInfo?.color || 'grey'
    });
}

// Move entire group to a new window
async function moveGroupToNewWindow(groupId) {
    const tabsInGroup = allTabs.filter(t => t.groupId === groupId).sort((a, b) => a.index - b.index);
    if (tabsInGroup.length === 0) return;

    const groupInfo = tabGroups[groupId];
    const tabIds = tabsInGroup.map(t => t.id);

    // First, ungroup all tabs (Chrome automatically ungroups when moving to new window)
    await chrome.tabs.ungroup(tabIds);

    // Create new window with the first tab
    const firstTabId = tabsInGroup[0].id;
    const newWindow = await chrome.windows.create({ tabId: firstTabId });

    // Move remaining tabs to the new window
    if (tabsInGroup.length > 1) {
        const remainingTabIds = tabsInGroup.slice(1).map(t => t.id);
        await chrome.tabs.move(remainingTabIds, { windowId: newWindow.id, index: -1 });
    }

    // Give Chrome a moment to settle
    await new Promise(resolve => setTimeout(resolve, 100));

    // Recreate the group in the new window
    const newGroupId = await chrome.tabs.group({ tabIds: tabIds });
    await chrome.tabGroups.update(newGroupId, {
        title: groupInfo?.title || 'Moved Group',
        color: groupInfo?.color || 'grey'
    });
}

// Move all tabs from one window to another and create a group
async function moveAllTabsToWindow(sourceWindowId, targetWindowId) {
    const tabsToMove = allTabs.filter(t => t.windowId === sourceWindowId).sort((a, b) => a.index - b.index);
    if (tabsToMove.length === 0) return;

    const tabIds = tabsToMove.map(t => t.id);

    // Move all tabs to the target window
    await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });

    // Create a new group with all the moved tabs
    const newGroupId = await chrome.tabs.group({ tabIds: tabIds });
    const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    await chrome.tabGroups.update(newGroupId, {
        title: `From Window ${sourceWindowId}`,
        color: randomColor
    });
}

// Close all tabs in a window
async function closeAllTabsInWindow(windowId) {
    const tabsToClose = allTabs.filter(t => t.windowId === windowId);
    const tabIds = tabsToClose.map(t => t.id);
    if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
    }
}

// ============================================================================


// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
