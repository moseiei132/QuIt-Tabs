/**
 * Parse a URL into components
 * @param {string} urlString - URL to parse
 * @returns {Object} Parsed URL components
 */
export function parseURL(urlString) {
    try {
        const url = new URL(urlString);
        const hostname = url.hostname;
        const parts = hostname.split('.');

        return {
            protocol: url.protocol,
            hostname: hostname,
            domain: parts.length >= 2 ? parts.slice(-2).join('.') : hostname,
            subdomain: parts.length > 2 ? parts.slice(0, -2).join('.') : '',
            path: url.pathname,
            fullURL: urlString
        };
    } catch (error) {
        console.error('Error parsing URL:', urlString, error);
        return null;
    }
}

/**
 * Check if a URL matches an exclusion rule
 * @param {string} urlString - URL to check
 * @param {Object} rule - Exclusion rule
 * @returns {boolean} True if matches
 */
export function matchesRule(urlString, rule) {
    if (!rule.enabled) return false;

    const parsed = parseURL(urlString);
    if (!parsed) return false;

    switch (rule.type) {
        case 'exact':
            return parsed.fullURL === rule.pattern;

        case 'domain':
            // Matches only the exact domain (e.g., example.com matches example.com, not sub.example.com)
            return parsed.hostname === rule.pattern;

        case 'subdomain':
            // Matches subdomains only (e.g., *.example.com matches sub.example.com but not example.com)
            const pattern = rule.pattern.replace('*.', '');
            return parsed.hostname.endsWith('.' + pattern) && parsed.hostname !== pattern;

        case 'domain_all':
            // Matches domain and all subdomains (e.g., **.example.com matches both example.com and sub.example.com)
            const domainPattern = rule.pattern.replace('**.', '');
            return parsed.hostname === domainPattern || parsed.hostname.endsWith('.' + domainPattern);

        case 'path_exact':
            // Match exact path only, no wildcards
            const [exactDomain, ...exactParts] = rule.pattern.split('/');
            const exactPath = exactParts.join('/');

            if (parsed.hostname !== exactDomain) return false;

            const normalizedExactPath = parsed.path.startsWith('/') ? parsed.path.substring(1) : parsed.path;
            return normalizedExactPath === exactPath;

        case 'path':
            // Match domain and path pattern (with wildcards)
            const [pathDomain, ...pathParts] = rule.pattern.split('/');
            const pathPattern = pathParts.join('/');

            if (parsed.hostname !== pathDomain) return false;

            // Normalize paths (remove leading /)
            const normalizedPath = parsed.path.startsWith('/') ? parsed.path.substring(1) : parsed.path;
            const normalizedPattern = pathPattern.startsWith('/') ? pathPattern.substring(1) : pathPattern;

            // Wildcard matching
            if (normalizedPattern.endsWith('*')) {
                const prefix = normalizedPattern.slice(0, -1); // Remove the * (e.g., "DramaAdd/*" -> "DramaAdd/")

                // Match if:
                // 1. Exact match without the trailing slash/star (e.g., "DramaAdd" matches "DramaAdd/*")
                // 2. Path starts with the prefix (e.g., "DramaAdd/photos" matches "DramaAdd/*")
                const basePrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
                return normalizedPath === basePrefix || normalizedPath.startsWith(prefix);
            }

            // Exact path match (for root path)
            return normalizedPath === normalizedPattern;

        case 'domain_path':
            // Match all paths on a specific domain (e.g., example.com/* matches example.com/anything)
            const [domainOnly, ...rest] = rule.pattern.split('/');
            if (parsed.hostname !== domainOnly) return false;
            // Matches any path on this domain
            return true;

        default:
            return false;
    }
}

/**
 * Find the best matching rule for a URL
 * Priority: exact > path_exact > path > domain > subdomain > domain_path > domain_all
 * If same priority, use the one with longest countdown (to keep tab alive longer)
 * @param {string} urlString - URL to check
 * @param {Array} rules - Array of exclusion rules
 * @returns {Object|null} Best matching rule or null
 */
export function findBestMatch(urlString, rules) {
    const matchingRules = rules.filter(rule => matchesRule(urlString, rule));

    if (matchingRules.length === 0) return null;
    if (matchingRules.length === 1) return matchingRules[0];

    // Priority order (higher number = higher priority)
    const priority = {
        'exact': 7,         // Exact URL match (most specific)
        'path_exact': 6,    // Exact path on domain
        'path': 5,          // Path + subpaths
        'domain': 4,        // Exact domain only
        'subdomain': 3,     // Subdomains only
        'domain_path': 2,   // All paths on domain
        'domain_all': 1     // Domain + all subdomains (least specific)
    };

    // Sort by priority first, then by countdown (null countdown = never close = highest priority)
    matchingRules.sort((a, b) => {
        const priorityDiff = priority[b.type] - priority[a.type];
        if (priorityDiff !== 0) return priorityDiff;

        // Same priority, prefer null countdown (never close)
        if (a.customCountdown === null) return -1;
        if (b.customCountdown === null) return 1;

        // Otherwise prefer longer countdown
        return (b.customCountdown || 0) - (a.customCountdown || 0);
    });

    return matchingRules[0];
}

/**
 * Extract domain from URL for quick exclusion
 * @param {string} urlString - URL to extract from
 * @returns {string|null} Domain string
 */
export function extractDomain(urlString) {
    const parsed = parseURL(urlString);
    return parsed ? parsed.hostname : null;
}
