/**
 * Utility Functions Module
 * Common utility functions used across multiple modules
 */

import { settings } from './state.js';

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format seconds into MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
    if (seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// HTML Utilities
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// Tab Utilities
// ============================================================================

/**
 * Check if a tab is a special tab (extension, new tab, chrome:// etc.)
 * @param {chrome.tabs.Tab} tab - Tab to check
 * @returns {boolean} True if tab is special
 */
export function isSpecialTab(tab) {
    if (!tab.url) return true;
    const url = tab.url.toLowerCase();
    return url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://') ||
        url === 'chrome://newtab/';
}

// ============================================================================
// UI Status Updates
// ============================================================================

/**
 * Update extension status indicator in footer
 */
export function updateExtensionStatus() {
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');

    if (settings.enabled) {
        statusIndicator.className = 'status-indicator active';
        statusText.textContent = 'Active';
    } else {
        statusIndicator.className = 'status-indicator disabled';
        statusText.textContent = 'Disabled';
    }
}
