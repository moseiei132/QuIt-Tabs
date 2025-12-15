/**
 * Drag and Drop Module
 * Sortable.js initialization and drag-drop logic
 */

import {
    allTabs, groupByWindow, sortableInstance,
    setSortableInstance
} from './state.js';
import { loadAllTabs } from './tabs.js';

// ============================================================================
// Sortable Initialization
// ============================================================================

/**
 * Initialize Sortable.js for drag-and-drop
 */
export function initializeSortable() {
    const tabsList = document.getElementById('tabsList');
    if (!tabsList) return;

    // Destroy previous instance if exists
    if (sortableInstance) {
        sortableInstance.destroy();
    }

    // Initialize Sortable on the main tabs list
    const instance = new Sortable(tabsList, {
        animation: 200,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.tab-item, .group-header-row',  // Allow dragging tabs AND Chrome tab group headers (NOT window headers)
        draggable: '.tab-row', // The row is what moves
        filter: '.window-header-row', // Exclude window headers from dragging
        // Use fallback mode so we can hide the drag clone (native HTML5 drag creates its own image)
        forceFallback: true,

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
                await handleGroupMove(draggedRow, tabsList);
                return;
            }

            // HANDLE SINGLE TAB MOVE
            await handleTabMove(draggedRow, tabsList);
        }
    });

    setSortableInstance(instance);
}

// ============================================================================
// Group Move Handler
// ============================================================================

/**
 * Handle moving a group header
 * @param {HTMLElement} draggedRow - The dragged group header row
 * @param {HTMLElement} tabsList - The tabs list container
 */
async function handleGroupMove(draggedRow, tabsList) {
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
}

// ============================================================================
// Tab Move Handler
// ============================================================================

/**
 * Handle moving a single tab
 * @param {HTMLElement} draggedRow - The dragged tab row
 * @param {HTMLElement} tabsList - The tabs list container
 */
async function handleTabMove(draggedRow, tabsList) {
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

// ============================================================================
// Tab Move Function
// ============================================================================

/**
 * Modified moveTab function to accept dropAfter parameter
 * @param {number} draggedTabId - ID of the dragged tab
 * @param {number} targetTabId - ID of the target tab
 * @param {number} targetWindowId - Target window ID
 * @param {boolean} dropAfter - Whether to drop after the target
 */
export async function moveTab(draggedTabId, targetTabId, targetWindowId, dropAfter = false) {
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

// ============================================================================
// Window Cleanup
// ============================================================================

/**
 * Clean up empty windows (with only new tab page)
 * @param {number} windowId - Window ID to check
 */
export async function cleanupEmptyWindow(windowId) {
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
