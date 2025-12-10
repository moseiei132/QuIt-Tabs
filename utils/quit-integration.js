/**
 * QuIt App Integration Utility
 * Handles parsing and validation of QuIt-specific URL parameters
 */

// Valid Chrome tab group colors
const VALID_COLORS = [
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange'
];

const DEFAULT_COLOR = 'grey';

/**
 * Parse QuIt parameters from a URL
 * @param {string} urlString - The URL to parse
 * @returns {Object|null} - Parsed parameters or null if no quit_group found
 */
export function parseQuitParams(urlString) {
    try {
        const url = new URL(urlString);
        const params = url.searchParams;

        // Check if quit_group exists (required for feature activation)
        const group = params.get('quit_group');
        if (!group) {
            return null;
        }

        // Parse optional parameters
        const color = params.get('quit_color');
        const pause = params.get('quit_pause');

        return {
            group: group.trim(),
            color: validateGroupColor(color),
            pause: pause === 'true',
            hasParams: true
        };
    } catch (error) {
        console.error('Error parsing QuIt params:', error);
        return null;
    }
}

/**
 * Remove QuIt parameters from URL
 * @param {string} urlString - The URL to clean
 * @returns {string} - Cleaned URL without quit_* parameters
 */
export function cleanQuitParams(urlString) {
    try {
        const url = new URL(urlString);

        // Remove all quit_* parameters
        url.searchParams.delete('quit_group');
        url.searchParams.delete('quit_color');
        url.searchParams.delete('quit_pause');

        return url.toString();
    } catch (error) {
        console.error('Error cleaning QuIt params:', error);
        return urlString;
    }
}

/**
 * Validate group color against Chrome API options
 * @param {string|null} color - Color to validate
 * @returns {string} - Valid color or default
 */
export function validateGroupColor(color) {
    if (!color) {
        return DEFAULT_COLOR;
    }

    const normalized = color.toLowerCase().trim();
    return VALID_COLORS.includes(normalized) ? normalized : DEFAULT_COLOR;
}

/**
 * Check if URL has QuIt parameters
 * @param {string} urlString - The URL to check
 * @returns {boolean} - True if URL has quit_group parameter
 */
export function hasQuitParams(urlString) {
    try {
        const url = new URL(urlString);
        return url.searchParams.has('quit_group');
    } catch (error) {
        return false;
    }
}
