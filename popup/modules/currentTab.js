/**
 * Current Tab Module
 * Current tab display, countdown updates, and protection UI
 */

import {
    currentTab, tabStates, settings, allTabs, tabGroups,
    setTabStates
} from './state.js';
import { formatTime, isSpecialTab } from './utils.js';

// ============================================================================
// Current Tab Display
// ============================================================================

/**
 * Update current tab display
 */
export function updateCurrentTab() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const infoEl = document.getElementById('currentTabInfo');

    // Update favicon
    const faviconEl = document.getElementById('currentFavicon');
    if (currentTab.favIconUrl) {
        faviconEl.innerHTML = `<img src="${currentTab.favIconUrl}" alt="">`;
    } else {
        faviconEl.innerHTML = '<svg width="16" height="16" style="opacity: 0.3;"><use href="#icon-globe"/></svg>';
    }

    // Update title and URL
    const titleEl = infoEl.querySelector('.tab-title');
    const urlEl = infoEl.querySelector('.tab-url');
    titleEl.textContent = currentTab.title || 'Untitled';

    // Show hostname + path (no query string)
    try {
        const url = new URL(currentTab.url);
        const displayUrl = url.hostname + (url.pathname !== '/' ? url.pathname : '');
        urlEl.textContent = displayUrl;
    } catch {
        urlEl.textContent = currentTab.url;
    }

    // Update countdown
    updateCurrentTabCountdown();

    // Update protect button
    updateProtectButton();
}

// ============================================================================
// Protection Button
// ============================================================================

/**
 * Update protect button state based on current tab's protection status
 */
export function updateProtectButton() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const protectBtn = document.getElementById('protectBtn');
    const protectIcon = document.getElementById('protectIcon');

    // Skip if icon doesn't exist (button might be in Cancel mode)
    if (!protectIcon) return;

    if (state && state.protected) {
        // Tab is protected - show filled shield
        protectIcon.innerHTML = '<use href="#icon-shield-filled"/>';
        protectBtn.classList.add('btn-protected');
        protectBtn.classList.remove('btn-secondary');
        protectBtn.title = 'Unprotect this tab';
    } else {
        // Tab is not protected - show outline shield
        protectIcon.innerHTML = '<use href="#icon-shield"/>';
        protectBtn.classList.remove('btn-protected');
        protectBtn.classList.add('btn-secondary');
        protectBtn.title = 'Protect this tab';
    }
}

// ============================================================================
// Countdown Display
// ============================================================================

/**
 * Update current tab countdown display
 */
export function updateCurrentTabCountdown() {
    if (!currentTab) return;

    const state = tabStates[currentTab.id];
    const countdownEl = document.getElementById('currentTabCountdown');
    const timeEl = countdownEl.querySelector('.countdown-time');

    // Show dash when extension is disabled
    if (!settings.enabled) {
        timeEl.textContent = '—';
        countdownEl.className = 'countdown';
        return;
    }

    if (!state) {
        timeEl.textContent = '—';
        countdownEl.className = 'countdown';
        return;
    }

    if (state.countdown === null) {
        timeEl.textContent = '∞';
        countdownEl.className = 'countdown excluded';
        return;
    }

    if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
        timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg> ' + formatTime(state.countdown);
        countdownEl.className = 'countdown protected';
        return;
    }

    // Calculate remaining time based on background's tracking
    let time;
    if (state.lastActiveTime === null) {
        // Tab is active - show active text like protected
        timeEl.textContent = 'Active';
        countdownEl.className = 'countdown high'; // Green/high color for active
        return;
    } else {
        // Tab is inactive - calculate elapsed time
        const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
        time = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
    }

    timeEl.textContent = formatTime(time);

    // Color coding
    if (time > 180) {
        countdownEl.className = 'countdown high';
    } else if (time > 60) {
        countdownEl.className = 'countdown medium';
    } else {
        countdownEl.className = 'countdown low';
    }
}

/**
 * Update compact tab info in header (when section collapsed)
 */
export function updateCompactTabInfo() {
    const compactFavicon = document.getElementById('compactFavicon');
    const compactTitle = document.getElementById('compactTitle');
    const compactCountdown = document.getElementById('compactCountdown');

    if (!compactTitle || !compactCountdown || !currentTab) return;

    // Set favicon
    if (compactFavicon && currentTab.favIconUrl) {
        compactFavicon.src = currentTab.favIconUrl;
        compactFavicon.style.display = 'block';
    } else if (compactFavicon) {
        compactFavicon.style.display = 'none';
    }

    // Set title (truncated)
    const title = currentTab.title || 'Untitled';
    compactTitle.textContent = title.length > 20 ? title.substring(0, 20) + '…' : title;

    // Determine countdown display
    const state = tabStates[currentTab.id];

    if (!state || currentTab.active) {
        // Active tab
        compactCountdown.textContent = 'Active';
        compactCountdown.className = 'compact-countdown active';
    } else if (state.protected || (state.hasMedia && settings.pauseOnMedia)) {
        // Tab is protected or media playing
        compactCountdown.textContent = state.protected ? 'Protected' : 'Media';
        compactCountdown.className = 'compact-countdown protected';
    } else if (state.countdown !== null && state.countdown > 0) {
        // Has active countdown
        compactCountdown.textContent = formatTime(state.countdown);
        compactCountdown.className = 'compact-countdown countdown';
    } else {
        compactCountdown.textContent = 'Active';
        compactCountdown.className = 'compact-countdown active';
    }
}

// ============================================================================
// Countdown Updates
// ============================================================================

/**
 * Update all countdowns (calculated locally for real-time performance)
 */
export function updateCountdowns() {
    // Update current tab countdown
    updateCurrentTabCountdown();

    // Skip tab list updates when extension is disabled
    if (!settings.enabled) return;

    // Update tab list countdowns
    const statusByTabId = new Map();

    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const partnerTabId = item.dataset.splitPartnerId ? parseInt(item.dataset.splitPartnerId) : null;
        const state = tabStates[tabId];
        const countdownEl = item.querySelector('.countdown');
        const timeEl = countdownEl.querySelector('.countdown-time');
        const tab = allTabs.find(t => t.id === tabId);

        if (!state || state.countdown === null) return;

        // Check if tab is protected (explicit, media, pinned, shared group, or special with setting disabled)
        const isPinnedProtected = tab && tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = tab && isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state.hasMedia && settings.pauseOnMedia;
        const isSharedGroupProtected = Boolean(
            tab && settings.protectSharedGroups && tab.groupId !== -1 && tabGroups[tab.groupId]?.shared
        );
        const isSleeping = Boolean(tab && (tab.discarded || tab.frozen));

        const tabTimeoutAction = state.timeoutAction || settings.timeoutAction || 'close';
        const tabCloseAfterDiscard = state.closeAfterDiscard ?? settings.closeAfterDiscard ?? 1800;

        // Compute status key to avoid duplicating identical Active/Countdown on 2nd Split View row
        let statusKey;
        if (state.protected) statusKey = 'protected:manual';
        else if (isSpecialProtected) statusKey = 'protected:special';
        else if (isPinnedProtected) statusKey = 'protected:pinned';
        else if (isSharedGroupProtected) statusKey = 'protected:shared';
        else if (isMediaProtected) statusKey = 'protected:media';
        else if (tabTimeoutAction === 'discard' && isSleeping) statusKey = 'sleeping';
        else if (state.lastActiveTime === null) statusKey = 'active';
        else {
            const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
            const rem = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
            statusKey = `countdown:${tabTimeoutAction}:${Math.round(rem / 2)}`;
        }
        statusByTabId.set(tabId, statusKey);

        if (partnerTabId && statusByTabId.get(partnerTabId) === statusKey) {
            timeEl.innerHTML = '<span class="split-inline-tag">Split</span>';
            countdownEl.className = 'countdown split-dedup';
            return;
        }

        if (state.protected || isMediaProtected || isPinnedProtected || isSpecialProtected || isSharedGroupProtected) {
            // Protected - show shield icon with label
            let label = 'Protected';
            if (isSpecialProtected) label = 'Special';
            else if (isPinnedProtected) label = 'Pinned';
            else if (isSharedGroupProtected) label = 'Shared';
            else if (isMediaProtected) label = 'Media';
            timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg><span>' + label + '</span>';
            countdownEl.className = 'countdown protected';
            return;
        }

        if (tabTimeoutAction === 'discard' && isSleeping) {
            timeEl.innerHTML = '<span class="time-value">Zzz</span><span>Sleep</span>';
            countdownEl.className = 'countdown sleeping';
            return;
        }

        // Calculate current countdown based on background's tracking
        let remaining;
        let actionLabel = 'Left';
        if (state.lastActiveTime === null) {
            // Tab is active - show eye icon with Active text (vertical stack)
            timeEl.innerHTML = '<svg width="14" height="14" class="active-icon"><use href="#icon-eye"/></svg><span>Active</span>';
            countdownEl.className = 'countdown active';
            return;
        } else if (tabTimeoutAction === 'discard_then_close' && (state.discardedAt || isSleeping)) {
            const sleepElapsed = state.discardedAt ? Math.floor((Date.now() - state.discardedAt) / 1000) : 0;
            remaining = Math.max(0, tabCloseAfterDiscard - sleepElapsed);
            actionLabel = 'Close';
        } else {
            // Tab is inactive - calculate elapsed time
            const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
            remaining = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
            if (tabTimeoutAction === 'discard' || tabTimeoutAction === 'discard_then_close') {
                actionLabel = 'Sleep';
            }
        }

        timeEl.innerHTML = '<span class="time-value">' + formatTime(remaining) + '</span><span>' + actionLabel + '</span>';

        // Update color
        countdownEl.className = 'countdown';
        if (remaining > 180) countdownEl.classList.add('high');
        else if (remaining > 60) countdownEl.classList.add('medium');
        else countdownEl.classList.add('low');
    });
}

// ============================================================================
// State Refresh
// ============================================================================

/**
 * Refresh tab states from background
 */
export async function refreshTabStates() {
    const response = await chrome.runtime.sendMessage({ type: 'getTabStates' });
    if (response.success) {
        setTabStates(response.data);
    }
}
