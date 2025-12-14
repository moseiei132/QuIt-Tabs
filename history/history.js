import { getHistory, clearHistory } from '../utils/storage.js';
import { analyzeHistory } from '../utils/insights.js';

let allHistory = [];
let filteredHistory = [];
let currentFilter = 'all';
let searchQuery = '';
let currentTab = 'history'; // 'history' or 'insights'
let insights = null;

// Pagination state
let currentPage = 1;
const itemsPerPage = 50;

// Initialize
init();

async function init() {
    await loadHistory();
    setupEventListeners();
    setupTabs();
}

// Load history from storage
async function loadHistory() {
    try {
        // Clean up old entries first
        await cleanupOldHistory();

        allHistory = await getHistory();
        insights = analyzeHistory(allHistory);

        if (currentTab === 'history') {
            applyFilters();
            renderHistory();
            updateStats();
        } else {
            renderInsights();
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showError('Failed to load history');
    }
}

// Setup tab switching
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const insightsSection = document.getElementById('insightsSection');
    const historySection = document.getElementById('historySection');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;

            // Update active button
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switch sections
            if (tab === 'insights') {
                currentTab = 'insights';
                insightsSection.style.display = 'block';
                historySection.style.display = 'none';
                renderInsights();
            } else {
                currentTab = 'history';
                insightsSection.style.display = 'none';
                historySection.style.display = 'block';
                applyFilters();
                renderHistory();
                updateStats();
            }
        });
    });
}

// Render insights tab
function renderInsights() {
    if (!insights) return;

    // Update statistics
    document.getElementById('statTotal').textContent = insights.statistics.totalTabs;
    document.getElementById('statWeek').textContent = insights.statistics.thisWeek;
    document.getElementById('statToday').textContent = insights.statistics.today;
    document.getElementById('statAvg').textContent = insights.statistics.avgPerDay;

    // Render close reasons chart
    renderReasonsChart(insights.statistics.reasons);

    // Render suggestions
    renderSuggestions(insights.suggestions);

    // Render top domains
    renderTopDomains(insights.topDomains);
}

// Render close reasons chart
function renderReasonsChart(reasons) {
    const chart = document.getElementById('reasonsChart');
    const total = reasons.timeout + reasons.manual_quit + reasons.manual_browser + reasons.batch_close;

    if (total === 0) {
        chart.innerHTML = '<div class="empty-message">No data yet</div>';
        return;
    }

    const reasonsData = [
        { label: 'Timeout Auto-Quit', count: reasons.timeout, color: 'var(--accent-orange)' },
        { label: 'Manual (QuIt)', count: reasons.manual_quit, color: 'var(--accent-blue)' },
        { label: 'Manual (Browser)', count: reasons.manual_browser, color: 'var(--accent-purple)' },
        { label: 'Batch Close', count: reasons.batch_close, color: 'var(--accent-red)' }
    ];

    chart.innerHTML = reasonsData.map(reason => {
        const percent = total > 0 ? Math.round((reason.count / total) * 100) : 0;
        return `
            <div class="reason-bar">
                <div class="reason-label">${reason.label}</div>
                <div class="reason-progress">
                    <div class="reason-fill" style="width: ${percent}%; background: ${reason.color}">
                        ${percent > 10 ? percent + '%' : ''}
                    </div>
                </div>
                <div class="reason-count">${reason.count}</div>
            </div>
        `;
    }).join('');
}

// Render suggestions
function renderSuggestions(suggestions) {
    const list = document.getElementById('suggestionsList');

    if (!suggestions || suggestions.length === 0) {
        list.innerHTML = '<div class="empty-message">No suggestions yet. Keep using QuIt to get personalized insights!</div>';
        return;
    }

    const iconMap = {
        warning: '<svg width="20" height="20"><use href="#icon-alert-triangle" /></svg>',
        success: '<svg width="20" height="20"><use href="#icon-check-circle" /></svg>',
        info: '<svg width="20" height="20"><use href="#icon-info" /></svg>'
    };

    list.innerHTML = suggestions.map(suggestion => `
        <div class="suggestion-card type-${suggestion.type}">
            <div class="suggestion-icon">${iconMap[suggestion.type] || iconMap.info}</div>
            <div class="suggestion-content">
                <div class="suggestion-title">${escapeHtml(suggestion.title)}</div>
                <div class="suggestion-description">${escapeHtml(suggestion.description)}</div>
                ${suggestion.action ? `
                    <button class="suggestion-action" data-action-type="${suggestion.actionType}" data-action-data='${JSON.stringify(suggestion.actionData || {})}'>
                        ${suggestion.action}
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Add click handlers for suggestion actions
    list.querySelectorAll('.suggestion-action').forEach(btn => {
        btn.addEventListener('click', () => handleSuggestionAction(btn));
    });
}

// Handle suggestion action clicks
function handleSuggestionAction(btn) {
    const actionType = btn.dataset.actionType;
    const actionData = JSON.parse(btn.dataset.actionData);

    switch (actionType) {
        case 'settings':
            // Open popup settings (just show message for now)
            alert('Open QuIt popup and adjust your countdown timer in Settings.');
            break;
        case 'exclude':
            alert(`To exclude ${actionData.domain}, open the QuIt popup and protect tabs from this site.`);
            break;
        case 'protect':
            alert(`To protect this URL, bookmark it or open it and use the Protect button in QuIt popup.`);
            break;
        default:
            console.log('Action:', actionType, actionData);
    }
}

// Render top domains
function renderTopDomains(topDomains) {
    const list = document.getElementById('topDomainsList');

    if (!topDomains || topDomains.length === 0) {
        list.innerHTML = '<div class="empty-message">No data yet</div>';
        return;
    }

    list.innerHTML = topDomains.map((domain, index) => `
        <div class="domain-item">
            <span class="domain-name">${index + 1}. ${escapeHtml(domain.domain)}</span>
            <span class="domain-count">${domain.count} tabs</span>
        </div>
    `).join('');
}

// Apply filters and search
function applyFilters() {
    filteredHistory = allHistory.filter(entry => {
        // Filter by close reason
        if (currentFilter !== 'all' && entry.closeReason !== currentFilter) {
            return false;
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                entry.title.toLowerCase().includes(query) ||
                entry.url.toLowerCase().includes(query)
            );
        }

        return true;
    });

    // Reset to first page when filters change
    currentPage = 1;
}

// Get total number of pages
function getTotalPages() {
    return Math.ceil(filteredHistory.length / itemsPerPage);
}

// Get history items for current page
function getCurrentPageItems() {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredHistory.slice(startIndex, endIndex);
}

// Render history list
function renderHistory() {
    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');

    if (filteredHistory.length === 0) {
        historyList.innerHTML = '';
        historyList.style.display = 'none';
        emptyState.style.display = 'block';

        if (allHistory.length === 0) {
            emptyState.querySelector('h2').textContent = 'No History Yet';
            emptyState.querySelector('p').textContent = 'Closed tabs will appear here';
        } else {
            emptyState.querySelector('h2').textContent = 'No Results';
            emptyState.querySelector('p').textContent = 'Try a different search or filter';
        }
        renderPagination();
        return;
    }

    emptyState.style.display = 'none';
    historyList.style.display = 'flex';

    const pageItems = getCurrentPageItems();

    historyList.innerHTML = pageItems.map(entry => {
        const faviconHtml = entry.favicon
            ? `<img src="${escapeHtml(entry.favicon)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">`
            : '';

        const fallbackIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ${entry.favicon ? 'style="display:none;"' : ''}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10zM2.05 12H22" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`;

        return `
            <div class="history-item" data-id="${entry.id}">
                <div class="history-favicon">
                    ${faviconHtml}
                    ${fallbackIcon}
                </div>
                <div class="history-content">
                    <div class="history-title">${escapeHtml(entry.title)}</div>
                    <div class="history-url">${escapeHtml(entry.url)}</div>
                </div>
                <div class="history-meta">
                    <span class="history-reason reason-${entry.closeReason}">${formatCloseReason(entry.closeReason)}</span>
                    <span class="history-time" title="${formatAbsoluteTime(entry.timestamp)}">${formatRelativeTime(entry.timestamp)}</span>
                </div>
            </div>
        `;
    }).join('');

    renderPagination();
}

// Render pagination controls
function renderPagination() {
    const paginationContainer = document.getElementById('paginationContainer');
    const totalPages = getTotalPages();

    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }

    paginationContainer.style.display = 'flex';

    const startItem = filteredHistory.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, filteredHistory.length);

    paginationContainer.innerHTML = `
        <button id="firstPage" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} title="First page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
        <button id="prevPage" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} title="Previous page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
        <span class="pagination-info">${startItem}-${endItem} of ${filteredHistory.length}</span>
        <button id="nextPage" class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} title="Next page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
        <button id="lastPage" class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} title="Last page">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        </button>
    `;

    // Add event listeners for pagination buttons
    document.getElementById('firstPage')?.addEventListener('click', () => goToPage(1));
    document.getElementById('prevPage')?.addEventListener('click', () => goToPage(currentPage - 1));
    document.getElementById('nextPage')?.addEventListener('click', () => goToPage(currentPage + 1));
    document.getElementById('lastPage')?.addEventListener('click', () => goToPage(totalPages));
}

// Go to specific page
function goToPage(page) {
    const totalPages = getTotalPages();
    if (page < 1 || page > totalPages) return;

    currentPage = page;
    renderHistory();

    // Scroll to top of history list
    document.getElementById('historyList').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Format close reason for display
function formatCloseReason(reason) {
    const reasons = {
        'timeout': 'Timeout',
        'manual_quit': 'Manual (QuIt)',
        'manual_browser': 'Manual (Browser)',
        'batch_close': 'Batch Close'
    };
    return reasons[reason] || reason;
}

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
}

// Format absolute time (for tooltip)
function formatAbsoluteTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Update stats in footer
function updateStats() {
    const totalCount = document.getElementById('totalCount');
    const filteredCount = document.getElementById('filteredCount');

    totalCount.textContent = `${allHistory.length} ${allHistory.length === 1 ? 'entry' : 'entries'}`;

    if (currentFilter !== 'all' || searchQuery) {
        filteredCount.textContent = `Showing ${filteredHistory.length}`;
        filteredCount.style.display = 'inline';
    } else {
        filteredCount.style.display = 'none';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('clearSearch');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        clearSearch.style.display = searchQuery ? 'flex' : 'none';
        applyFilters();
        renderHistory();
        updateStats();
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearch.style.display = 'none';
        applyFilters();
        renderHistory();
        updateStats();
    });

    // Filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.reason;
            applyFilters();
            renderHistory();
            updateStats();
        });
    });

    // Clear history button
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all history? This action cannot be undone.')) {
            try {
                await clearHistory();
                allHistory = [];
                insights = analyzeHistory([]);
                applyFilters();

                if (currentTab === 'history') {
                    renderHistory();
                    updateStats();
                } else {
                    renderInsights();
                }
            } catch (error) {
                console.error('Error clearing history:', error);
                alert('Failed to clear history');
            }
        }
    });

    // Click on history item to open URL
    document.getElementById('historyList').addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (item) {
            const entry = filteredHistory.find(h => h.id === item.dataset.id);
            if (entry && entry.url) {
                chrome.tabs.create({ url: entry.url });
            }
        }
    });
}

// Clean up old history entries
async function cleanupOldHistory() {
    try {
        const { getSettings, getHistory, saveHistory } = await import('../utils/storage.js');
        const settings = await getSettings();
        const history = await getHistory();

        // Calculate cutoff time (7 days ago by default)
        const cutoffTime = Date.now() - (settings.historyRetentionDays * 24 * 60 * 60 * 1000);

        // Filter out old entries
        const filteredHistory = history.filter(h => h.timestamp >= cutoffTime);

        // Save if any entries were removed
        if (filteredHistory.length < history.length) {
            await saveHistory(filteredHistory);
            console.log(`Cleaned up ${history.length - filteredHistory.length} old history entries`);
        }
    } catch (error) {
        console.error('Error cleaning up old history:', error);
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show error message
function showError(message) {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = `<div class="loading" style="color: var(--accent-red);">${escapeHtml(message)}</div>`;
}
