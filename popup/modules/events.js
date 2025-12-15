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
    document.getElementById('editModeBtn').addEventListener('click', async () => {
        const { initializeSortable } = await import('./dragDrop.js');
        setEditMode(!editMode);
        document.getElementById('editModeBtn').classList.toggle('active', editMode);
        document.getElementById('tabsList').classList.toggle('edit-mode', editMode);

        // Reinitialize Sortable with new disabled state
        initializeSortable();

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

    // Custom Action Menu
    const actionMenuBtn = document.getElementById('actionMenuBtn');
    const actionMenu = document.getElementById('actionMenu');
    const actionSubmenu = document.getElementById('actionSubmenu');
    const submenuItems = document.getElementById('submenuItems');

    // Toggle main menu
    actionMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = actionMenu.style.display !== 'none';
        actionMenu.style.display = isVisible ? 'none' : 'block';
        actionSubmenu.style.display = 'none';
    });

    // Handle menu item clicks
    actionMenu.addEventListener('click', async (e) => {
        const item = e.target.closest('.action-menu-item');
        if (!item) return;

        e.stopPropagation();
        const action = item.dataset.action;

        if (action === 'protect') {
            await batchProtect(true);
            hideMenus();
        } else if (action === 'unprotect') {
            await batchProtect(false);
            hideMenus();
        } else if (action === 'ungroup') {
            await ungroupSelected();
            hideMenus();
        } else if (action === 'close') {
            await closeSelectedTabs();
            hideMenus();
        } else if (action === 'group') {
            // Show group submenu
            const { tabGroups, allTabs } = await import('./state.js');
            submenuItems.innerHTML = '';
            Object.entries(tabGroups).forEach(([id, info]) => {
                const groupTabCount = allTabs.filter(t => t.groupId === parseInt(id)).length;
                const btn = document.createElement('button');
                btn.className = 'action-menu-item';
                btn.dataset.groupId = id;
                btn.innerHTML = `${info.title} <span class="menu-count">${groupTabCount}</span>`;
                submenuItems.appendChild(btn);
            });
            if (Object.keys(tabGroups).length === 0) {
                submenuItems.innerHTML = '<div class="action-menu-label">No groups available</div>';
            }
            actionMenu.style.display = 'none';
            actionSubmenu.style.display = 'block';
        } else if (action === 'window') {
            // Show window submenu
            const { allTabs } = await import('./state.js');
            const windowIds = [...new Set(allTabs.map(t => t.windowId))];
            submenuItems.innerHTML = '';
            windowIds.forEach(wId => {
                const windowTabs = allTabs.filter(t => t.windowId === wId);
                const activeTab = windowTabs.find(t => t.active) || windowTabs[0];
                const title = activeTab?.title || 'Window';
                const shortTitle = title.length > 20 ? title.substring(0, 20) + '…' : title;
                const btn = document.createElement('button');
                btn.className = 'action-menu-item';
                btn.dataset.windowId = wId;
                btn.innerHTML = `${shortTitle} <span class="menu-count">${windowTabs.length}</span>`;
                submenuItems.appendChild(btn);
            });
            actionMenu.style.display = 'none';
            actionSubmenu.style.display = 'block';
        }
    });

    // Handle submenu clicks
    actionSubmenu.addEventListener('click', async (e) => {
        const item = e.target.closest('.action-menu-item');
        if (!item) return;

        e.stopPropagation();

        if (item.dataset.action === 'back') {
            actionSubmenu.style.display = 'none';
            actionMenu.style.display = 'block';
            hidePreview();
            return;
        }

        if (item.dataset.groupId) {
            await moveSelectedToGroup(item.dataset.groupId);
            hideMenus();
        } else if (item.dataset.windowId) {
            await moveSelectedToWindow(item.dataset.windowId);
            hideMenus();
        }
    });

    // Handle hover on submenu items to show preview panel
    const tabsPreview = document.getElementById('tabsPreview');
    const previewTabs = document.getElementById('previewTabs');
    const previewTitle = document.getElementById('previewTitle');
    const previewCount = document.getElementById('previewCount');

    submenuItems.addEventListener('mouseover', async (e) => {
        const item = e.target.closest('.action-menu-item');
        if (!item) return;

        const { allTabs } = await import('./state.js');
        let tabs = [];
        let titleText = '';

        if (item.dataset.groupId) {
            const groupId = parseInt(item.dataset.groupId);
            tabs = allTabs.filter(t => t.groupId === groupId);
            titleText = 'Tabs in Group';
        } else if (item.dataset.windowId) {
            const windowId = parseInt(item.dataset.windowId);
            tabs = allTabs.filter(t => t.windowId === windowId);
            titleText = 'Tabs in Window';
        }

        if (tabs.length > 0) {
            previewTitle.textContent = titleText;
            previewCount.textContent = tabs.length;
            previewTabs.innerHTML = tabs.map(tab => {
                const title = tab.title || 'Untitled';
                const shortTitle = title.length > 35 ? title.substring(0, 35) + '…' : title;
                const favicon = tab.favIconUrl
                    ? `<img src="${tab.favIconUrl}" alt="">`
                    : '<svg width="14" height="14" style="opacity:0.3"><use href="#icon-globe"/></svg>';
                return `<div class="preview-tab-item">${favicon}<span>${shortTitle}</span></div>`;
            }).join('');
            showPreview();
        }
    });

    submenuItems.addEventListener('mouseleave', () => {
        hidePreview();
    });

    function hidePreview() {
        tabsPreview.style.display = 'none';
        document.getElementById('tabsList').classList.remove('preview-active');
    }

    function showPreview() {
        tabsPreview.style.display = 'block';
        document.getElementById('tabsList').classList.add('preview-active');
    }

    function hideMenus() {
        actionMenu.style.display = 'none';
        actionSubmenu.style.display = 'none';
        hidePreview();
    }

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            hideMenus();
        }
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
