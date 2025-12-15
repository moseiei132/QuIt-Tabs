/**
 * Tab Groups Module
 * Tab group management functions
 */

import { allTabs } from './state.js';
import { loadAllTabs } from './tabs.js';

// ============================================================================
// Tab to Group Operations
// ============================================================================

/**
 * Move tab to a specific group
 * @param {number} tabId - Tab ID to move
 * @param {number} targetGroupId - Target group ID
 */
export async function moveTabToGroup(tabId, targetGroupId) {
    try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId });
        await loadAllTabs();
    } catch (error) {
        console.error('Error moving tab to group:', error);
    }
}

/**
 * Remove tab from its current group
 * @param {number} tabId - Tab ID to ungroup
 */
export async function removeTabFromGroup(tabId) {
    try {
        await chrome.tabs.ungroup([tabId]);
        await loadAllTabs();
    } catch (error) {
        console.error('Error removing tab from group:', error);
    }
}

// ============================================================================
// Group Operations
// ============================================================================

/**
 * Move all tabs in a group to another group
 * @param {number} sourceGroupId - Source group ID
 * @param {number|string} targetGroupId - Target group ID or 'ungroup'
 */
export async function moveAllTabsInGroup(sourceGroupId, targetGroupId) {
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

/**
 * Ungroup all tabs in a group
 * @param {number} groupId - Group ID to ungroup
 */
export async function ungroupAllInGroup(groupId) {
    try {
        const tabsInGroup = allTabs.filter(tab => tab.groupId === groupId);
        const tabIds = tabsInGroup.map(tab => tab.id);
        await chrome.tabs.ungroup(tabIds);
        await loadAllTabs();
    } catch (error) {
        console.error('Error ungrouping all:', error);
    }
}

// ============================================================================
// Tab to Window Operations
// ============================================================================

/**
 * Move tab to a different window
 * @param {number} tabId - Tab ID to move
 * @param {number} windowId - Target window ID
 */
export async function moveTabToWindow(tabId, windowId) {
    try {
        await chrome.tabs.move(tabId, { windowId, index: -1 });
        await loadAllTabs();
    } catch (error) {
        console.error('Error moving tab to window:', error);
    }
}
