import { getSettings, getTabStates, saveTabStates } from './utils/storage.js';
import { parseQuitParams, cleanQuitParams, hasQuitParams } from './utils/quit-integration.js';

// Tab states structure:
// {
//   [tabId]: {
//     url: string,
//     lastActiveTime: number (timestamp),
//     countdown: number (seconds remaining),
//     isPinned: boolean,
//     hasMedia: boolean,
//     protected: boolean
//   }
// }

let tabStates = {};
let settings = {};
let activeTabsByWindow = {}; // Track active tab per window: { windowId: tabId }
let focusedWindowId = null; // Track the currently focused window

// Initialize extension
async function initialize() {
    console.log('QuIt Tab Manager: Initializing...');

    settings = await getSettings();
    tabStates = await getTabStates();

    // Clean up states for tabs that no longer exist
    const allTabs = await chrome.tabs.query({});
    const existingTabIds = new Set(allTabs.map(t => t.id));

    Object.keys(tabStates).forEach(tabId => {
        if (!existingTabIds.has(parseInt(tabId))) {
            delete tabStates[tabId];
        }
    });

    // Initialize states for existing tabs
    for (const tab of allTabs) {
        await updateTabState(tab);
    }

    // Get the currently focused window
    try {
        const focusedWindow = await chrome.windows.getLastFocused();
        focusedWindowId = focusedWindow.id;
    } catch {
        focusedWindowId = null;
    }

    // Set the currently active tab for each window
    const windows = await chrome.windows.getAll();
    for (const window of windows) {
        const activeTabs = await chrome.tabs.query({ active: true, windowId: window.id });
        if (activeTabs.length > 0) {
            const activeTab = activeTabs[0];
            activeTabsByWindow[window.id] = activeTab.id;
            // Only mark as truly active if this is the focused window (when setting enabled)
            const isTrulyActive = !settings.focusedWindowOnly || window.id === focusedWindowId;
            await updateTabState(activeTab, isTrulyActive);
        }
    }

    await saveTabStates(tabStates);

    // Set up alarm for periodic checks
    chrome.alarms.create('checkTabs', { periodInMinutes: 1 / 6 }); // Every 10 seconds

    console.log('QuIt Tab Manager: Initialized with', Object.keys(tabStates).length, 'tabs');
}

// Update tab state when tab is created or updated
async function updateTabState(tab, isActive = false) {
    // Always skip tabs without URLs (incomplete tabs)
    if (!tab.url) return;

    // Check if this is a special tab (chrome://, extension, etc.)
    const isSpecialTab = tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('edge://');

    // Skip special tabs only if autoCloseSpecial is disabled
    if (isSpecialTab && !settings.autoCloseSpecial) {
        return;
    }

    const existingState = tabStates[tab.id];

    // Use global countdown setting
    let countdown = settings.globalCountdown;

    const now = Date.now();

    // Set lastActiveTime only when tab becomes inactive
    // Active tabs should have null lastActiveTime (countdown doesn't start until you leave)
    let lastActiveTime;
    if (isActive) {
        // Tab is active - reset countdown timer (don't count down)
        lastActiveTime = null;
    } else if (existingState?.lastActiveTime) {
        // Tab already has a lastActiveTime - keep it (countdown continues)
        lastActiveTime = existingState.lastActiveTime;
    } else {
        // Tab is being created in background or was just left - start countdown now
        lastActiveTime = now;
    }

    tabStates[tab.id] = {
        url: tab.url,
        lastActiveTime: lastActiveTime,
        countdown: countdown,
        initialCountdown: countdown, // Store initial value for reset
        isPinned: tab.pinned || false,
        hasMedia: tab.audible || false,
        protected: existingState?.protected || false // Preserve existing protected state
    };
}

// Handle tab activation
async function onTabActivated(activeInfo) {
    const now = Date.now();
    const windowId = activeInfo.windowId;

    // Start countdown on previously active tab in THIS window (if any)
    const prevActiveTabId = activeTabsByWindow[windowId];
    if (prevActiveTabId !== undefined && tabStates[prevActiveTabId]) {
        const prevState = tabStates[prevActiveTabId];
        // Only set lastActiveTime if it was null (tab was active)
        if (prevState.lastActiveTime === null) {
            tabStates[prevActiveTabId].lastActiveTime = now;
        }
    }

    // Update currently active tab for this window
    activeTabsByWindow[windowId] = activeInfo.tabId;

    // Set new active tab (only truly active if this is the focused window)
    const isTrulyActive = !settings.focusedWindowOnly || windowId === focusedWindowId;
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await updateTabState(tab, isTrulyActive);
    await saveTabStates(tabStates);
}

// Handle window focus change
async function onWindowFocusChanged(newFocusedWindowId) {
    const now = Date.now();
    const previousFocusedWindowId = focusedWindowId;

    // Update focused window (WINDOW_ID_NONE = -1 means no Chrome window focused)
    focusedWindowId = newFocusedWindowId === chrome.windows.WINDOW_ID_NONE ? null : newFocusedWindowId;

    // Only process if focusedWindowOnly setting is enabled
    if (!settings.focusedWindowOnly) return;

    // Start countdown on active tab in previously focused window
    if (previousFocusedWindowId && activeTabsByWindow[previousFocusedWindowId]) {
        const prevActiveTabId = activeTabsByWindow[previousFocusedWindowId];
        if (tabStates[prevActiveTabId] && tabStates[prevActiveTabId].lastActiveTime === null) {
            tabStates[prevActiveTabId].lastActiveTime = now;
        }
    }

    // Reset countdown on active tab in newly focused window
    if (focusedWindowId && activeTabsByWindow[focusedWindowId]) {
        const newActiveTabId = activeTabsByWindow[focusedWindowId];
        if (tabStates[newActiveTabId]) {
            tabStates[newActiveTabId].lastActiveTime = null;
        }
    }

    await saveTabStates(tabStates);
}

// Handle tab updates
async function onTabUpdated(tabId, changeInfo, tab) {
    // Update media status
    if (changeInfo.audible !== undefined) {
        if (tabStates[tabId]) {
            tabStates[tabId].hasMedia = changeInfo.audible;
        }
    }

    // Update pinned status
    if (changeInfo.pinned !== undefined) {
        if (tabStates[tabId]) {
            tabStates[tabId].isPinned = changeInfo.pinned;
        }
    }

    // URL changed, reinitialize the tab
    if (changeInfo.url) {
        // Check for QuIt app integration parameters
        // If integration was handled, it manages state itself - don't overwrite
        const wasHandled = await handleQuitIntegration(tabId, changeInfo.url, tab);

        if (!wasHandled) {
            // Only update state if not handled by QuIt integration
            const isActive = activeTabsByWindow[tab.windowId] === tabId;
            await updateTabState(tab, isActive);
        }
    }

    await saveTabStates(tabStates);
}

// Handle QuIt app integration - returns true if URL was handled
async function handleQuitIntegration(tabId, url, tab) {
    // Check if URL has QuIt parameters
    if (!hasQuitParams(url)) {
        return false;
    }

    const params = parseQuitParams(url);
    if (!params) {
        return false;
    }

    console.log('QuIt Integration: Processing tab', tabId, 'with params:', params);

    try {
        // Clean URL for duplicate detection
        const cleanUrl = cleanQuitParams(url);

        // Check for duplicate tabs with same clean URL
        const allTabs = await chrome.tabs.query({});
        const duplicateTab = allTabs.find(t =>
            t.id !== tabId && t.url === cleanUrl
        );

        let targetTabId = tabId;

        if (duplicateTab) {
            console.log('QuIt Integration: Found duplicate tab', duplicateTab.id, 'moving to group and closing new tab', tabId);
            targetTabId = duplicateTab.id;
        }

        // Find or create tab group
        const groups = await chrome.tabGroups.query({ title: params.group });
        let groupId;

        if (groups.length > 0) {
            // Group exists, use it
            groupId = groups[0].id;
            console.log('QuIt Integration: Using existing group', groupId, params.group);
        } else {
            // Create new group
            groupId = await chrome.tabs.group({ tabIds: [targetTabId] });
            await chrome.tabGroups.update(groupId, {
                title: params.group,
                color: params.color,
                collapsed: false
            });
            console.log('QuIt Integration: Created new group', groupId, params.group, 'with color', params.color);
        }

        // Add tab to group if not already grouped during creation
        const targetTab = await chrome.tabs.get(targetTabId);
        if (targetTab.groupId !== groupId) {
            await chrome.tabs.group({ tabIds: [targetTabId], groupId });
        }

        // Apply auto-protect if requested
        // Clean URL first (remove quit_* parameters) - this triggers onTabUpdated again
        await chrome.tabs.update(targetTabId, { url: cleanUrl });
        console.log('QuIt Integration: Cleaned URL for tab', targetTabId);

        // Wait a moment for the URL update to settle, then apply protection
        // We need to ensure tabStates exists for this tab before setting protected
        if (params.pause) {
            // Ensure tab state exists
            if (!tabStates[targetTabId]) {
                const targetTab = await chrome.tabs.get(targetTabId);
                const isActive = activeTabsByWindow[targetTab.windowId] === targetTabId;
                await updateTabState(targetTab, isActive);
            }
            tabStates[targetTabId].protected = true;
            await saveTabStates(tabStates);
            console.log('QuIt Integration: Set tab', targetTabId, 'as protected');
        }

        // Close duplicate tab if we found one
        if (duplicateTab) {
            await chrome.tabs.remove(tabId);
            console.log('QuIt Integration: Closed duplicate tab', tabId);
        }

        return true;  // URL was handled

    } catch (error) {
        console.error('QuIt Integration: Error handling integration:', error);
        return false;  // Let normal flow handle the tab
    }
}

// Handle tab creation
async function onTabCreated(tab) {
    await updateTabState(tab, false);
    await saveTabStates(tabStates);
}

// Handle tab removal
async function onTabRemoved(tabId, removeInfo) {
    delete tabStates[tabId];

    // Clean up window tracking if window is being closed
    if (removeInfo.isWindowClosing && activeTabsByWindow[removeInfo.windowId]) {
        delete activeTabsByWindow[removeInfo.windowId];
    }

    await saveTabStates(tabStates);
}

// Main alarm handler - check all tabs
async function onAlarm(alarm) {
    if (alarm.name !== 'checkTabs') return;
    if (!settings.enabled) return;

    // Refresh settings in case they changed
    settings = await getSettings();

    const now = Date.now();
    const activeTabs = await chrome.tabs.query({ active: true });

    // Determine which tabs are "truly active" based on focusedWindowOnly setting
    let trulyActiveTabIds;
    if (settings.focusedWindowOnly && focusedWindowId) {
        // In single window mode, only the active tab in the focused window is truly active
        trulyActiveTabIds = new Set(
            activeTabs.filter(t => t.windowId === focusedWindowId).map(t => t.id)
        );
    } else {
        // In multi-window mode, all active tabs are truly active
        trulyActiveTabIds = new Set(activeTabs.map(t => t.id));
    }

    const tabsToClose = [];

    for (const [tabId, state] of Object.entries(tabStates)) {
        const id = parseInt(tabId);

        // Skip truly active tabs (depends on focusedWindowOnly setting)
        if (trulyActiveTabIds.has(id)) continue;

        // Skip if countdown hasn't started yet (tab never left)
        if (state.lastActiveTime === null) continue;

        // Skip if countdown is null (never close)
        if (state.countdown === null) continue;

        // Skip pinned tabs if setting is disabled
        if (state.isPinned && !settings.autoClosePinned) continue;

        // Skip if protected
        if (state.protected) continue;

        // Pause countdown if media is playing and setting enabled
        if (state.hasMedia && settings.pauseOnMedia) continue;

        // Calculate time inactive
        const inactiveTime = Math.floor((now - state.lastActiveTime) / 1000);

        // Update countdown
        const remaining = state.initialCountdown - inactiveTime;
        state.countdown = Math.max(0, remaining);

        // Mark for closure if countdown reached zero
        if (remaining <= 0) {
            tabsToClose.push(id);
        }
    }

    // Close tabs (handle last tab in window specially)
    if (tabsToClose.length > 0) {
        console.log('QuIt Tab Manager: Closing', tabsToClose.length, 'inactive tabs');

        // Get all tabs to check if any are the last in their window
        const allTabs = await chrome.tabs.query({});
        const tabsByWindow = {};
        allTabs.forEach(t => {
            if (!tabsByWindow[t.windowId]) tabsByWindow[t.windowId] = [];
            tabsByWindow[t.windowId].push(t.id);
        });

        const windowsToClose = [];
        const tabsToRemove = [];

        for (const tabId of tabsToClose) {
            const tab = allTabs.find(t => t.id === tabId);
            if (!tab) continue;

            // Check if this is the last tab in its window
            if (tabsByWindow[tab.windowId] && tabsByWindow[tab.windowId].length === 1) {
                // Close the entire window instead
                windowsToClose.push(tab.windowId);
            } else {
                tabsToRemove.push(tabId);
            }
        }

        // Close windows (which closes their last tab)
        for (const windowId of windowsToClose) {
            try {
                await chrome.windows.remove(windowId);
            } catch (e) {
                console.error('Error closing window:', e);
            }
        }

        // Close regular tabs
        if (tabsToRemove.length > 0) {
            await chrome.tabs.remove(tabsToRemove);
        }

        // Clean up states
        tabsToClose.forEach(id => delete tabStates[id]);
    }

    await saveTabStates(tabStates);
}

// Get the currently active tab
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
}

// Handle messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // Keep channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
    try {
        switch (message.type) {
            case 'getTabStates':
                sendResponse({ success: true, data: tabStates });
                break;

            case 'getSettings':
                sendResponse({ success: true, data: settings });
                break;

            case 'protectTab':
                if (tabStates[message.tabId]) {
                    tabStates[message.tabId].protected = true;
                    await saveTabStates(tabStates);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Tab not found' });
                }
                break;

            case 'unprotectTab':
                if (tabStates[message.tabId]) {
                    tabStates[message.tabId].protected = false;
                    await saveTabStates(tabStates);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Tab not found' });
                }
                break;

            case 'settingsUpdated':
                settings = await getSettings();
                // Re-evaluate all tabs with new settings
                const allTabs = await chrome.tabs.query({});
                for (const tab of allTabs) {
                    // Check if this tab is currently active in its window
                    const isActive = activeTabsByWindow[tab.windowId] === tab.id;
                    await updateTabState(tab, isActive);
                }
                await saveTabStates(tabStates);
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown message type' });
        }
    } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Set up event listeners
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onCreated.addListener(onTabCreated);
chrome.tabs.onRemoved.addListener(onTabRemoved);
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);
chrome.alarms.onAlarm.addListener(onAlarm);

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// Initialize immediately
initialize();
