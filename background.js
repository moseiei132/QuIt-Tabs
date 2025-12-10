import { getSettings, getTabStates, saveTabStates } from './utils/storage.js';
import { findBestMatch } from './utils/matcher.js';

// Tab states structure:
// {
//   [tabId]: {
//     url: string,
//     lastActiveTime: number (timestamp),
//     countdown: number (seconds remaining),
//     isPinned: boolean,
//     hasMedia: boolean,
//     matchedRule: Object | null
//   }
// }

let tabStates = {};
let settings = {};
let activeTabsByWindow = {}; // Track active tab per window: { windowId: tabId }

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

    // Set the currently active tab for each window
    const windows = await chrome.windows.getAll();
    for (const window of windows) {
        const activeTabs = await chrome.tabs.query({ active: true, windowId: window.id });
        if (activeTabs.length > 0) {
            const activeTab = activeTabs[0];
            activeTabsByWindow[window.id] = activeTab.id;
            await updateTabState(activeTab, true);
        }
    }

    await saveTabStates(tabStates);

    // Set up alarm for periodic checks
    chrome.alarms.create('checkTabs', { periodInMinutes: 1 / 6 }); // Every 10 seconds

    console.log('QuIt Tab Manager: Initialized with', Object.keys(tabStates).length, 'tabs');
}

// Update tab state when tab is created or updated
async function updateTabState(tab, isActive = false) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        return;
    }

    const existingState = tabStates[tab.id];
    const matchedRule = findBestMatch(tab.url, settings.exclusionRules);

    // Determine countdown based on matched rule or global setting
    let countdown;
    if (matchedRule && matchedRule.customCountdown !== undefined) {
        countdown = matchedRule.customCountdown; // null = never close
    } else {
        countdown = settings.globalCountdown;
    }

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
        matchedRule: matchedRule,
        paused: existingState?.paused || false // Preserve existing paused state
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

    // Set new active tab (resets its countdown)
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await updateTabState(tab, true);
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
        // Check if this tab is currently active in its window
        const isActive = activeTabsByWindow[tab.windowId] === tabId;
        await updateTabState(tab, isActive);
    }

    await saveTabStates(tabStates);
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
    const activeTabIds = new Set(activeTabs.map(t => t.id));
    const tabsToClose = [];

    for (const [tabId, state] of Object.entries(tabStates)) {
        const id = parseInt(tabId);

        // Skip active tabs in any window
        if (activeTabIds.has(id)) continue;

        // Skip if countdown hasn't started yet (tab never left)
        if (state.lastActiveTime === null) continue;

        // Skip if countdown is null (never close)
        if (state.countdown === null) continue;

        // Skip pinned tabs if setting is disabled
        if (state.isPinned && !settings.autoClosePinned) continue;

        // Skip if paused
        if (state.paused) continue;

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

    // Close tabs
    if (tabsToClose.length > 0) {
        console.log('QuIt Tab Manager: Closing', tabsToClose.length, 'inactive tabs');
        await chrome.tabs.remove(tabsToClose);

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

            case 'pauseTab':
                if (tabStates[message.tabId]) {
                    tabStates[message.tabId].paused = true;
                    await saveTabStates(tabStates);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Tab not found' });
                }
                break;

            case 'resumeTab':
                if (tabStates[message.tabId]) {
                    tabStates[message.tabId].paused = false;
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
chrome.alarms.onAlarm.addListener(onAlarm);

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// Initialize immediately
initialize();
