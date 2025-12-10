// Default configuration
const DEFAULT_SETTINGS = {
  enabled: true,
  globalCountdown: 300, // 5 minutes in seconds
  autoClosePinned: false,
  pauseOnMedia: true,
  exclusionRules: []
};

// Exclusion rule structure:
// {
//   id: string (UUID),
//   type: 'domain' | 'subdomain' | 'domain_all' | 'path' | 'exact',
//   pattern: string,
//   customCountdown: number | null, // null = never close
//   enabled: boolean
// }

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
 * Add a new exclusion rule
 * @param {Object} rule - Exclusion rule object
 * @returns {Promise<void>}
 */
export async function addExclusionRule(rule) {
  const settings = await getSettings();
  const newRule = {
    id: generateUUID(),
    enabled: true,
    ...rule
  };
  settings.exclusionRules.push(newRule);
  await saveSettings(settings);
  return newRule;
}

/**
 * Remove an exclusion rule
 * @param {string} ruleId - Rule ID to remove
 * @returns {Promise<void>}
 */
export async function removeExclusionRule(ruleId) {
  const settings = await getSettings();
  settings.exclusionRules = settings.exclusionRules.filter(r => r.id !== ruleId);
  await saveSettings(settings);
}

/**
 * Update an exclusion rule
 * @param {string} ruleId - Rule ID to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export async function updateExclusionRule(ruleId, updates) {
  const settings = await getSettings();
  const ruleIndex = settings.exclusionRules.findIndex(r => r.id === ruleId);
  if (ruleIndex !== -1) {
    settings.exclusionRules[ruleIndex] = {
      ...settings.exclusionRules[ruleIndex],
      ...updates
    };
    await saveSettings(settings);
  }
}

/**
 * Generate a simple UUID
 * @returns {string} UUID string
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
