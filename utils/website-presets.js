/**
 * Website-specific preset system for customizing exclusion rule UI labels
 * Presets are fetched from GitHub and cached locally (24hr TTL + first launch)
 */

// Remote preset configuration
const REMOTE_PRESET_URL = 'https://raw.githubusercontent.com/moseiei132/QuIt-Tabs/refs/heads/main/website-presets.json';
const PRESET_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Built-in presets for popular websites (fallback if remote fetch fails)
const BUILT_IN_PRESETS = {
    'youtube': {
        id: 'youtube',
        domains: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
        labels: {
            path_exact: {
                title: 'Just this video',
                description: '{hostname}{pathname}'
            },
            domain_path: {
                title: 'All videos',
                description: 'Any video on YouTube'
            },
            domain_all: {
                title: 'Entire YouTube',
                description: 'youtube.com + all related sites'
            },
            regex: {
                title: 'Custom pattern (advanced)',
                description: 'Use your own regex pattern'
            }
        }
    },
    'github': {
        id: 'github',
        domains: ['github.com', 'www.github.com'],
        labels: {
            path_exact: {
                title: 'Just this repository',
                description: '{hostname}{pathname}'
            },
            domain_path: {
                title: 'All of GitHub',
                description: 'Any page on GitHub'
            },
            domain_all: {
                title: 'GitHub + subdomains',
                description: 'github.com + api.github.com, etc.'
            },
            regex: {
                title: 'Custom pattern (advanced)',
                description: 'Use your own regex pattern'
            }
        }
    },
    'reddit': {
        id: 'reddit',
        domains: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com'],
        labels: {
            path_exact: {
                title: 'Just this post',
                description: '{hostname}{pathname}'
            },
            domain_path: {
                title: 'All of Reddit',
                description: 'Any page on Reddit'
            },
            domain_all: {
                title: 'Reddit + subdomains',
                description: 'reddit.com + all variants'
            },
            regex: {
                title: 'Custom pattern (advanced)',
                description: 'Use your own regex pattern'
            }
        }
    },
    'stackoverflow': {
        id: 'stackoverflow',
        domains: ['stackoverflow.com', 'www.stackoverflow.com'],
        labels: {
            path_exact: {
                title: 'Just this question',
                description: '{hostname}{pathname}'
            },
            domain_path: {
                title: 'All Stack Overflow',
                description: 'Any page on Stack Overflow'
            },
            domain_all: {
                title: 'All Stack Exchange sites',
                description: 'stackoverflow.com + stackexchange.com'
            },
            regex: {
                title: 'Custom pattern (advanced)',
                description: 'Use your own regex pattern'
            }
        }
    }
};

/**
 * Get preset for a given URL
 * @param {string} urlString - URL to find preset for
 * @returns {Object|null} Preset object or null if no match
 */
export async function getPresetForUrl(urlString) {
    try {
        const url = new URL(urlString);
        const hostname = url.hostname;

        // Get all available presets (remote + built-in)
        const presets = await getAllPresets();

        // Find matching preset
        for (const preset of Object.values(presets)) {
            if (preset.domains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
                return preset;
            }
        }

        return null; // No preset found
    } catch (error) {
        console.error('Error getting preset for URL:', error);
        return null;
    }
}

/**
 * Get all available presets (remote + built-in)
 * Fetches remote presets if cache is expired or missing
 * @returns {Promise<Object>} All presets keyed by preset ID
 */
export async function getAllPresets() {
    // Try to get cached presets
    const cached = await getCachedPresets();

    if (cached) {
        return cached;
    }

    // Cache miss or expired - fetch remote presets
    try {
        const remotePresets = await fetchRemotePresets();

        // Merge remote with built-in (remote takes precedence)
        const allPresets = { ...BUILT_IN_PRESETS, ...remotePresets };

        // Update cache
        await updatePresetCache(allPresets);

        return allPresets;
    } catch (error) {
        console.error('Failed to fetch remote presets, using built-in only:', error);

        // Cache built-in presets (short TTL for retry)
        await updatePresetCache(BUILT_IN_PRESETS, 60 * 60 * 1000); // 1 hour retry

        return BUILT_IN_PRESETS;
    }
}

/**
 * Fetch remote presets from GitHub
 * @returns {Promise<Object>} Remote presets keyed by preset ID
 */
async function fetchRemotePresets() {
    try {
        const response = await fetch(REMOTE_PRESET_URL, {
            cache: 'no-cache',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Validate and convert to keyed object
        if (!data.presets || !Array.isArray(data.presets)) {
            throw new Error('Invalid preset format: missing presets array');
        }

        const presetsObject = {};

        // Preserve metadata
        if (data.version) presetsObject.version = data.version;
        if (data.lastUpdated) presetsObject.lastUpdated = data.lastUpdated;

        // Convert array to keyed object
        data.presets.forEach(preset => {
            if (preset.id && preset.domains && preset.labels) {
                presetsObject[preset.id] = preset;
            }
        });

        console.log('QuIt: Fetched', Object.keys(presetsObject).filter(k => k !== 'version' && k !== 'lastUpdated').length, 'remote presets');
        return presetsObject;
    } catch (error) {
        console.error('Error fetching remote presets:', error);
        throw error;
    }
}

/**
 * Get cached presets from local storage
 * @returns {Promise<Object|null>} Cached presets or null if expired/missing
 */
async function getCachedPresets() {
    try {
        const result = await chrome.storage.local.get('presetCache');

        if (!result.presetCache) {
            console.log('QuIt: No preset cache found (first launch)');
            return null; // First launch - no cache
        }

        const cache = result.presetCache;
        const now = Date.now();
        const age = now - (cache.lastFetched || 0);

        // Check if cache is still valid
        if (age < (cache.ttl || PRESET_CACHE_TTL)) {
            console.log('QuIt: Using cached presets (age:', Math.round(age / 1000 / 60), 'minutes)');
            return cache.presets;
        }

        console.log('QuIt: Preset cache expired (age:', Math.round(age / 1000 / 60 / 60), 'hours)');
        return null; // Cache expired
    } catch (error) {
        console.error('Error reading preset cache:', error);
        return null;
    }
}

/**
 * Update preset cache in local storage
 * @param {Object} presets - Presets to cache
 * @param {number} ttl - Optional custom TTL in milliseconds
 * @returns {Promise<void>}
 */
async function updatePresetCache(presets, ttl = PRESET_CACHE_TTL) {
    try {
        const cache = {
            presets: presets,
            lastFetched: Date.now(),
            ttl: ttl
        };

        await chrome.storage.local.set({ presetCache: cache });
        console.log('QuIt: Preset cache updated');
    } catch (error) {
        console.error('Error updating preset cache:', error);
    }
}

/**
 * Clear preset cache (for testing or manual refresh)
 * @returns {Promise<void>}
 */
export async function clearPresetCache() {
    try {
        await chrome.storage.local.remove('presetCache');
        console.log('QuIt: Preset cache cleared');
    } catch (error) {
        console.error('Error clearing preset cache:', error);
    }
}

/**
 * Force refresh presets from remote (ignores cache)
 * @returns {Promise<Object>} Refreshed presets object
 */
export async function forceRefreshPresets() {
    try {
        console.log('QuIt: Forcing preset refresh...');

        // Fetch fresh presets
        const remotePresets = await fetchRemotePresets();

        // Merge with built-in
        const allPresets = { ...BUILT_IN_PRESETS, ...remotePresets };

        // Update cache with normal TTL
        await updatePresetCache(allPresets);

        console.log('QuIt: Presets refreshed successfully');
        return allPresets;
    } catch (error) {
        console.error('QuIt: Force refresh failed:', error);
        throw error;
    }
}

/**
 * Get preset cache metadata (for display in settings)
 * @returns {Promise<Object|null>} Cache metadata or null
 */
export async function getPresetCacheMetadata() {
    try {
        const result = await chrome.storage.local.get('presetCache');
        if (!result.presetCache) {
            return null;
        }

        const cache = result.presetCache;
        const presets = cache.presets || {};

        return {
            version: presets.version || 'Unknown',
            lastUpdated: presets.lastUpdated || 'Unknown',
            lastFetched: cache.lastFetched || null,
            presetCount: Object.keys(presets).filter(k => k !== 'version' && k !== 'lastUpdated').length,
            ttl: cache.ttl || PRESET_CACHE_TTL
        };
    } catch (error) {
        console.error('Error getting preset metadata:', error);
        return null;
    }
}

/**
 * Apply template variables to a label string
 * @param {string} template - Template string with {variables}
 * @param {string} urlString - URL to extract variables from
 * @returns {string} Processed string
 */
export function applyLabelTemplate(template, urlString) {
    try {
        const url = new URL(urlString);

        return template
            .replace(/{hostname}/g, url.hostname)
            .replace(/{pathname}/g, url.pathname)
            .replace(/{domain}/g, url.hostname.split('.').slice(-2).join('.'));
    } catch (error) {
        return template;
    }
}
