/**
 * Batch Actions Module
 * Batch operations for selected tabs
 */

import {
    allTabs, tabGroups, tabStates, settings, selectedTabIds,
    setSelectedTabIds, clearSelectedTabIds
} from './state.js';
import { escapeHtml, isSpecialTab } from './utils.js';
import { loadAllTabs, renderTabsList } from './tabs.js';
import { refreshTabStates } from './currentTab.js';

// ============================================================================
// Batch Actions Bar
// ============================================================================

/**
 * Update batch actions bar visibility and populate dropdowns
 */
export function updateBatchActionsBar() {
    const batchBar = document.getElementById('batchActionsBar');
    const selectedCount = document.getElementById('selectedCount');

    if (selectedTabIds.size > 0) {
        batchBar.style.display = 'flex';
        selectedCount.textContent = selectedTabIds.size;
    } else {
        batchBar.style.display = 'none';
    }
}

// ============================================================================
// Batch Move Operations
// ============================================================================

/**
 * Batch action: Move selected tabs to group
 * @param {string} groupId - Target group ID
 */
export async function moveSelectedToGroup(groupId) {
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

/**
 * Batch action: Move selected tabs to window
 * @param {string} windowId - Target window ID
 */
export async function moveSelectedToWindow(windowId) {
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

/**
 * Batch action: Ungroup selected tabs
 */
export async function ungroupSelected() {
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

// ============================================================================
// Selection Management
// ============================================================================

/**
 * Clear all selections
 */
export function clearSelection() {
    // Remove selected class from all items
    document.querySelectorAll('.tab-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
    clearSelectedTabIds();
    updateBatchActionsBar();
}

// ============================================================================
// Tab Close Operations
// ============================================================================

/**
 * Close a single tab
 * @param {number} tabId - ID of tab to close
 */
export async function closeTab(tabId) {
    try {
        // Use new message handler to close tab with history tracking
        await chrome.runtime.sendMessage({
            type: 'closeTabWithHistory',
            tabId: tabId,
            isBatch: false
        });
        // Remove from allTabs array
        const newTabs = allTabs.filter(t => t.id !== tabId);
        // Update through loadAllTabs to properly sync state
        await loadAllTabs();
    } catch (err) {
        console.error('Failed to close tab:', err);
    }
}

/**
 * Close selected tabs
 */
export async function closeSelectedTabs() {
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
        clearSelection();
        await loadAllTabs();
    } catch (err) {
        console.error('Failed to close tabs:', err);
    }
}

// ============================================================================
// Tab Focus
// ============================================================================

/**
 * Focus a tab
 * @param {number} tabId - ID of tab to focus
 * @param {number} windowId - ID of window containing the tab
 */
export async function focusTab(tabId, windowId) {
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

// ============================================================================
// Batch Protection
// ============================================================================

/**
 * Batch protect/unprotect selected tabs
 * @param {boolean} protect - True to protect, false to unprotect
 */
export async function batchProtect(protect) {
    const tabIds = Array.from(selectedTabIds);

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

// ============================================================================
// Merge Duplicates
// ============================================================================

/**
 * Merge duplicate tabs (same URL)
 */
export async function mergeDuplicateTabs() {
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
