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

    try {
        const url = new URL(urlString);

        switch (rule.type) {
            case 'exact':
                // Legacy: exact URL match (for backward compatibility)
                return parsed.fullURL === rule.pattern;

            case 'domain':
                // Legacy: matches only the exact domain (not subdomains)
                return parsed.hostname === rule.pattern;

            case 'subdomain':
                // Legacy: matches subdomains only (not main domain)
                const subdomainPattern = rule.pattern.replace('*.', '');
                return parsed.hostname.endsWith('.' + subdomainPattern) && parsed.hostname !== subdomainPattern;

            case 'domain_all':
                // Matches domain and all subdomains (e.g., **.example.com)
                const domainPattern = rule.pattern.replace('**.', '');
                return parsed.hostname === domainPattern || parsed.hostname.endsWith('.' + domainPattern);

            case 'path_exact':
                // NEW: Match exact path with optional querystring handling
                const hasQueryInPattern = rule.pattern.includes('?');

                if (hasQueryInPattern) {
                    // Pattern includes querystring - do exact match
                    try {
                        // Parse pattern as URL (add protocol if missing)
                        const patternWithProtocol = rule.pattern.startsWith('http')
                            ? rule.pattern
                            : 'https://' + rule.pattern;
                        const patternUrl = new URL(patternWithProtocol);

                        // Match hostname, path, and search params
                        return url.hostname === patternUrl.hostname &&
                            url.pathname === patternUrl.pathname &&
                            url.search === patternUrl.search;
                    } catch (e) {
                        console.error('Error parsing pattern URL:', rule.pattern, e);
                        return false;
                    }
                } else {
                    // Pattern has no querystring - match only hostname + path (ignore query)
                    const patternParts = rule.pattern.split('/');
                    const patternHostname = patternParts[0];
                    const patternPath = '/' + patternParts.slice(1).join('/');

                    return url.hostname === patternHostname && url.pathname === patternPath;
                }

            case 'path':
                // Legacy: match domain and path pattern (with wildcards)
                const [pathDomain, ...pathParts] = rule.pattern.split('/');
                const pathPattern = pathParts.join('/');

                if (parsed.hostname !== pathDomain) return false;

                // Normalize paths (remove leading /)
                const normalizedPath = parsed.path.startsWith('/') ? parsed.path.substring(1) : parsed.path;
                const normalizedPattern = pathPattern.startsWith('/') ? pathPattern.substring(1) : pathPattern;

                // Wildcard matching
                if (normalizedPattern.endsWith('*')) {
                    const prefix = normalizedPattern.slice(0, -1);
                    const basePrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
                    return normalizedPath === basePrefix || normalizedPath.startsWith(prefix);
                }

                // Exact path match
                return normalizedPath === normalizedPattern;

            case 'domain_path':
                // NEW: Match all paths on domain
                const [domainOnly, ...rest] = rule.pattern.split('/');
                return url.hostname === domainOnly;

            case 'regex':
                // NEW: Custom regex pattern matching
                try {
                    // Cache regex for performance
                    if (!rule._cachedRegex) {
                        rule._cachedRegex = new RegExp(rule.pattern);
                    }
                    return rule._cachedRegex.test(urlString);
                } catch (error) {
                    console.error('Invalid regex pattern:', rule.pattern, error);
                    return false;
                }

            default:
                console.warn('Unknown rule type:', rule.type);
                return false;
        }
    } catch (error) {
        console.error('Error matching rule:', error, rule);
        return false;
    }
}

/**
 * Find the best matching rule for a URL
 * Priority: exact > regex > path_exact > path > domain > subdomain > domain_path > domain_all
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
        'exact': 8,         // Exact URL match (most specific)
        'regex': 7,         // Custom regex pattern
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
