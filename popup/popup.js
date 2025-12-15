/**
 * QuIt-Tabs Popup - Main Entry Point
 * 
 * This file orchestrates all the popup modules and initializes the extension popup.
 * The actual functionality is split into modules in the ./modules/ directory.
 */

import { getSettings } from '../utils/storage.js';
import {
    setCurrentTab, setSettings, setTabStates
} from './modules/state.js';
import { loadAllTabs, renderTabsList } from './modules/tabs.js';
import {
    updateCurrentTab, updateCountdowns, refreshTabStates
} from './modules/currentTab.js';
import { updateExtensionStatus } from './modules/utils.js';
import { setupEventListeners } from './modules/events.js';

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the popup
 */
async function init() {
    try {
        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        setCurrentTab(tabs[0]);

        // Get settings and tab states from background
        const settings = await getSettings();
        setSettings(settings);
        await refreshTabStates();

        // Load all tabs
        await loadAllTabs();

        // Update current tab display
        updateCurrentTab();

        // Update extension status in footer
        updateExtensionStatus();

        // Set up event listeners
        setupEventListeners();

        // Start real-time countdown updates (local calculation, no polling!)
        setInterval(updateCountdowns, 1000);

        // Listen for tab changes to refresh states
        chrome.tabs.onCreated.addListener(async () => {
            await loadAllTabs();
            await refreshTabStates();
        });
        chrome.tabs.onRemoved.addListener(async () => {
            await loadAllTabs();
            await refreshTabStates();
        });
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
            // Only reload if title or URL changed
            if (changeInfo.title || changeInfo.url) {
                await loadAllTabs();
                await refreshTabStates();
            }
        });

        // Listen for state updates from background (when rules change, etc.)
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'stateUpdated') {
                refreshTabStates();
            }
        });
    } catch (error) {
        console.error('Error initializing popup:', error);
    }
}

// ============================================================================
// Bootstrap
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
