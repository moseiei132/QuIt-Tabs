/**
 * Events Module
 * Event listener setup for the popup
 */

import {
    currentTab, tabStates, settings, allTabs, quitConfirmMode,
    editMode, searchQuery,
    setEditMode, setSearchQuery, setQuitConfirmMode
} from './state.js';
import { loadAllTabs, renderTabsList } from './tabs.js';
import {
    updateCurrentTab, updateProtectButton, updateCurrentTabCountdown,
    updateCompactTabInfo, refreshTabStates
} from './currentTab.js';
import {
    updateBatchActionsBar, moveSelectedToGroup, moveSelectedToWindow,
    ungroupSelected, closeSelectedTabs, clearSelection, batchProtect,
    mergeDuplicateTabs
} from './batchActions.js';
import { setupSettingsPanel } from './settings.js';
import { isSpecialTab } from './utils.js';

// ============================================================================
// Event Listeners Setup
// ============================================================================

/**
 * Set up all event listeners for the popup
 */
export function setupEventListeners() {
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
    const protectBtn = document.getElementById('protectBtn');
    protectBtn.addEventListener('click', async () => {
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
            // Update tabStates through the state module
            const { setTabStates } = await import('./state.js');
            setTabStates(response.data);
            updateProtectButton();
            updateCurrentTabCountdown();
            renderTabsList();
        }
    });

    // Quit All button - close all countdown tabs (exclude protected, active, pinned)
    const quitAllBtn = document.getElementById('quitAllBtn');

    quitAllBtn.addEventListener('click', async () => {
        if (!quitConfirmMode) {
            // First click - enter confirm mode
            setQuitConfirmMode(true);
            quitAllBtn.textContent = 'Confirm';
            protectBtn.innerHTML = 'Cancel';
            protectBtn.classList.add('btn-cancel');
            // Swap positions to prevent accidental double-click
            protectBtn.style.order = '2';
            quitAllBtn.style.order = '1';
            // Re-render tabs to show quit targets in red
            renderTabsList();
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
        setQuitConfirmMode(false);
        quitAllBtn.textContent = 'Quit All';
        // Restore protected button HTML with icon
        protectBtn.innerHTML = '<svg width="14" height="14" id="protectIcon"><use href="#icon-shield" /></svg> Protected';
        protectBtn.classList.remove('btn-cancel');
        // Reset positions
        protectBtn.style.order = '';
        quitAllBtn.style.order = '';
        updateProtectButton();
        // Re-render tabs to remove red highlighting
        renderTabsList();
    }

    // Edit Mode toggle
    document.getElementById('editModeBtn').addEventListener('click', () => {
        setEditMode(!editMode);
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
        setSearchQuery(e.target.value);
        clearSearch.style.display = searchQuery ? 'block' : 'none';
        renderTabsList();
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        setSearchQuery('');
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
