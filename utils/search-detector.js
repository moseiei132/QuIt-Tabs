/**
 * Detect if a URL is likely a search results page
 * based on common query parameters used by search engines and websites
 */

// Popular search query parameters used by various search engines and websites
const COMMON_SEARCH_PARAMS = [
    // General search
    'q',           // Google, DuckDuckGo, Bing, Yahoo, etc.
    'query',       // Various sites
    'search',      // Generic search
    's',           // WordPress, many blogs
    'keyword',     // Many e-commerce sites
    'keywords',    // Amazon, eBay variants

    // Search variations
    'searchBy',    // Custom apps (search by field)
    'searchType',  // Custom apps (search type)
    'searchQuery', // Custom apps (search query)
    'searchtext',  // Search text
    'searchterm',  // Search term variant

    // Specific search engines
    'p',           // Yahoo (alternate)
    'text',        // Yandex
    'w',           // Baidu
    'wd',          // Baidu (alternate)

    // Pagination (common on search results)
    'page',        // Generic pagination
    'pg',          // Pagination variant
    'offset',      // Pagination offset
    'start',       // Google pagination

    // Filters (common on search results)
    'filter',      // Generic filter
    'filters',     // Multiple filters
    'category',    // Category filter
    'sort',        // Sort order
    'sortBy',      // Sort by field
    'sortOrder',   // Sort order direction
    'order',       // Order direction
    'orderBy',     // Order by field

    // E-commerce search
    'sSearch',     // DataTables
    'search_query', // YouTube
    'ssPageName',  // eBay
    '_nkw',        // eBay
    'field-keywords', // Amazon

    // Social media search
    'src',         // Twitter/X search
    'qid',         // LinkedIn

    // Other common search indicators
    'term',        // Search term
    'aiEnabled',   // AI search toggle
];

/**
 * Check if a URL contains search-related query parameters
 * @param {string} urlString - The URL to check
 * @returns {boolean} - True if URL appears to be a search page
 */
export function isSearchUrl(urlString) {
    try {
        const url = new URL(urlString);
        const searchParams = url.searchParams;

        // Check if URL has any search-related parameters
        for (const param of COMMON_SEARCH_PARAMS) {
            if (searchParams.has(param)) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Error checking search URL:', error);
        return false;
    }
}

/**
 * Get the detected search parameters from a URL
 * @param {string} urlString - The URL to check
 * @returns {string[]} - Array of detected search parameter names
 */
export function getSearchParams(urlString) {
    try {
        const url = new URL(urlString);
        const searchParams = url.searchParams;
        const detected = [];

        for (const param of COMMON_SEARCH_PARAMS) {
            if (searchParams.has(param)) {
                detected.push(param);
            }
        }

        return detected;
    } catch (error) {
        console.error('Error getting search params:', error);
        return [];
    }
}
