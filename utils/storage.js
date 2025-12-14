// Default configuration
const DEFAULT_SETTINGS = {
  enabled: true,
  globalCountdown: 3600, // 1 hour in seconds
  autoClosePinned: false,
  autoCloseSpecial: true, // Special tabs: extensions, new tab, chrome:// pages
  pauseOnMedia: true,
  focusedWindowOnly: true, // Only active tab in focused window is truly active
  historyRetentionDays: 7, // Keep history for 7 days
  perSiteTimeouts: [] // Array of { pattern: string, timeout: number (seconds) }
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
 * Get the timeout value for a specific URL
 * Checks perSiteTimeouts and returns the first matching rule's timeout,
 * or returns the global countdown if no match found
 * @param {string} url - The URL to check
 * @param {Object} settings - Settings object (optional, will fetch if not provided)
 * @returns {Promise<number>} Timeout in seconds
 */
export async function getTimeoutForUrl(url, settings = null) {
  try {
    if (!settings) {
      settings = await getSettings();
    }

    // Extract domain from URL
    let domain;
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname;
    } catch {
      return settings.globalCountdown;
    }

    // Check if URL matches any per-site timeout pattern
    for (const rule of settings.perSiteTimeouts || []) {
      if (matchesPattern(domain, rule.pattern)) {
        return rule.timeout;
      }
    }

    // No match, return global countdown
    return settings.globalCountdown;
  } catch (error) {
    console.error('Error getting timeout for URL:', error);
    return settings?.globalCountdown || DEFAULT_SETTINGS.globalCountdown;
  }
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

