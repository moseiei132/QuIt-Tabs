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
import { applyTheme } from './modules/settings.js';

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

        // Apply theme immediately before rendering
        applyTheme(settings.theme || 'system');

        await refreshTabStates();

        // Load all tabs
        await loadAllTabs();

        // Update current tab display
        updateCurrentTab();

        // Update extension status in footer
        updateExtensionStatus();

        // Set up event listeners
        setupEventListeners();

        // Show What's New banner if this is first open after an update
        await showWhatsNewBanner();

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
            // Reload if title, URL, Split View, or sleep/freeze status changed
            if (
                changeInfo.title ||
                changeInfo.url ||
                changeInfo.splitViewId !== undefined ||
                changeInfo.discarded !== undefined ||
                changeInfo.frozen !== undefined
            ) {
                await loadAllTabs();
                await refreshTabStates();
                
                // If current tab updated, update our reference
                import('./modules/state.js').then(async ({ currentTab, setCurrentTab }) => {
                    if (currentTab && currentTab.id === tabId) {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab) {
                            setCurrentTab(tab);
                            import('./modules/currentTab.js').then(({ updateCurrentTab }) => updateCurrentTab());
                        }
                    }
                });
            }
        });
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            const [tab] = await chrome.tabs.query({ active: true, windowId: activeInfo.windowId });
            if (tab) {
                setCurrentTab(tab);
                await refreshTabStates();
                updateCurrentTab();
                await loadAllTabs(); // Refresh list to update active highlight
            }
        });

        // Live sync when Chrome Tab Groups change (created, renamed, colored, shared, removed)
        if (chrome.tabGroups) {
            const refreshGroups = async () => {
                await loadAllTabs();
            };
            chrome.tabGroups.onCreated?.addListener(refreshGroups);
            chrome.tabGroups.onUpdated?.addListener(refreshGroups);
            chrome.tabGroups.onRemoved?.addListener(refreshGroups);
        }

        // Listen for state updates from background (context menus, shortcuts, split view, rules)
        chrome.runtime.onMessage.addListener(async (message) => {
            if (message.type === 'stateUpdated') {
                await refreshTabStates();
                updateCurrentTab();
                renderTabsList();
            }
        });
    } catch (error) {
        console.error('Error initializing popup:', error);
    }
}

// ============================================================================
// What's New Banner
// ============================================================================

// ⬇️  Bump this ONLY when you want to show a banner (new feature releases).
// Leave unchanged for bug-fix releases → no banner appears.
const WHATS_NEW_VERSION = '1.6.0';

async function showWhatsNewBanner() {
    const { whatsNewDismissedVersion } = await chrome.storage.local.get('whatsNewDismissedVersion');
    // Show only if this version's banner hasn't been dismissed yet
    if (whatsNewDismissedVersion === WHATS_NEW_VERSION) return;

    const banner = document.getElementById('whatsNewBanner');
    const dismissBtn = document.getElementById('whatsNewDismiss');
    const openChangelogEl = document.getElementById('whatsNewOpenChangelog');
    if (!banner) return;

    // Show banner with slide-in animation
    banner.style.display = 'flex';
    requestAnimationFrame(() => banner.classList.add('visible'));

    const dismissBanner = async () => {
        banner.classList.remove('visible');
        setTimeout(() => { banner.style.display = 'none'; }, 250);
        await chrome.storage.local.set({ whatsNewDismissedVersion: WHATS_NEW_VERSION });
    };

    // Click banner body: open full changelog in a new tab & dismiss banner
    openChangelogEl?.addEventListener('click', async () => {
        await dismissBanner();
        await chrome.tabs.create({ url: chrome.runtime.getURL('changelog/changelog.html') });
    });

    // On dismiss: save dismissed version so banner never shows for this version again
    dismissBtn?.addEventListener('click', dismissBanner);
}


// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
