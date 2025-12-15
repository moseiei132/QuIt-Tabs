/**
 * Current Tab Module
 * Current tab display, countdown updates, and protection UI
 */

import {
    currentTab, tabStates, settings, allTabs,
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
    document.querySelectorAll('.tab-item').forEach(item => {
        const tabId = parseInt(item.dataset.tabId);
        const state = tabStates[tabId];
        const countdownEl = item.querySelector('.countdown');
        const timeEl = countdownEl.querySelector('.countdown-time');
        const tab = allTabs.find(t => t.id === tabId);

        if (!state || state.countdown === null) return;

        // Check if tab is protected (explicit, media, pinned, or special with setting disabled)
        const isPinnedProtected = tab && tab.pinned && !settings.autoClosePinned;
        const isSpecialProtected = tab && isSpecialTab(tab) && !settings.autoCloseSpecial;
        const isMediaProtected = state.hasMedia && settings.pauseOnMedia;

        if (state.protected || isMediaProtected || isPinnedProtected || isSpecialProtected) {
            // Protected - show shield icon with label
            let label = 'Protected';
            if (isSpecialProtected) label = 'Special';
            else if (isPinnedProtected) label = 'Pinned';
            else if (isMediaProtected) label = 'Media';
            timeEl.innerHTML = '<svg width="14" height="14" class="shield-icon"><use href="#icon-shield-filled"/></svg><span>' + label + '</span>';
            countdownEl.className = 'countdown protected';
            return;
        }

        // Calculate current countdown based on background's tracking
        let remaining;
        if (state.lastActiveTime === null) {
            // Tab is active - show eye icon with Active text (vertical stack)
            timeEl.innerHTML = '<svg width="14" height="14" class="active-icon"><use href="#icon-eye"/></svg><span>Active</span>';
            countdownEl.className = 'countdown active';
            return;
        } else {
            // Tab is inactive - calculate elapsed time
            const inactiveTime = Math.floor((Date.now() - state.lastActiveTime) / 1000);
            remaining = Math.max(0, (state.initialCountdown || state.countdown) - inactiveTime);
        }

        timeEl.innerHTML = '<span class="time-value">' + formatTime(remaining) + '</span><span>Left</span>';

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
