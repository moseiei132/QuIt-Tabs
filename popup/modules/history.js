/**
 * History Panel Module
 * In-popup closed-tabs history (stats + stacked reason bar + list)
 */

import {
    getHistory,
    clearHistory,
    getSettings,
    saveHistory
} from '../../utils/storage.js';
import { escapeHtml } from './utils.js';

const ITEMS_PER_PAGE = 20;

const REASON_META = [
    { key: 'timeout', label: 'Timeout', short: 'Timeout', colorVar: 'var(--macos-yellow)' },
    { key: 'manual_quit', label: 'QuIt', short: 'QuIt', colorVar: 'var(--macos-accent)' },
    { key: 'manual_browser', label: 'Browser', short: 'Browser', colorVar: 'var(--group-purple)' },
    { key: 'batch_close', label: 'Batch', short: 'Batch', colorVar: 'var(--macos-red)' }
];

let allHistory = [];
let filteredHistory = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
let listenersBound = false;

/**
 * Setup history panel open/back and list interactions
 */
export function setupHistoryPanel() {
    const historyBtn = document.getElementById('historyBtn');
    const backBtn = document.getElementById('backFromHistoryBtn');
    const historyPanel = document.getElementById('historyPanel');
    const settingsPanel = document.getElementById('settingsPanel');
    const currentTabEl = document.querySelector('.current-tab');
    const tabsSection = document.querySelector('.tabs-section');

    historyBtn.addEventListener('click', async () => {
        settingsPanel.style.display = 'none';
        currentTabEl.style.display = 'none';
        tabsSection.style.display = 'none';
        historyPanel.style.display = 'flex';
        await loadAndRender();
    });

    backBtn.addEventListener('click', () => {
        historyPanel.style.display = 'none';
        currentTabEl.style.display = '';
        tabsSection.style.display = '';
    });

    if (!listenersBound) {
        bindListListeners();
        listenersBound = true;
    }
}

function bindListListeners() {
    const searchInput = document.getElementById('historySearchInput');
    const clearSearch = document.getElementById('historyClearSearch');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        clearSearch.style.display = searchQuery ? 'flex' : 'none';
        applyFilters();
        renderList();
        updateCountLabel();
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearch.style.display = 'none';
        applyFilters();
        renderList();
        updateCountLabel();
    });

    document.querySelectorAll('#historyFilterBar .history-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#historyFilterBar .history-filter-btn')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.reason;
            applyFilters();
            renderList();
            updateCountLabel();
        });
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
        if (!confirm('Clear all history? This cannot be undone.')) return;
        try {
            await clearHistory();
            allHistory = [];
            applyFilters();
            renderStats();
            renderReasonBar();
            renderList();
            updateCountLabel();
        } catch (error) {
            console.error('Error clearing history:', error);
            alert('Failed to clear history');
        }
    });

    document.getElementById('historyList').addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (!item) return;
        const entry = filteredHistory.find(h => h.id === item.dataset.id);
        if (entry?.url) chrome.tabs.create({ url: entry.url });
    });
}

async function loadAndRender() {
    try {
        await cleanupOldHistory();
        allHistory = await getHistory();
        // Newest first
        allHistory.sort((a, b) => b.timestamp - a.timestamp);
        applyFilters();
        renderStats();
        renderReasonBar();
        renderList();
        updateCountLabel();
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyList').innerHTML =
            `<div class="loading" style="color: var(--macos-red);">Failed to load history</div>`;
    }
}

async function cleanupOldHistory() {
    try {
        const settings = await getSettings();
        const history = await getHistory();
        const days = settings.historyRetentionDays ?? 7;
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const kept = history.filter(h => h.timestamp >= cutoff);
        if (kept.length < history.length) await saveHistory(kept);
    } catch (error) {
        console.error('Error cleaning up history:', error);
    }
}

function applyFilters() {
    filteredHistory = allHistory.filter(entry => {
        if (currentFilter === 'manual') {
            if (entry.closeReason !== 'manual_quit' && entry.closeReason !== 'manual_browser') {
                return false;
            }
        } else if (currentFilter !== 'all' && entry.closeReason !== currentFilter) {
            return false;
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (
                (entry.title || '').toLowerCase().includes(q) ||
                (entry.url || '').toLowerCase().includes(q)
            );
        }
        return true;
    });
    currentPage = 1;
}

function countReasons(history) {
    return {
        timeout: history.filter(h => h.closeReason === 'timeout').length,
        manual_quit: history.filter(h => h.closeReason === 'manual_quit').length,
        manual_browser: history.filter(h => h.closeReason === 'manual_browser').length,
        batch_close: history.filter(h => h.closeReason === 'batch_close').length
    };
}

function renderStats() {
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);

    document.getElementById('historyStatToday').textContent =
        allHistory.filter(h => h.timestamp >= dayAgo).length;
    document.getElementById('historyStatWeek').textContent =
        allHistory.filter(h => h.timestamp >= weekAgo).length;
    document.getElementById('historyStatTotal').textContent = allHistory.length;
}

function renderReasonBar() {
    const bar = document.getElementById('historyReasonBar');
    const legend = document.getElementById('historyReasonLegend');
    const reasons = countReasons(allHistory);
    const total = allHistory.length;

    if (total === 0) {
        bar.innerHTML = '<div class="history-reason-empty">No closes yet</div>';
        legend.innerHTML = '';
        return;
    }

    // Round percents so they sum to 100 (largest remainder)
    const raw = REASON_META.map(meta => ({
        ...meta,
        count: reasons[meta.key],
        exact: (reasons[meta.key] / total) * 100
    })).filter(r => r.count > 0);

    let allocated = 0;
    const withFloor = raw.map(r => {
        const pct = Math.floor(r.exact);
        allocated += pct;
        return { ...r, pct, frac: r.exact - pct };
    });
    let remain = 100 - allocated;
    withFloor.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < withFloor.length && remain > 0; i++, remain--) {
        withFloor[i].pct += 1;
    }
    // Restore reason order for bar
    withFloor.sort((a, b) =>
        REASON_META.findIndex(m => m.key === a.key) - REASON_META.findIndex(m => m.key === b.key)
    );

    bar.innerHTML = withFloor.map(r => `
        <div class="history-reason-seg reason-${r.key}"
             style="width:${r.pct}%;background:${r.colorVar}"
             title="${r.label}: ${r.pct}%">
            ${r.pct >= 8 ? r.pct + '%' : ''}
        </div>
    `).join('');

    legend.innerHTML = withFloor.map(r => `
        <span class="history-legend-item">
            <span class="history-legend-dot" style="background:${r.colorVar}"></span>
            ${r.short} ${r.pct}%
        </span>
    `).join('');
}

function getTotalPages() {
    return Math.max(1, Math.ceil(filteredHistory.length / ITEMS_PER_PAGE));
}

function getPageItems() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHistory.slice(start, start + ITEMS_PER_PAGE);
}

function renderList() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmptyState');

    if (filteredHistory.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        empty.style.display = 'flex';
        empty.querySelector('h3').textContent =
            allHistory.length === 0 ? 'No History Yet' : 'No Results';
        empty.querySelector('p').textContent =
            allHistory.length === 0 ? 'Closed tabs will appear here' : 'Try a different search or filter';
        renderPagination();
        return;
    }

    empty.style.display = 'none';
    list.style.display = 'flex';

    list.innerHTML = getPageItems().map(entry => {
        const faviconHtml = entry.favicon
            ? `<img src="${escapeHtml(entry.favicon)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">`
            : '';
        const fallback = `<svg width="14" height="14" ${entry.favicon ? 'style="display:none;"' : ''}>
            <use href="#icon-globe" />
        </svg>`;

        return `
            <div class="history-item" data-id="${escapeHtml(entry.id)}" title="Open ${escapeHtml(entry.url || '')}">
                <div class="history-favicon">${faviconHtml}${fallback}</div>
                <div class="history-item-body">
                    <div class="history-title">${escapeHtml(entry.title || entry.url || 'Untitled')}</div>
                    <div class="history-item-meta">
                        <span class="history-reason reason-${entry.closeReason}">${formatCloseReason(entry.closeReason)}</span>
                        <span class="history-time" title="${formatAbsoluteTime(entry.timestamp)}">${formatRelativeTime(entry.timestamp)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    renderPagination();
}

function renderPagination() {
    const container = document.getElementById('historyPagination');
    const totalPages = getTotalPages();

    if (filteredHistory.length === 0 || totalPages <= 1) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'flex';
    const start = (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const end = Math.min(currentPage * ITEMS_PER_PAGE, filteredHistory.length);

    container.innerHTML = `
        <button class="history-page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''} title="Previous">‹</button>
        <span class="history-page-info">${start}–${end}</span>
        <button class="history-page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''} title="Next">›</button>
    `;

    container.querySelector('[data-page="prev"]')?.addEventListener('click', () => goToPage(currentPage - 1));
    container.querySelector('[data-page="next"]')?.addEventListener('click', () => goToPage(currentPage + 1));
}

function goToPage(page) {
    const totalPages = getTotalPages();
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderList();
    document.getElementById('historyList').scrollTop = 0;
}

function updateCountLabel() {
    const label = document.getElementById('historyCountLabel');
    const n = filteredHistory.length;
    const total = allHistory.length;
    if (currentFilter !== 'all' || searchQuery) {
        label.textContent = `${n} of ${total}`;
    } else {
        label.textContent = `${total} ${total === 1 ? 'entry' : 'entries'}`;
    }
}

function formatCloseReason(reason) {
    const map = {
        timeout: 'Timeout',
        manual_quit: 'QuIt',
        manual_browser: 'Browser',
        batch_close: 'Batch'
    };
    return map[reason] || reason;
}

function formatRelativeTime(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
}

function formatAbsoluteTime(timestamp) {
    return new Date(timestamp).toLocaleString();
}
