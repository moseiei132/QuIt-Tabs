// Default configuration
const DEFAULT_SETTINGS = {
  enabled: true,
  globalCountdown: 3600, // 1 hour in seconds
  autoClosePinned: false,
  autoCloseSpecial: true, // Special tabs: extensions, new tab, chrome:// pages
  pauseOnMedia: true,
  focusedWindowOnly: true, // Only active tab in focused window is truly active
  protectSharedGroups: true, // Auto-protect tabs inside Chrome Shared Tab Groups
  timeoutAction: 'close', // 'close' | 'discard' | 'discard_then_close'
  closeAfterDiscard: 1800, // 30 minutes in seconds (used in 2-step Sleep -> Close mode)
  historyRetentionDays: 7, // Keep history for 7 days
  perSiteTimeouts: [], // Array of { pattern: string, timeout: number (seconds) }
  theme: 'system' // 'system' | 'light' | 'dark'
};

/**
 * Get settings from storage
 * @returns {Promise<Object>} Settings object
 */
export async function getSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    return { ...DEFAULT_SETTINGS, ...result.settings };
  } catch (error) {
    console.error('Error loading settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to storage
 * @param {Object} settings - Settings object to save
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  try {
    await chrome.storage.sync.set({ settings });
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

/**
 * Get tab states from local storage
 * @returns {Promise<Object>} Tab states object
 */
export async function getTabStates() {
  try {
    const result = await chrome.storage.local.get('tabStates');
    return result.tabStates || {};
  } catch (error) {
    console.error('Error loading tab states:', error);
    return {};
  }
}

/**
 * Save tab states to local storage
 * @param {Object} tabStates - Tab states object
 * @returns {Promise<void>}
 */
export async function saveTabStates(tabStates) {
  try {
    await chrome.storage.local.set({ tabStates });
  } catch (error) {
    console.error('Error saving tab states:', error);
  }
}

/**
 * Get MV3 service worker session state (survives worker suspension)
 * @returns {Promise<{ activeTabsByWindow: Object, focusedWindowId: number|null }>}
 */
export async function getSessionState() {
  try {
    if (!chrome.storage?.session) {
      return { activeTabsByWindow: {}, focusedWindowId: null };
    }
    const result = await chrome.storage.session.get(['activeTabsByWindow', 'focusedWindowId']);
    return {
      activeTabsByWindow: result.activeTabsByWindow || {},
      focusedWindowId: result.focusedWindowId ?? null
    };
  } catch (error) {
    console.error('Error loading session state:', error);
    return { activeTabsByWindow: {}, focusedWindowId: null };
  }
}

/**
 * Save MV3 service worker session state
 * @param {{ activeTabsByWindow: Object, focusedWindowId: number|null }} state
 * @returns {Promise<void>}
 */
export async function saveSessionState(state) {
  try {
    if (!chrome.storage?.session) return;
    await chrome.storage.session.set({
      activeTabsByWindow: state.activeTabsByWindow || {},
      focusedWindowId: state.focusedWindowId ?? null
    });
  } catch (error) {
    console.error('Error saving session state:', error);
  }
}

/**
 * Get history from local storage
 * @returns {Promise<Array>} Array of history entries
 */
export async function getHistory() {
  try {
    const result = await chrome.storage.local.get('history');
    return result.history || [];
  } catch (error) {
    console.error('Error loading history:', error);
    return [];
  }
}

/**
 * Save history to local storage
 * @param {Array} history - Array of history entries
 * @returns {Promise<void>}
 */
export async function saveHistory(history) {
  try {
    await chrome.storage.local.set({ history });
  } catch (error) {
    console.error('Error saving history:', error);
  }
}

/**
 * Add a history entry
 * @param {Object} entry - History entry object
 * @param {string} entry.url - Tab URL
 * @param {string} entry.title - Tab title
 * @param {string} entry.favicon - Tab favicon URL
 * @param {string} entry.closeReason - Close reason: 'manual_browser', 'manual_quit', 'timeout', 'batch_close'
 * @param {number} entry.windowId - Window ID
 * @param {number} entry.groupId - Tab group ID
 * @returns {Promise<void>}
 */
export async function addHistoryEntry(entry) {
  try {
    const settings = await getSettings();
    const history = await getHistory();

    // Create new entry with timestamp and unique ID
    const newEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url: entry.url,
      title: entry.title || 'Untitled',
      favicon: entry.favicon || '',
      closeReason: entry.closeReason,
      timestamp: Date.now(),
      windowId: entry.windowId || null,
      groupId: entry.groupId || null
    };

    // Add to beginning of array (most recent first)
    history.unshift(newEntry);

    // Clean up old entries (older than retention period)
    const cutoffTime = Date.now() - (settings.historyRetentionDays * 24 * 60 * 60 * 1000);
    const filteredHistory = history.filter(h => h.timestamp >= cutoffTime);

    await saveHistory(filteredHistory);
  } catch (error) {
    console.error('Error adding history entry:', error);
  }
}

/**
 * Clear all history
 * @returns {Promise<void>}
 */
export async function clearHistory() {
  try {
    await chrome.storage.local.set({ history: [] });
  } catch (error) {
    console.error('Error clearing history:', error);
  }
}

/**
 * Resolve effective timeout & action rule for a specific URL.
 * Backward-compatible with legacy rules `{ pattern, timeout }`.
 * @param {string} url
 * @param {Object} settings
 * @returns {Promise<{ timeout: number, timeoutAction: string, closeAfterDiscard: number }>}
 */
export async function getRuleForUrl(url, settings = null) {
  const effectiveSettings = settings || await getSettings();
  const fallback = {
    timeout: effectiveSettings.globalCountdown ?? DEFAULT_SETTINGS.globalCountdown,
    timeoutAction: effectiveSettings.timeoutAction || DEFAULT_SETTINGS.timeoutAction,
    closeAfterDiscard: effectiveSettings.closeAfterDiscard ?? DEFAULT_SETTINGS.closeAfterDiscard
  };

  try {
    let domain;
    try {
      domain = new URL(url).hostname;
    } catch {
      return fallback;
    }

    for (const rule of effectiveSettings.perSiteTimeouts || []) {
      if (matchesPattern(domain, rule.pattern)) {
        // Legacy rules had no timeoutMode -> treat as 'custom'
        const timeoutMode = rule.timeoutMode || 'custom';
        const actionMode = rule.actionMode || 'global';

        const timeout = timeoutMode === 'global'
          ? fallback.timeout
          : (rule.timeout ?? fallback.timeout);

        const timeoutAction = actionMode === 'global'
          ? fallback.timeoutAction
          : actionMode;

        const closeAfterDiscard = actionMode === 'discard_then_close'
          ? (rule.closeAfterDiscard ?? fallback.closeAfterDiscard)
          : fallback.closeAfterDiscard;

        return { timeout, timeoutAction, closeAfterDiscard };
      }
    }

    return fallback;
  } catch (error) {
    console.error('Error resolving rule for URL:', error);
    return fallback;
  }
}

/**
 * Get the timeout value for a specific URL
 * Checks perSiteTimeouts and returns the first matching rule's timeout,
 * or returns the global countdown if no match found
 * @param {string} url - The URL to check
 * @param {Object} settings - Settings object (optional, will fetch if not provided)
 * @returns {Promise<number>} Timeout in seconds
 */
export async function getTimeoutForUrl(url, settings = null) {
  const rule = await getRuleForUrl(url, settings);
  return rule.timeout;
}

/**
 * Check if a domain matches a pattern
 * Supports wildcards: *.example.com matches any subdomain of example.com
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against
 * @returns {boolean} True if domain matches pattern
 */
function matchesPattern(domain, pattern) {
  // Exact match
  if (domain === pattern) return true;

  // Wildcard pattern
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.substring(2);
    // Matches if domain is exactly baseDomain or ends with .baseDomain
    return domain === baseDomain || domain.endsWith('.' + baseDomain);
  }

  return false;
}

/**
 * Add a per-site timeout rule
 * @param {string} pattern - URL pattern (e.g., "example.com" or "*.example.com")
 * @param {number} timeout - Timeout in seconds
 * @returns {Promise<void>}
 */
export async function addPerSiteTimeout(pattern, timeout) {
  try {
    const settings = await getSettings();

    // Remove any existing rule for this pattern
    settings.perSiteTimeouts = (settings.perSiteTimeouts || []).filter(
      rule => rule.pattern !== pattern
    );

    // Add new rule
    settings.perSiteTimeouts.push({ pattern, timeout });

    await saveSettings(settings);
  } catch (error) {
    console.error('Error adding per-site timeout:', error);
    throw error;
  }
}

/**
 * Remove a per-site timeout rule
 * @param {string} pattern - URL pattern to remove
 * @returns {Promise<void>}
 */
export async function removePerSiteTimeout(pattern) {
  try {
    const settings = await getSettings();

    settings.perSiteTimeouts = (settings.perSiteTimeouts || []).filter(
      rule => rule.pattern !== pattern
    );

    await saveSettings(settings);
  } catch (error) {
    console.error('Error removing per-site timeout:', error);
    throw error;
  }
}

/**
 * Get all per-site timeout rules
 * @returns {Promise<Array>} Array of { pattern, timeout } objects
 */
export async function getPerSiteTimeouts() {
  try {
    const settings = await getSettings();
    return settings.perSiteTimeouts || [];
  } catch (error) {
    console.error('Error getting per-site timeouts:', error);
    return [];
  }
}

