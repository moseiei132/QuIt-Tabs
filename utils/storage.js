// Default configuration
const DEFAULT_SETTINGS = {
  enabled: true,
  globalCountdown: 300, // 5 minutes in seconds
  autoClosePinned: false,
  pauseOnMedia: true
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
