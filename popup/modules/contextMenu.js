/**
 * Context Menu Module
 * Right-click context menu for tabs, groups, and windows
 */

import {
    allTabs, tabGroups, contextMenuState,
    setContextMenuState
} from './state.js';
import { escapeHtml } from './utils.js';
import { loadAllTabs } from './tabs.js';
import {
    moveTabToGroup, removeTabFromGroup,
    moveAllTabsInGroup, ungroupAllInGroup, moveTabToWindow
} from './tabGroups.js';

// ============================================================================
// Context Menu Display
// ============================================================================

/**
 * Show context menu
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} type - Type: 'tab', 'group', or 'window'
 * @param {number} targetId - ID of the target item
 * @param {Event} event - Original event
 */
export function showContextMenu(x, y, type, targetId, event) {
    event.preventDefault();
    event.stopPropagation();

    const menu = document.getElementById('contextMenu');
    const menuItems = document.querySelector('.context-menu-items');

    setContextMenuState({
        visible: true,
        targetTabId: type === 'tab' ? targetId : null,
        targetGroupId: type === 'group' ? targetId : null,
        targetWindowId: type === 'window' ? targetId : null,
        type
    });

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

/**
 * Hide context menu
 */
export function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'none';
    setContextMenuState({
        ...contextMenuState,
        visible: false
    });
    document.removeEventListener('click', hideContextMenu);
}

// ============================================================================
// Menu Builders
// ============================================================================

/**
 * Build tab context menu
 * @param {chrome.tabs.Tab} tab - Tab to build menu for
 * @returns {string} HTML string for menu items
 */
export function buildTabContextMenu(tab) {
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

/**
 * Build group context menu
 * @param {number} groupId - Group ID to build menu for
 * @returns {string} HTML string for menu items
 */
export function buildGroupContextMenu(groupId) {
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

/**
 * Build window context menu
 * @param {number} windowId - Window ID to build menu for
 * @returns {string} HTML string for menu items
 */
export function buildWindowContextMenu(windowId) {
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

// ============================================================================
// Context Menu Handlers
// ============================================================================

/**
 * Attach context menu action handlers
 */
export function attachContextMenuHandlers() {
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
// Context Menu Action Helpers
// ============================================================================

/**
 * Create a new group with a single tab
 * @param {number} tabId - Tab ID to add to new group
 */
export async function createNewGroupWithTab(tabId) {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    await chrome.tabGroups.update(groupId, {
        title: `Group ${Object.keys(tabGroups).length + 1}`,
        color: randomColor
    });
}

/**
 * Move tab to a new window
 * @param {number} tabId - Tab ID to move
 */
export async function moveTabToNewWindow(tabId) {
    await chrome.windows.create({ tabId: tabId });
}

/**
 * Duplicate a tab
 * @param {number} tabId - Tab ID to duplicate
 */
export async function duplicateTab(tabId) {
    await chrome.tabs.duplicate(tabId);
}

/**
 * Toggle pin status of a tab
 * @param {number} tabId - Tab ID to toggle pin
 */
export async function togglePinTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { pinned: !tab.pinned });
}

/**
 * Rename group with prompt
 * @param {number} groupId - Group ID to rename
 */
export async function renameGroupPrompt(groupId) {
    const groupInfo = tabGroups[groupId];
    const currentName = groupInfo?.title || 'Unnamed Group';
    const newName = prompt('Enter new group name:', currentName);
    if (newName && newName.trim() !== '') {
        await chrome.tabGroups.update(groupId, { title: newName.trim() });
    }
}

/**
 * Change group color
 * @param {number} groupId - Group ID to change color
 * @param {string} color - New color
 */
export async function changeGroupColor(groupId, color) {
    await chrome.tabGroups.update(groupId, { color: color });
}

/**
 * Close all tabs in a group
 * @param {number} groupId - Group ID to close
 */
export async function closeAllTabsInGroup(groupId) {
    const tabsInGroup = allTabs.filter(t => t.groupId === groupId);
    const tabIds = tabsInGroup.map(t => t.id);
    if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
    }
}

/**
 * Duplicate a group
 * @param {number} groupId - Group ID to duplicate
 */
export async function duplicateGroup(groupId) {
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

/**
 * Move entire group to another window
 * @param {number} groupId - Group ID to move
 * @param {number} windowId - Target window ID
 */
export async function moveGroupToWindow(groupId, windowId) {
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

/**
 * Move entire group to a new window
 * @param {number} groupId - Group ID to move
 */
export async function moveGroupToNewWindow(groupId) {
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

/**
 * Move all tabs from one window to another and create a group
 * @param {number} sourceWindowId - Source window ID
 * @param {number} targetWindowId - Target window ID
 */
export async function moveAllTabsToWindow(sourceWindowId, targetWindowId) {
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

/**
 * Close all tabs in a window
 * @param {number} windowId - Window ID to close all tabs in
 */
export async function closeAllTabsInWindow(windowId) {
    const tabsToClose = allTabs.filter(t => t.windowId === windowId);
    const tabIds = tabsToClose.map(t => t.id);
    if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
    }
}
