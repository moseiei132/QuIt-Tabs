/**
 * Tabs Module
 * Tab loading, rendering, and list management
 */

import {
    currentTab, allTabs, tabGroups, tabStates, settings,
    groupByWindow, searchQuery, quitConfirmMode, editMode,
    selectedTabIds, addSelectedTabId, deleteSelectedTabId,
    setAllTabs, setTabGroups
} from './state.js';
import { escapeHtml, formatTime, isSpecialTab } from './utils.js';
import { initializeSortable } from './dragDrop.js';
import { showContextMenu } from './contextMenu.js';
import { updateBatchActionsBar } from './batchActions.js';
import { closeTab, focusTab } from './batchActions.js';

// ============================================================================
// Tab Loading
// ============================================================================

/**
 * Load all tabs and groups from Chrome
 */
export async function loadAllTabs() {
    try {
        const tabs = await chrome.tabs.query({});
        setAllTabs(tabs);

        // Load tab groups
        const groups = await chrome.tabGroups.query({});
        const groupsObj = {};
        groups.forEach(group => {
            groupsObj[group.id] = {
                title: group.title || 'Untitled',
                color: group.color,
                collapsed: group.collapsed,
                shared: Boolean(group.shared)
            };
        });
        setTabGroups(groupsObj);

        renderTabsList();
    } catch (error) {
        console.error('Error loading tabs:', error);
    }
}

// ============================================================================
// Tab List Rendering
// ============================================================================

const SPLIT_VIEW_NONE = chrome.tabs?.SPLIT_VIEW_ID_NONE ?? -1;

function hasSplitView(tab) {
    return tab?.splitViewId !== undefined && tab.splitViewId !== SPLIT_VIEW_NONE;
}

function getTabStatusKey(tab) {
    if (!settings.enabled) return 'disabled';
    const state = tabStates[tab.id];
    if (!state) return 'none';

    const isPinnedProtected = tab.pinned && !settings.autoClosePinned;
    const isSpecialProtected = isSpecialTab(tab) && !settings.autoCloseSpecial;
    const isMediaProtected = state.hasMedia && settings.pauseOnMedia;
    const isSharedGroupProtected = Boolean(
        settings.protectSharedGroups && tab.groupId !== -1 && tabGroups[tab.groupId]?.shared
    );
    const isSleeping = Boolean(tab.discarded || tab.frozen);

    const tabTimeoutAction = state.timeoutAction || settings.timeoutAction || 'close';

    if (state.protected) return 'protected:manual';
    if (isSpecialProtected) return 'protected:special';
    if (isPinnedProtected) return 'protected:pinned';
    if (isSharedGroupProtected) return 'protected:shared';
    if (isMediaProtected) return 'protected:media';
    if (tabTimeoutAction === 'discard' && isSleeping) return 'sleeping';
    if (state.lastActiveTime === null) return 'active';

    const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
    const remaining = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
    // Group countdowns within 2 seconds as identical (Split View tabs leave at the same instant)
    return `countdown:${tabTimeoutAction}:${Math.round(remaining / 2)}`;
}

function getSplitMeta(tab, list, idx) {
    if (!hasSplitView(tab)) return null;
    const prevTab = idx > 0 ? list[idx - 1] : null;
    const nextTab = idx < list.length - 1 ? list[idx + 1] : null;
    const prevSame = Boolean(prevTab && hasSplitView(prevTab) &&
        prevTab.windowId === tab.windowId &&
        prevTab.splitViewId === tab.splitViewId);
    const nextSame = Boolean(nextTab && hasSplitView(nextTab) &&
        nextTab.windowId === tab.windowId &&
        nextTab.splitViewId === tab.splitViewId);

    let position = 'single';
    if (prevSame && nextSame) position = 'middle';
    else if (nextSame) position = 'start';
    else if (prevSame) position = 'end';

    return {
        position,
        partnerTabId: prevSame ? prevTab.id : null,
        sameStatusAsPrev: prevSame && getTabStatusKey(tab) === getTabStatusKey(prevTab)
    };
}

/**
 * Render the tabs list based on current filters and grouping
 */
export function renderTabsList() {
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

/**
 * Render tabs grouped by window (maintaining real tab order within each window)
 * @param {chrome.tabs.Tab[]} tabs - Tabs to render
 */
export function renderGroupedTabs(tabs) {
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

        // Get active tab title for window header
        const activeTab = windowTabs.find(t => t.active) || windowTabs[0];
        const windowTitle = activeTab?.title || 'Window';
        const shortWindowTitle = windowTitle.length > 30 ? windowTitle.substring(0, 30) + '…' : windowTitle;

        // Add window header as a non-draggable row
        html += `<div class="tab-row window-header-row" data-window-id="${windowId}">
          <div class="window-group-header">
            🪟 ${shortWindowTitle} (${windowTabs.length})
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
                const sharedBadge = groupInfo?.shared ? '<span class="badge badge-shared">Shared</span>' : '';

                // Render group header as a special row
                html += `<div class="tab-row group-header-row" data-group-id="${section.groupId}" data-color="${groupColor}">
                  <div class="tab-group-header-inline" data-color="${groupColor}">
                    <span class="group-indicator-small" style="background-color: var(--group-${groupColor});"></span>
                    <span class="group-title-small">${escapeHtml(groupTitle)}</span>
                    ${sharedBadge}
                  </div>
                </div>`;

                // Render tabs in the group
                html += section.tabs.map((tab, idx) =>
                    renderTabItem(tab, groupColor, getSplitMeta(tab, section.tabs, idx))
                ).join('');
            } else {
                html += section.tabs.map((tab, idx) =>
                    renderTabItem(tab, null, getSplitMeta(tab, section.tabs, idx))
                ).join('');
            }
        });
    });

    listEl.innerHTML = html;
    attachTabClickListeners();
    initializeSortable();
}

/**
 * Render tabs grouped by Chrome tab groups (respecting real tab order)
 * Uses flat structure with group headers as separator items
 * @param {chrome.tabs.Tab[]} tabs - Tabs to render
 */
export function renderGroupsByTabGroups(tabs) {
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

/**
 * Render tabs in flat list (no grouping)
 * @param {chrome.tabs.Tab[]} tabs - Tabs to render
 */
export function renderFlatTabs(tabs) {
    const listEl = document.getElementById('tabsList');
    listEl.innerHTML = tabs.map(tab => renderTabItem(tab)).join('');
    attachTabClickListeners();
}

// ============================================================================
// Tab Item Rendering
// ============================================================================

/**
 * Render a single tab item
 * @param {chrome.tabs.Tab} tab - Tab to render
 * @param {string|null} groupColor - Optional group color
 * @returns {string} HTML string for the tab item
 */
export function renderTabItem(tab, groupColor = null, splitMeta = null) {
    const splitPosition = splitMeta?.position || null;
    const state = tabStates[tab.id];
    const isActive = currentTab && tab.id === currentTab.id;
    const isSplitPartnerActive = Boolean(
        currentTab &&
        hasSplitView(currentTab) &&
        hasSplitView(tab) &&
        tab.windowId === currentTab.windowId &&
        tab.splitViewId === currentTab.splitViewId &&
        !isActive
    );
    const isSharedGroupProtected = Boolean(
        settings.protectSharedGroups &&
        tab.groupId !== -1 &&
        tabGroups[tab.groupId]?.shared
    );
    const isSleeping = Boolean(tab.discarded || tab.frozen);

    let favicon = '<svg width="16" height="16" style="opacity: 0.3;"><use href="#icon-globe"/></svg>';
    if (tab.favIconUrl) {
        favicon = `<img src="${tab.favIconUrl}" alt="">`;
    }

    let countdown = '—';
    let countdownLabel = '';
    let countdownClass = '';

    // Show compact Split indicator instead of repeating identical Active/Countdown on the 2nd split row
    if (splitMeta?.sameStatusAsPrev) {
        countdown = '<span class="split-inline-tag">Split</span>';
        countdownLabel = '';
        countdownClass = 'split-dedup';
    } else if (!settings.enabled) {
        countdown = '—';
        countdownLabel = '';
        countdownClass = '';
    } else if (state) {
        // Check if tab is protected (explicit, media, pinned, shared group, or special with setting disabled)
        const isPinnedProtected = tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state.hasMedia && settings.pauseOnMedia;

        const tabTimeoutAction = state.timeoutAction || settings.timeoutAction || 'close';

        if (state.protected || isMediaProtected || isPinnedProtected || isSpecialProtected || isSharedGroupProtected) {
            // Tab is protected - show shield with label (vertical stack)
            let label = 'Protected';
            if (isSpecialProtected) label = 'Special';
            else if (isPinnedProtected) label = 'Pinned';
            else if (isSharedGroupProtected) label = 'Shared';
            else if (isMediaProtected) label = 'Media';
            countdown = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg><span>' + label + '</span>';
            countdownLabel = '';
            countdownClass = 'protected';
        } else if (state.lastActiveTime === null) {
            // Tab is active (or visible Split View partner) - show eye icon immediately
            countdown = '<svg width="14" height="14" class="active-icon"><use href="#icon-eye"/></svg><span>Active</span>';
            countdownLabel = '';
            countdownClass = 'active';
        } else if (tabTimeoutAction === 'discard' && isSleeping) {
            countdown = '<svg width="14" height="14" class="sleep-icon"><use href="#icon-moon"/></svg><span>Sleep</span>';
            countdownLabel = '';
            countdownClass = 'sleeping';
        } else {
            // Regular countdown - label reflects next action (Sleep vs Close vs Left)
            const actionLabel = tabTimeoutAction === 'discard'
                ? 'Sleep'
                : tabTimeoutAction === 'discard_then_close'
                    ? (state.discardedAt || isSleeping ? 'Close' : 'Sleep')
                    : 'Left';
            countdown = '<span class="time-value">' + formatTime(state.countdown) + '</span><span>' + actionLabel + '</span>';
            countdownLabel = '';
            if (actionLabel === 'Sleep') {
                countdownClass = state.countdown <= 60 ? 'sleep-pending sleep-soon' : 'sleep-pending';
            } else if (state.countdown > 180) {
                countdownClass = 'high';
            } else if (state.countdown > 60) {
                countdownClass = 'medium';
            } else {
                countdownClass = 'low';
            }
        }
    }

    const badges = [];
    if (tab.pinned) {
        badges.push('<span class="badge badge-pinned">Pinned</span>');
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

    // Determine if this tab would be closed in quit confirm mode
    let quitTargetClass = '';
    if (quitConfirmMode && !isActive && !isSplitPartnerActive && settings.enabled) {
        const isPinnedProtected = tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state?.hasMedia && settings.pauseOnMedia;
        const isProtected = state?.protected || isPinnedProtected || isSpecialProtected || isMediaProtected || isSharedGroupProtected;
        const hasCountdown = state?.countdown !== null && state?.countdown !== undefined;
        if (!isProtected && hasCountdown) {
            quitTargetClass = 'quit-target';
        }
    }

    // Check if tab is selected in edit mode
    const isSelected = selectedTabIds.has(tab.id);
    const splitClasses = splitPosition ? `split-view-item split-view-${splitPosition}` : '';

    return `
    <div class="tab-row ${splitPosition ? `split-row-${splitPosition}` : ''}">
      <div class="tab-item ${isActive || isSplitPartnerActive ? 'active' : ''} ${isSleeping ? 'sleeping-tab' : ''} ${splitClasses} ${quitTargetClass} ${isSelected ? 'selected' : ''}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-group-id="${tab.groupId || ''}" data-split-view-id="${hasSplitView(tab) ? tab.splitViewId : ''}" data-split-partner-id="${splitMeta?.partnerTabId || ''}" ${groupIndicatorStyle}>
        <div class="tab-favicon">${favicon}${isSleeping ? '<span class="sleep-moon-dot" title="Sleeping tab"><svg width="8" height="8"><use href="#icon-moon"/></svg></span>' : ''}</div>
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

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Attach click listeners to tab items
 */
export function attachTabClickListeners() {
    // Attach tab item click handlers
    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const windowId = parseInt(item.dataset.windowId);

        // Click on tab item
        item.addEventListener('click', async (e) => {
            // Don't process if clicking close button
            if (e.target.closest('.tab-close-btn')) return;

            // In edit mode, toggle selection
            if (editMode) {
                e.preventDefault();
                e.stopPropagation();

                if (selectedTabIds.has(tabId)) {
                    deleteSelectedTabId(tabId);
                    item.classList.remove('selected');
                } else {
                    addSelectedTabId(tabId);
                    item.classList.add('selected');
                }
                updateBatchActionsBar();
                return;
            }

            // Normal mode - focus tab
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
