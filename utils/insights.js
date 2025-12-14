/**
 * History Insights and Analysis
 * Analyzes tab close history to provide smart suggestions and statistics
 */

/**
 * Analyze history and generate insights
 * @param {Array} history - Array of history entries
 * @returns {Object} - Analysis results with statistics and suggestions
 */
export function analyzeHistory(history) {
    if (!history || history.length === 0) {
        return {
            statistics: getEmptyStats(),
            suggestions: [],
            topDomains: [],
            patterns: {}
        };
    }

    const stats = calculateStatistics(history);
    const patterns = detectPatterns(history);
    const suggestions = generateSuggestions(history, stats, patterns);
    const topDomains = getTopDomains(history);

    return {
        statistics: stats,
        suggestions,
        topDomains,
        patterns
    };
}

/**
 * Calculate basic statistics
 */
function calculateStatistics(history) {
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);

    const totalTabs = history.length;
    const thisWeek = history.filter(h => h.timestamp >= weekAgo).length;
    const today = history.filter(h => h.timestamp >= dayAgo).length;

    // Close reasons breakdown
    const reasons = {
        timeout: history.filter(h => h.closeReason === 'timeout').length,
        manual_quit: history.filter(h => h.closeReason === 'manual_quit').length,
        manual_browser: history.filter(h => h.closeReason === 'manual_browser').length,
        batch_close: history.filter(h => h.closeReason === 'batch_close').length
    };

    // Calculate percentages
    const timeoutPercent = totalTabs > 0 ? Math.round((reasons.timeout / totalTabs) * 100) : 0;
    const manualPercent = totalTabs > 0 ? Math.round(((reasons.manual_quit + reasons.manual_browser) / totalTabs) * 100) : 0;

    return {
        totalTabs,
        thisWeek,
        today,
        reasons,
        timeoutPercent,
        manualPercent,
        avgPerDay: thisWeek > 0 ? Math.round(thisWeek / 7) : 0
    };
}

/**
 * Detect patterns in history
 */
function detectPatterns(history) {
    const patterns = {
        frequentDomains: findFrequentDomains(history),
        reopenedUrls: findReopenedUrls(history),
        peakTimes: findPeakTimes(history),
        quickCloses: findQuickCloses(history)
    };

    return patterns;
}

/**
 * Find frequently closed domains
 */
function findFrequentDomains(history) {
    const domainCounts = {};
    const domainReasons = {};

    history.forEach(entry => {
        try {
            const url = new URL(entry.url);
            const domain = url.hostname.replace('www.', '');

            if (!domainCounts[domain]) {
                domainCounts[domain] = 0;
                domainReasons[domain] = { timeout: 0, manual: 0, batch: 0 };
            }

            domainCounts[domain]++;

            if (entry.closeReason === 'timeout') {
                domainReasons[domain].timeout++;
            } else if (entry.closeReason === 'manual_quit' || entry.closeReason === 'manual_browser') {
                domainReasons[domain].manual++;
            } else if (entry.closeReason === 'batch_close') {
                domainReasons[domain].batch++;
            }
        } catch (e) {
            // Skip invalid URLs
        }
    });

    // Convert to array and sort by count
    return Object.entries(domainCounts)
        .map(([domain, count]) => ({
            domain,
            count,
            reasons: domainReasons[domain]
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

/**
 * Find URLs that might be reopened frequently
 * (This is a heuristic - we can't track actual reopens without more data)
 */
function findReopenedUrls(history) {
    const urlCounts = {};

    history.forEach(entry => {
        const url = entry.url;
        if (!urlCounts[url]) {
            urlCounts[url] = { count: 0, title: entry.title };
        }
        urlCounts[url].count++;
    });

    // URLs closed 3+ times might be frequently reopened
    return Object.entries(urlCounts)
        .filter(([url, data]) => data.count >= 3)
        .map(([url, data]) => ({ url, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
}

/**
 * Find peak closing times
 */
function findPeakTimes(history) {
    const hourCounts = new Array(24).fill(0);

    history.forEach(entry => {
        const hour = new Date(entry.timestamp).getHours();
        hourCounts[hour]++;
    });

    // Find hours with most activity
    const peakHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter(h => h.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

    return peakHours;
}

/**
 * Find tabs that are always closed quickly (manually before timeout)
 */
function findQuickCloses(history) {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentHistory = history.filter(h => h.timestamp >= weekAgo);

    const domainManualCloses = {};

    recentHistory.forEach(entry => {
        try {
            const url = new URL(entry.url);
            const domain = url.hostname.replace('www.', '');

            if (!domainManualCloses[domain]) {
                domainManualCloses[domain] = { manual: 0, timeout: 0 };
            }

            if (entry.closeReason === 'manual_quit' || entry.closeReason === 'manual_browser') {
                domainManualCloses[domain].manual++;
            } else if (entry.closeReason === 'timeout') {
                domainManualCloses[domain].timeout++;
            }
        } catch (e) {
            // Skip invalid URLs
        }
    });

    // Find domains where >80% are manual closes and at least 5 occurrences
    return Object.entries(domainManualCloses)
        .filter(([domain, counts]) => {
            const total = counts.manual + counts.timeout;
            return total >= 5 && (counts.manual / total) > 0.8;
        })
        .map(([domain, counts]) => ({
            domain,
            manualCount: counts.manual,
            totalCount: counts.manual + counts.timeout
        }))
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, 5);
}

/**
 * Generate smart suggestions based on patterns
 */
function generateSuggestions(history, stats, patterns) {
    const suggestions = [];

    // Suggestion 1: Timeout effectiveness
    if (stats.totalTabs >= 20) {
        if (stats.manualPercent > 75) {
            suggestions.push({
                id: 'timeout-too-long',
                type: 'warning',
                title: 'Timeout might be too long',
                description: `${stats.manualPercent}% of tabs are manually closed before timeout. Consider reducing your countdown timer.`,
                action: 'Adjust Timeout',
                actionType: 'settings',
                priority: 'high'
            });
        } else if (stats.timeoutPercent > 70) {
            suggestions.push({
                id: 'timeout-working',
                type: 'success',
                title: 'Your timeout is working great!',
                description: `${stats.timeoutPercent}% of tabs auto-close naturally. Your current settings are efficient.`,
                action: null,
                priority: 'low'
            });
        }
    }

    // Suggestion 2: Frequent domains
    if (patterns.frequentDomains.length > 0) {
        const topDomain = patterns.frequentDomains[0];
        if (topDomain.count >= 10) {
            suggestions.push({
                id: `frequent-${topDomain.domain}`,
                type: 'info',
                title: `Frequently closed: ${topDomain.domain}`,
                description: `You've closed ${topDomain.count} tabs from this site. Consider adjusting timeout or adding to exclusion list.`,
                action: 'Manage Site',
                actionType: 'exclude',
                actionData: { domain: topDomain.domain },
                priority: 'medium'
            });
        }
    }

    // Suggestion 3: Potentially reopened URLs
    if (patterns.reopenedUrls.length > 0) {
        const topReopen = patterns.reopenedUrls[0];
        suggestions.push({
            id: `reopen-${topReopen.url}`,
            type: 'info',
            title: 'Tab you might want to keep',
            description: `"${topReopen.title}" has been closed ${topReopen.count} times. Consider protecting or pinning it.`,
            action: 'Protect URL',
            actionType: 'protect',
            actionData: { url: topReopen.url },
            priority: 'medium'
        });
    }

    // Suggestion 4: Quick closes (always manual)
    if (patterns.quickCloses.length > 0) {
        const quickClose = patterns.quickCloses[0];
        suggestions.push({
            id: `quick-${quickClose.domain}`,
            type: 'info',
            title: `Quick close pattern detected`,
            description: `Tabs from ${quickClose.domain} are always manually closed (${quickClose.manualCount}/${quickClose.totalCount}). Want to reduce timeout for this site?`,
            action: 'Reduce Timeout',
            actionType: 'site-timeout',
            actionData: { domain: quickClose.domain },
            priority: 'low'
        });
    }

    // Suggestion 5: Peak time reminder
    if (patterns.peakTimes.length > 0 && stats.thisWeek >= 30) {
        const peakHour = patterns.peakTimes[0];
        const timeStr = formatHour(peakHour.hour);
        suggestions.push({
            id: 'peak-time',
            type: 'info',
            title: 'Peak closing time detected',
            description: `You close most tabs around ${timeStr}. Most closures happen during this time.`,
            action: null,
            priority: 'low'
        });
    }

    // Sort by priority
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return suggestions.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
}

/**
 * Get top domains by close count
 */
function getTopDomains(history) {
    const domainCounts = {};

    history.forEach(entry => {
        try {
            const url = new URL(entry.url);
            const domain = url.hostname.replace('www.', '');

            if (!domainCounts[domain]) {
                domainCounts[domain] = { count: 0, reasons: {} };
            }

            domainCounts[domain].count++;

            if (!domainCounts[domain].reasons[entry.closeReason]) {
                domainCounts[domain].reasons[entry.closeReason] = 0;
            }
            domainCounts[domain].reasons[entry.closeReason]++;
        } catch (e) {
            // Skip invalid URLs
        }
    });

    return Object.entries(domainCounts)
        .map(([domain, data]) => ({ domain, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

/**
 * Get empty statistics object
 */
function getEmptyStats() {
    return {
        totalTabs: 0,
        thisWeek: 0,
        today: 0,
        reasons: { timeout: 0, manual_quit: 0, manual_browser: 0, batch_close: 0 },
        timeoutPercent: 0,
        manualPercent: 0,
        avgPerDay: 0
    };
}

/**
 * Format hour for display
 */
function formatHour(hour) {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:00 ${period}`;
}
