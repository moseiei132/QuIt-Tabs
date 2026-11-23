import {
    getSettings,
    getTabStates,
    saveTabStates,
    getSessionState,
    saveSessionState,
    addHistoryEntry,
    getRuleForUrl
} from './utils/storage.js';
import { parseQuitParams, cleanQuitParams, hasQuitParams } from './utils/quit-integration.js';

// Tab states structure:
// {
//   [tabId]: {
//     url: string,
//     lastActiveTime: number | null (timestamp),
//     countdown: number (seconds remaining),
//     initialCountdown: number (seconds),
//     isPinned: boolean,
//     hasMedia: boolean,
//     protected: boolean
//   }
// }

const SPLIT_VIEW_NONE = chrome.tabs?.SPLIT_VIEW_ID_NONE ?? -1;

let tabStates = {};
let settings = {};
let activeTabsByWindow = {}; // Track visible active tab IDs per window: { [windowId]: number[] }
let focusedWindowId = null; // Track the currently focused window
let explicitlyClosedTabs = new Set(); // Track tabs being closed via our message handlers to prevent double logging
let hydrated = false;
let hydratePromise = null;
let initializePromise = null;

// ============================================================================
// Split View & Hydration Helpers
// ============================================================================

function hasSplitView(tab) {
    return tab?.splitViewId !== undefined && tab.splitViewId !== SPLIT_VIEW_NONE;
}

/**
 * Get tab IDs visible together with `tab` (itself + any Split View partner in same window)
 */
function getSplitGroupTabIds(tab, windowTabs) {
    if (!tab) return [];
    if (!hasSplitView(tab)) return [tab.id];
    return windowTabs
        .filter(t => t.windowId === tab.windowId && t.splitViewId === tab.splitViewId)
        .map(t => t.id);
}

/**
 * Compute all truly active (visible) tab IDs across Chrome,
 * including Split View partner tabs shown alongside an active tab.
 */
function getVisibleActiveTabIds(allTabs, currentFocusedWindowId) {
    const activeTabs = allTabs.filter(t => {
        if (!t.active) return false;
        if (settings.focusedWindowOnly && currentFocusedWindowId !== null) {
            return t.windowId === currentFocusedWindowId;
        }
        return true;
    });

    const visibleIds = new Set(activeTabs.map(t => t.id));
    const activeSplitKeys = new Set(
        activeTabs
            .filter(hasSplitView)
            .map(t => `${t.windowId}:${t.splitViewId}`)
    );

    if (activeSplitKeys.size > 0) {
        for (const tab of allTabs) {
            if (hasSplitView(tab) && activeSplitKeys.has(`${tab.windowId}:${tab.splitViewId}`)) {
                visibleIds.add(tab.id);
            }
        }
    }

    return visibleIds;
}

/**
 * Normalize legacy single-ID activeTabsByWindow entries to arrays
 */
function getActiveIdsForWindow(windowId) {
    const val = activeTabsByWindow[windowId];
    if (Array.isArray(val)) return val;
    if (typeof val === 'number') return [val];
    return [];
}

function isTabActiveInWindow(windowId, tabId) {
    return getActiveIdsForWindow(windowId).includes(tabId);
}

async function persistSession() {
    await saveSessionState({ activeTabsByWindow, focusedWindowId });
}

function notifyPopupStateUpdated() {
    try {
        chrome.runtime.sendMessage({ type: 'stateUpdated' }).catch(() => {
            // Popup / Side Panel is closed — ignore
        });
    } catch {
        // Ignore
    }
}

/**
 * Ensure in-memory state is hydrated after MV3 Service Worker suspension/wakeup
 */
async function ensureReady() {
    if (hydrated) return;
    if (!hydratePromise) {
        hydratePromise = (async () => {
            settings = await getSettings();
            tabStates = await getTabStates();
            const session = await getSessionState();
            activeTabsByWindow = session.activeTabsByWindow || {};
            focusedWindowId = session.focusedWindowId ?? null;
            hydrated = true;
        })().finally(() => {
            hydratePromise = null;
        });
    }
    await hydratePromise;
}

// ============================================================================
// Native Tab Strip Context Menus (Chrome 150+ "tab" context)
// ============================================================================

function createContextMenuItem(options) {
    return new Promise((resolve) => {
        try {
            chrome.contextMenus.create(options, () => {
                // Consume runtime.lastError so Chrome doesn't log unchecked errors
                if (chrome.runtime.lastError) {
                    console.warn('QuIt Tab Manager: contextMenus.create:', chrome.runtime.lastError.message);
                }
                resolve();
            });
        } catch (e) {
            // Older Chromium builds that reject contexts: ['tab'] synchronously
            console.warn('QuIt Tab Manager: Tab strip context menus unavailable:', e?.message || e);
            resolve();
        }
    });
}

async function setupContextMenus() {
    if (!chrome.contextMenus) return;
    await new Promise((resolve) => chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        resolve();
    }));

    await createContextMenuItem({
        id: 'quit-toggle-protect',
        title: 'QuIt: Protect / Unprotect Tab',
        contexts: ['tab']
    });
    await createContextMenuItem({
        id: 'quit-reset-timer',
        title: 'QuIt: Reset Countdown',
        contexts: ['tab']
    });
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize() {
    if (initializePromise) {
        return initializePromise;
    }
    initializePromise = runInitialize().finally(() => {
        initializePromise = null;
    });
    return initializePromise;
}

async function runInitialize() {
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

    // Set the currently active tabs (including Split View partners) for each window
    activeTabsByWindow = {};
    const windows = await chrome.windows.getAll();
    for (const win of windows) {
        const windowTabs = allTabs.filter(t => t.windowId === win.id);
        const activeTab = windowTabs.find(t => t.active);
        if (activeTab) {
            const visibleIds = getSplitGroupTabIds(activeTab, windowTabs);
            activeTabsByWindow[win.id] = visibleIds;
            const isTrulyActive = !settings.focusedWindowOnly || win.id === focusedWindowId;
            for (const id of visibleIds) {
                const t = windowTabs.find(wt => wt.id === id);
                if (t) {
                    await updateTabState(t, isTrulyActive);
                }
            }
        }
    }

    hydrated = true;
    await saveTabStates(tabStates);
    await persistSession();

    // Set up alarm for periodic checks
    chrome.alarms.create('checkTabs', { periodInMinutes: 1 / 6 }); // Every 10 seconds

    // Set up native tab strip context menus
    await setupContextMenus();

    // Restore window mode: if last mode was side panel, re-enable panel-on-click behavior
    try {
        const { windowMode } = await chrome.storage.local.get('windowMode');
        const isSidePanel = windowMode === 'sidepanel';
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: isSidePanel });
        console.log('QuIt Tab Manager: Restored windowMode =', windowMode ?? 'popup');
    } catch (e) {
        // sidePanel API not available (older Chrome) — ignore
        console.warn('QuIt Tab Manager: sidePanel.setPanelBehavior unavailable:', e.message);
    }

    console.log('QuIt Tab Manager: Initialized with', Object.keys(tabStates).length, 'tabs');
}

// ============================================================================
// Tab State Management
// ============================================================================

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

    // Get effective timeout & action rule for this specific URL (checks per-site rules)
    const rule = await getRuleForUrl(tab.url, settings);
    const countdown = rule.timeout;
    const now = Date.now();

    // Set lastActiveTime only when tab becomes inactive
    // Active tabs (and visible Split View partners) have null lastActiveTime
    let lastActiveTime;
    if (isActive) {
        lastActiveTime = null;
    } else if (existingState?.lastActiveTime) {
        lastActiveTime = existingState.lastActiveTime;
    } else {
        lastActiveTime = now;
    }

    tabStates[tab.id] = {
        url: tab.url,
        lastActiveTime: lastActiveTime,
        discardedAt: isActive ? null : (existingState?.discardedAt ?? null),
        countdown: countdown,
        initialCountdown: countdown,
        timeoutAction: rule.timeoutAction,
        closeAfterDiscard: rule.closeAfterDiscard,
        isPinned: tab.pinned || false,
        hasMedia: tab.audible || false,
        protected: existingState?.protected || false
    };
}

async function toggleTabProtection(tabId) {
    await ensureReady();

    if (!tabStates[tabId]) {
        try {
            const tab = await chrome.tabs.get(tabId);
            const isActive = isTabActiveInWindow(tab.windowId, tabId);
            await updateTabState(tab, isActive);
        } catch {
            return false;
        }
    }

    if (!tabStates[tabId]) return false;

    const nowProtected = !tabStates[tabId].protected;
    tabStates[tabId].protected = nowProtected;

    if (!nowProtected) {
        const tab = await chrome.tabs.get(tabId);
        const isActive = isTabActiveInWindow(tab.windowId, tabId) &&
            (!settings.focusedWindowOnly || tab.windowId === focusedWindowId);
        const rule = await getRuleForUrl(tab.url, settings);

        tabStates[tabId].lastActiveTime = isActive ? null : Date.now();
        tabStates[tabId].discardedAt = null;
        tabStates[tabId].countdown = rule.timeout;
        tabStates[tabId].initialCountdown = rule.timeout;
        tabStates[tabId].timeoutAction = rule.timeoutAction;
        tabStates[tabId].closeAfterDiscard = rule.closeAfterDiscard;
    }

    await saveTabStates(tabStates);
    notifyPopupStateUpdated();
    return true;
}

async function resetTabTimer(tabId) {
    await ensureReady();
    if (!tabStates[tabId]) return false;

    const tab = await chrome.tabs.get(tabId);
    const isActive = isTabActiveInWindow(tab.windowId, tabId) &&
        (!settings.focusedWindowOnly || tab.windowId === focusedWindowId);
    const rule = await getRuleForUrl(tab.url, settings);

    tabStates[tabId].lastActiveTime = isActive ? null : Date.now();
    tabStates[tabId].discardedAt = null;
    tabStates[tabId].countdown = rule.timeout;
    tabStates[tabId].initialCountdown = rule.timeout;
    tabStates[tabId].timeoutAction = rule.timeoutAction;
    tabStates[tabId].closeAfterDiscard = rule.closeAfterDiscard;

    await saveTabStates(tabStates);
    notifyPopupStateUpdated();
    return true;
}

// ============================================================================
// Chrome Event Handlers
// ============================================================================

async function onTabActivated(activeInfo) {
    await ensureReady();
    const now = Date.now();
    const windowId = activeInfo.windowId;

    const windowTabs = await chrome.tabs.query({ windowId });
    const activeTab = windowTabs.find(t => t.id === activeInfo.tabId);
    if (!activeTab) return;

    const nextActiveIds = getSplitGroupTabIds(activeTab, windowTabs);
    const nextActiveSet = new Set(nextActiveIds);

    // Start countdown only on previously visible tabs that are no longer visible
    // (Clicking between left/right panes of the same Split View keeps both active!)
    const prevActiveIds = getActiveIdsForWindow(windowId);
    for (const prevId of prevActiveIds) {
        if (!nextActiveSet.has(prevId) && tabStates[prevId]) {
            if (tabStates[prevId].lastActiveTime === null) {
                tabStates[prevId].lastActiveTime = now;
            }
        }
    }

    // Update currently visible active tabs for this window
    activeTabsByWindow[windowId] = nextActiveIds;

    // Mark new active tab(s) as truly active if this window is focused
    const isTrulyActive = !settings.focusedWindowOnly || windowId === focusedWindowId;
    for (const id of nextActiveIds) {
        const t = windowTabs.find(wt => wt.id === id);
        if (t) {
            await updateTabState(t, isTrulyActive);
        }
    }

    await saveTabStates(tabStates);
    await persistSession();
    notifyPopupStateUpdated();
}

async function onWindowFocusChanged(newFocusedWindowId) {
    await ensureReady();
    const now = Date.now();
    const previousFocusedWindowId = focusedWindowId;

    focusedWindowId = newFocusedWindowId === chrome.windows.WINDOW_ID_NONE ? null : newFocusedWindowId;

    if (!settings.focusedWindowOnly) {
        await persistSession();
        return;
    }

    // Start countdown on active tab(s) in previously focused window
    if (previousFocusedWindowId) {
        for (const prevActiveTabId of getActiveIdsForWindow(previousFocusedWindowId)) {
            if (tabStates[prevActiveTabId] && tabStates[prevActiveTabId].lastActiveTime === null) {
                tabStates[prevActiveTabId].lastActiveTime = now;
            }
        }
    }

    // Reset countdown on active tab(s) in newly focused window
    if (focusedWindowId) {
        for (const newActiveTabId of getActiveIdsForWindow(focusedWindowId)) {
            if (tabStates[newActiveTabId]) {
                tabStates[newActiveTabId].lastActiveTime = null;
            }
        }
    }

    await saveTabStates(tabStates);
    await persistSession();
}

async function onTabUpdated(tabId, changeInfo, tab) {
    await ensureReady();

    // Update media status
    if (changeInfo.audible !== undefined && tabStates[tabId]) {
        tabStates[tabId].hasMedia = changeInfo.audible;
    }

    // Update pinned status
    if (changeInfo.pinned !== undefined && tabStates[tabId]) {
        tabStates[tabId].isPinned = changeInfo.pinned;
    }

    // Handle Split View pairing/unpairing changes
    if (changeInfo.splitViewId !== undefined) {
        const now = Date.now();
        const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
        const activeTab = windowTabs.find(t => t.active);
        const prevActiveIds = getActiveIdsForWindow(tab.windowId);
        const nextActiveIds = activeTab ? getSplitGroupTabIds(activeTab, windowTabs) : [];
        const nextActiveSet = new Set(nextActiveIds);

        // Start countdown for any tab that just left the active Split View
        for (const prevId of prevActiveIds) {
            if (!nextActiveSet.has(prevId) && tabStates[prevId] && tabStates[prevId].lastActiveTime === null) {
                tabStates[prevId].lastActiveTime = now;
            }
        }

        // Pause countdown for any tab that just joined the active Split View
        const isTrulyActive = !settings.focusedWindowOnly || tab.windowId === focusedWindowId;
        if (isTrulyActive) {
            for (const id of nextActiveIds) {
                if (tabStates[id]) {
                    tabStates[id].lastActiveTime = null;
                }
            }
        }

        activeTabsByWindow[tab.windowId] = nextActiveIds;
        await persistSession();
        notifyPopupStateUpdated();
    }

    // URL changed, reinitialize the tab
    if (changeInfo.url) {
        const wasHandled = await handleQuitIntegration(tabId, changeInfo.url, tab);

        if (!wasHandled) {
            const isActive = isTabActiveInWindow(tab.windowId, tabId) &&
                (!settings.focusedWindowOnly || tab.windowId === focusedWindowId);
            await updateTabState(tab, isActive);
        }
    }

    await saveTabStates(tabStates);
}

// Handle QuIt app integration - returns true if URL was handled
async function handleQuitIntegration(tabId, url, tab) {
    if (!hasQuitParams(url)) {
        return false;
    }

    const params = parseQuitParams(url);
    if (!params) {
        return false;
    }

    console.log('QuIt Integration: Processing tab', tabId, 'with params:', params);

    try {
        const cleanUrl = cleanQuitParams(url);

        const allTabs = await chrome.tabs.query({});
        const duplicateTab = allTabs.find(t =>
            t.id !== tabId && t.url === cleanUrl
        );

        let targetTabId = tabId;

        if (duplicateTab) {
            console.log('QuIt Integration: Found duplicate tab', duplicateTab.id, 'moving to group and closing new tab', tabId);
            targetTabId = duplicateTab.id;
        }

        const groups = await chrome.tabGroups.query({ title: params.group });
        let groupId;

        if (groups.length > 0) {
            groupId = groups[0].id;
            console.log('QuIt Integration: Using existing group', groupId, params.group);
        } else {
            groupId = await chrome.tabs.group({ tabIds: [targetTabId] });
            await chrome.tabGroups.update(groupId, {
                title: params.group,
                color: params.color,
                collapsed: false
            });
            console.log('QuIt Integration: Created new group', groupId, params.group, 'with color', params.color);
        }

        const targetTab = await chrome.tabs.get(targetTabId);
        if (targetTab.groupId !== groupId) {
            await chrome.tabs.group({ tabIds: [targetTabId], groupId });
        }

        await chrome.tabs.update(targetTabId, { url: cleanUrl });
        console.log('QuIt Integration: Cleaned URL for tab', targetTabId);

        if (params.pause) {
            if (!tabStates[targetTabId]) {
                const refreshedTab = await chrome.tabs.get(targetTabId);
                const isActive = isTabActiveInWindow(refreshedTab.windowId, targetTabId);
                await updateTabState(refreshedTab, isActive);
            }
            tabStates[targetTabId].protected = true;
            await saveTabStates(tabStates);
            console.log('QuIt Integration: Set tab', targetTabId, 'as protected');
        }

        if (duplicateTab) {
            await chrome.tabs.remove(tabId);
            console.log('QuIt Integration: Closed duplicate tab', tabId);
        }

        return true;
    } catch (error) {
        console.error('QuIt Integration: Error handling integration:', error);
        return false;
    }
}

async function onTabCreated(tab) {
    await ensureReady();
    await updateTabState(tab, false);
    await saveTabStates(tabStates);
}

async function onTabRemoved(tabId, removeInfo) {
    await ensureReady();

    // Remove tabId from activeTabsByWindow if present
    if (activeTabsByWindow[removeInfo.windowId]) {
        if (removeInfo.isWindowClosing) {
            delete activeTabsByWindow[removeInfo.windowId];
        } else {
            activeTabsByWindow[removeInfo.windowId] = getActiveIdsForWindow(removeInfo.windowId)
                .filter(id => id !== tabId);
        }
        await persistSession();
    }

    if (explicitlyClosedTabs.has(tabId)) {
        explicitlyClosedTabs.delete(tabId);
        delete tabStates[tabId];
        await saveTabStates(tabStates);
        return;
    }

    const tabState = tabStates[tabId];
    if (tabState) {
        try {
            let tabTitle = 'Untitled';
            const tabFavicon = '';

            if (!removeInfo.isWindowClosing) {
                tabTitle = tabState.url ? new URL(tabState.url).hostname : 'Untitled';
            }

            await addHistoryEntry({
                url: tabState.url,
                title: tabTitle,
                favicon: tabFavicon,
                closeReason: 'manual_browser',
                windowId: removeInfo.windowId,
                groupId: null
            });
        } catch (error) {
            console.error('Error recording tab removal to history:', error);
        }
    }

    delete tabStates[tabId];
    await saveTabStates(tabStates);
}

// ============================================================================
// Periodic Alarm Handler
// ============================================================================

async function onAlarm(alarm) {
    if (alarm.name !== 'checkTabs') return;
    await ensureReady();

    settings = await getSettings();
    if (!settings.enabled) return;

    const now = Date.now();
    const allTabs = await chrome.tabs.query({});
    const tabsById = new Map(allTabs.map(t => [t.id, t]));

    // Determine visible active tabs (including Split View partners)
    const trulyActiveTabIds = getVisibleActiveTabIds(allTabs, focusedWindowId);

    // Identify Shared Tab Groups (Chrome 2025/2026)
    let sharedGroupIds = new Set();
    if (settings.protectSharedGroups && chrome.tabGroups?.query) {
        try {
            const groups = await chrome.tabGroups.query({});
            sharedGroupIds = new Set(groups.filter(g => g.shared).map(g => g.id));
        } catch {
            sharedGroupIds = new Set();
        }
    }

    const tabsToDiscard = [];
    const tabsToClose = [];
    const globalTimeoutAction = settings.timeoutAction || 'close';
    const globalCloseAfterDiscard = settings.closeAfterDiscard ?? 1800;

    for (const [tabId, state] of Object.entries(tabStates)) {
        const id = parseInt(tabId);
        const tab = tabsById.get(id);

        if (!tab) {
            delete tabStates[tabId];
            continue;
        }

        // Skip truly active tabs (including visible Split View partners)
        if (trulyActiveTabIds.has(id)) continue;

        // Skip if countdown hasn't started yet (tab never left)
        if (state.lastActiveTime === null) continue;

        // Skip if countdown is null (never close)
        if (state.countdown === null) continue;

        // Skip pinned tabs if setting is disabled
        if (state.isPinned && !settings.autoClosePinned) continue;

        // Skip if protected
        if (state.protected) continue;

        // Skip tabs inside Shared Tab Groups when protection enabled
        if (settings.protectSharedGroups && tab.groupId !== -1 && sharedGroupIds.has(tab.groupId)) continue;

        // Pause countdown if media is playing and setting enabled
        if (state.hasMedia && settings.pauseOnMedia) continue;

        const tabTimeoutAction = state.timeoutAction || globalTimeoutAction;
        const tabCloseAfterDiscard = state.closeAfterDiscard ?? globalCloseAfterDiscard;

        if (tabTimeoutAction === 'discard_then_close') {
            const isSleeping = Boolean(state.discardedAt || tab.discarded || tab.frozen);
            if (isSleeping) {
                if (!state.discardedAt) {
                    state.discardedAt = now;
                }
                const sleepElapsed = Math.floor((now - state.discardedAt) / 1000);
                const remaining = tabCloseAfterDiscard - sleepElapsed;
                state.countdown = Math.max(0, remaining);
                if (remaining <= 0) {
                    tabsToClose.push(id);
                }
            } else {
                const inactiveTime = Math.floor((now - state.lastActiveTime) / 1000);
                const remaining = state.initialCountdown - inactiveTime;
                state.countdown = Math.max(0, remaining);
                if (remaining <= 0) {
                    tabsToDiscard.push({ id, action: tabTimeoutAction, closeAfter: tabCloseAfterDiscard });
                }
            }
        } else if (tabTimeoutAction === 'discard') {
            // In sleep-only mode, skip tabs already discarded/frozen
            if (tab.discarded || tab.frozen) continue;

            const inactiveTime = Math.floor((now - state.lastActiveTime) / 1000);
            const remaining = state.initialCountdown - inactiveTime;
            state.countdown = Math.max(0, remaining);
            if (remaining <= 0) {
                tabsToDiscard.push({ id, action: tabTimeoutAction, closeAfter: tabCloseAfterDiscard });
            }
        } else {
            // Standard close mode
            const inactiveTime = Math.floor((now - state.lastActiveTime) / 1000);
            const remaining = state.initialCountdown - inactiveTime;
            state.countdown = Math.max(0, remaining);
            if (remaining <= 0) {
                tabsToClose.push(id);
            }
        }
    }

    // Step 1: Sleep (discard) tabs
    if (tabsToDiscard.length > 0) {
        console.log('QuIt Tab Manager: Sleeping (discarding)', tabsToDiscard.length, 'inactive tabs');
        for (const { id: tabId, action, closeAfter } of tabsToDiscard) {
            try {
                await chrome.tabs.discard(tabId);
                if (tabStates[tabId] && action === 'discard_then_close') {
                    tabStates[tabId].discardedAt = now;
                    tabStates[tabId].countdown = closeAfter;
                }
            } catch (e) {
                console.warn('Error discarding tab:', tabId, e?.message || e);
            }
        }
        notifyPopupStateUpdated();
    }

    // Step 2: Close tabs (either direct close mode or Stage 2 of 2-step mode)
    if (tabsToClose.length > 0) {
        console.log('QuIt Tab Manager: Closing', tabsToClose.length, 'inactive tabs');

        const tabsByWindow = {};
        allTabs.forEach(t => {
            if (!tabsByWindow[t.windowId]) tabsByWindow[t.windowId] = [];
            tabsByWindow[t.windowId].push(t.id);
        });

        const windowsToClose = [];
        const tabsToRemove = [];

        for (const tabId of tabsToClose) {
            const tab = tabsById.get(tabId);
            if (!tab) continue;

            try {
                const tabState = tabStates[tabId];
                await addHistoryEntry({
                    url: tab.url || tabState?.url || '',
                    title: tab.title || 'Untitled',
                    favicon: tab.favIconUrl || '',
                    closeReason: 'timeout',
                    windowId: tab.windowId,
                    groupId: tab.groupId !== -1 ? tab.groupId : null
                });
            } catch (error) {
                console.error('Error recording timeout close to history:', error);
            }

            if (tabsByWindow[tab.windowId] && tabsByWindow[tab.windowId].length === 1) {
                windowsToClose.push(tab.windowId);
            } else {
                tabsToRemove.push(tabId);
            }
        }

        for (const windowId of windowsToClose) {
            try {
                await chrome.windows.remove(windowId);
            } catch (e) {
                console.error('Error closing window:', e);
            }
        }

        if (tabsToRemove.length > 0) {
            await chrome.tabs.remove(tabsToRemove);
        }

        tabsToClose.forEach(id => delete tabStates[id]);
    }

    await saveTabStates(tabStates);
}

// ============================================================================
// Context Menu & Command Handlers
// ============================================================================

if (chrome.contextMenus?.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (!tab?.id) return;
        if (info.menuItemId === 'quit-toggle-protect') {
            await toggleTabProtection(tab.id);
        } else if (info.menuItemId === 'quit-reset-timer') {
            await resetTabTimer(tab.id);
        }
    });
}

if (chrome.commands?.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command === 'toggle-protect-tab') {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab?.id) {
                await toggleTabProtection(activeTab.id);
            }
        }
    });
}

// ============================================================================
// Message Handler
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true;
});

async function handleMessage(message, sender, sendResponse) {
    try {
        await ensureReady();

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

                    const unprotectTab = await chrome.tabs.get(message.tabId);
                    const isUnprotectTabActive = isTabActiveInWindow(unprotectTab.windowId, message.tabId) &&
                        (!settings.focusedWindowOnly || unprotectTab.windowId === focusedWindowId);

                    const rule = await getRuleForUrl(unprotectTab.url, settings);

                    tabStates[message.tabId].lastActiveTime = isUnprotectTabActive ? null : Date.now();
                    tabStates[message.tabId].discardedAt = null;
                    tabStates[message.tabId].countdown = rule.timeout;
                    tabStates[message.tabId].initialCountdown = rule.timeout;
                    tabStates[message.tabId].timeoutAction = rule.timeoutAction;
                    tabStates[message.tabId].closeAfterDiscard = rule.closeAfterDiscard;
                    await saveTabStates(tabStates);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Tab not found' });
                }
                break;

            case 'closeTabWithHistory':
                if (message.tabId) {
                    try {
                        const tab = await chrome.tabs.get(message.tabId);
                        explicitlyClosedTabs.add(message.tabId);

                        await addHistoryEntry({
                            url: tab.url,
                            title: tab.title || 'Untitled',
                            favicon: tab.favIconUrl || '',
                            closeReason: message.isBatch ? 'batch_close' : 'manual_quit',
                            windowId: tab.windowId,
                            groupId: tab.groupId !== -1 ? tab.groupId : null
                        });
                        await chrome.tabs.remove(message.tabId);
                        sendResponse({ success: true });
                    } catch (error) {
                        explicitlyClosedTabs.delete(message.tabId);
                        sendResponse({ success: false, error: error.message });
                    }
                } else {
                    sendResponse({ success: false, error: 'No tabId provided' });
                }
                break;

            case 'settingsUpdated': {
                settings = await getSettings();
                const allTabs = await chrome.tabs.query({});
                const visibleActiveIds = getVisibleActiveTabIds(allTabs, focusedWindowId);
                for (const tab of allTabs) {
                    await updateTabState(tab, visibleActiveIds.has(tab.id));
                }
                await saveTabStates(tabStates);
                sendResponse({ success: true });
                break;
            }

            default:
                sendResponse({ success: false, error: 'Unknown message type' });
        }
    } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// ============================================================================
// Set up event listeners
// ============================================================================

chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onCreated.addListener(onTabCreated);
chrome.tabs.onRemoved.addListener(onTabRemoved);
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);
chrome.alarms.onAlarm.addListener(onAlarm);

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// Initialize immediately on first load
initialize();
