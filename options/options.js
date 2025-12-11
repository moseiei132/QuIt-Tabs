import { getSettings, saveSettings } from '../utils/storage.js';

let settings = {};

// Initialize options page
async function init() {
    try {
        settings = await getSettings();
        renderSettings();
        setupEventListeners();
    } catch (error) {
        console.error('Error initializing options page:', error);
    }
}

// Render general settings
function renderSettings() {
    document.getElementById('enabledToggle').checked = settings.enabled;
    document.getElementById('globalCountdown').value = settings.globalCountdown / 60;
    document.getElementById('countdownValue').textContent = settings.globalCountdown / 60;
    document.getElementById('autoClosePinned').checked = settings.autoClosePinned;
    document.getElementById('pauseOnMedia').checked = settings.pauseOnMedia;
}

// Setup event listeners
function setupEventListeners() {
    // Enabled toggle
    document.getElementById('enabledToggle').addEventListener('change', async (e) => {
        console.log('Enable toggle changed:', e.target.checked);
        settings.enabled = e.target.checked;
        await saveSettings(settings);
        console.log('Settings saved:', settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Global countdown slider
    const slider = document.getElementById('globalCountdown');
    const valueDisplay = document.getElementById('countdownValue');

    slider.addEventListener('input', (e) => {
        valueDisplay.textContent = e.target.value;
    });

    slider.addEventListener('change', async (e) => {
        settings.globalCountdown = parseInt(e.target.value) * 60;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Auto-close pinned toggle
    document.getElementById('autoClosePinned').addEventListener('change', async (e) => {
        settings.autoClosePinned = e.target.checked;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });

    // Pause on media toggle
    document.getElementById('pauseOnMedia').addEventListener('change', async (e) => {
        settings.pauseOnMedia = e.target.checked;
        await saveSettings(settings);
        await notifyBackgroundSettingsChanged();
        showSaveStatus('Settings saved');
    });
}

// Notify background script that settings changed
async function notifyBackgroundSettingsChanged() {
    try {
        await chrome.runtime.sendMessage({ type: 'settingsUpdated' });
    } catch (error) {
        console.error('Error notifying background:', error);
    }
}

// Show save status message
function showSaveStatus(message) {
    const status = document.getElementById('saveStatus');
    status.textContent = message;
    status.style.opacity = '1';

    setTimeout(() => {
        status.style.opacity = '0';
    }, 2000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
