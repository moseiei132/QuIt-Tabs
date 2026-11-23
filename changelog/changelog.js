import { getSettings } from '../utils/storage.js';

const RELEASES = [
  {
    version: '1.6.1',
    headline: '2-Step Sleep, Per-Site Rules & Visual Polish',
    summary: 'Refined Memory Saver workflows, flexible per-site action overrides, and clearer visual hierarchy between sleeping and closing tabs.',
    changes: [
      {
        type: 'new',
        text: '<strong>2-Step Mode (Sleep → Close):</strong> Put inactive tabs to sleep first, then automatically close them after a configurable <code>Close After Sleep</code> delay.'
      },
      {
        type: 'improved',
        text: '<strong>Upgraded Per-Site Rules:</strong> Configure each domain with <code>Global</code> or <code>Custom</code> timer and independently override the action (<code>Global</code>, <code>Close</code>, <code>Sleep</code>, or <code>2-Step</code>), with click-to-edit support.'
      },
      {
        type: 'improved',
        text: '<strong>Sleep Visual Hierarchy:</strong> Chrome-native dashed favicon ring with crescent moon badge and calm macOS Indigo countdowns for <code>SLEEP</code>, reserving red strictly for <code>CLOSE</code>.'
      },
      {
        type: 'improved',
        text: '<strong>Cleaner Split View Rows:</strong> Deduplicated identical Active/Countdown status across Split View pairs and auto-moved non-adjacent tabs when triggering <code>Split with Current Tab</code>.'
      },
      {
        type: 'fix',
        text: '<strong>Discarded Tab ID Migration &amp; Active Tab Timer Fix:</strong> Track tab ID replacements on <code>chrome.tabs.discard()</code> / <code>onReplaced</code> so 2-Step timers count down reliably, and prevent active tabs from flashing stale timers.'
      },
      {
        type: 'fix',
        text: '<strong>Context Menu Startup Guard:</strong> Prevented duplicate <code>contextMenus</code> ID warnings during concurrent service worker initialization.'
      }
    ]
  },
  {
    version: '1.6.0',
    headline: 'Chrome Latest Support & Full Changelog',
    summary: 'Built for modern Chrome workflows — native Split View awareness, Tab Strip right-click actions, Shared Tab Group protection, Sleep mode, and MV3 reliability improvements.',
    changes: [
      {
        type: 'new',
        text: '<strong>Chrome Split View Support:</strong> Paired Split View tabs stay active together while visible on screen so the unfocused pane is never auto-closed, with visual pairing badges and Split / Unsplit context menu actions.'
      },
      {
        type: 'new',
        text: '<strong>Tab Strip Context Menu:</strong> Right-click directly on any Chrome tab in the tab strip to <code>Protect / Unprotect</code> or <code>Reset Countdown</code> without opening the popup.'
      },
      {
        type: 'new',
        text: '<strong>Protect Shared Tab Groups:</strong> Automatically keep tabs inside Chrome Shared Tab Groups safe from auto-closing (configurable in Settings).'
      },
      {
        type: 'new',
        text: '<strong>Memory Saver Sleep Mode:</strong> Choose whether expired tabs are closed or put to sleep via Chrome Memory Saver (<code>chrome.tabs.discard</code>).'
      },
      {
        type: 'new',
        text: '<strong>Keyboard Shortcut:</strong> Press <code>Alt+Shift+P</code> to quickly toggle protection on the current tab (customizable in <code>chrome://extensions/shortcuts</code>).'
      },
      {
        type: 'new',
        text: '<strong>Full Changelog Page:</strong> View the complete release history across all versions anytime from Settings or the What\'s New banner.'
      },
      {
        type: 'improved',
        text: '<strong>Live Tab Group Sync & Side Panel Menus:</strong> Popup refreshes automatically on tab group changes, and context menus clamp cleanly inside Side Panel bounds.'
      },
      {
        type: 'fix',
        text: '<strong>MV3 Service Worker Persistence:</strong> Persist active tab and focused window tracking in <code>chrome.storage.session</code> so timers stay accurate across worker sleep/wake cycles.'
      }
    ]
  },
  {
    version: '1.5.0',
    headline: 'In-Popup History Panel',
    summary: 'Brought closed-tabs history directly inside the popup and side panel with visual insights.',
    changes: [
      {
        type: 'new',
        text: 'Integrated closed-tabs History panel directly inside the popup with Today / Week / Total stats and stacked close-reason breakdown.'
      },
      {
        type: 'improved',
        text: 'Streamlined navigation and removed legacy standalone history page files.'
      }
    ]
  },
  {
    version: '1.4.3',
    headline: 'Live Active Tab Sync & Expanded Footer',
    summary: 'Smoother experience when keeping QuIt Tabs open in Side Panel mode.',
    changes: [
      {
        type: 'improved',
        text: 'Synchronized popup and side panel UI live whenever you switch active tabs.'
      },
      {
        type: 'improved',
        text: 'Relocated header action buttons to the footer in expanded Side Panel mode for easier one-hand access.'
      }
    ]
  },
  {
    version: '1.4.1',
    headline: 'Appearance Theme Picker',
    summary: 'Choose your preferred look independent of OS settings.',
    changes: [
      {
        type: 'new',
        text: 'Added System, Light, and Dark theme selector in Settings.'
      }
    ]
  },
  {
    version: '1.4.0',
    headline: 'Side Panel Mode & Closed Tabs History',
    summary: 'Major productivity release introducing persistent Side Panel mode and local tab history.',
    changes: [
      {
        type: 'new',
        text: 'Side Panel mode with expand/collapse toggle and persistent window mode preference.'
      },
      {
        type: 'new',
        text: 'Local closed-tabs history with one-click tab restore and configurable retention.'
      },
      {
        type: 'new',
        text: 'What\'s New banner to highlight major updates after upgrading.'
      }
    ]
  },
  {
    version: '1.3.1',
    headline: 'Window Titles & Polish',
    summary: 'Clearer multi-window organization and UI refinements.',
    changes: [
      {
        type: 'improved',
        text: 'Display the active tab\'s title in window headers instead of numeric window IDs.'
      }
    ]
  },
  {
    version: '1.3.0',
    headline: 'Modular Popup & Batch Action Menus',
    summary: 'Rebuilt popup architecture with faster batch workflows and tab previews.',
    changes: [
      {
        type: 'new',
        text: 'Custom batch action menu with group/window submenus and hover tab previews.'
      },
      {
        type: 'improved',
        text: 'Direct click selection in Edit mode and modularized popup codebase.'
      }
    ]
  },
  {
    version: '1.2.1',
    headline: 'Per-Site Timeouts & Quit All Preview',
    summary: 'Fine-grained timeout rules per domain and safer Quit All confirmation.',
    changes: [
      {
        type: 'new',
        text: 'Per-site timeout rules supporting exact domains and wildcard patterns (e.g. <code>*.example.com</code>).'
      },
      {
        type: 'improved',
        text: 'Visual red highlighting for tabs targeted by Quit All during confirmation mode, plus cleaner Sortable.js drag ghost visuals.'
      },
      {
        type: 'fix',
        text: 'Prevented double logging of explicitly closed tabs in history.'
      }
    ]
  },
  {
    version: '1.0.1',
    headline: 'Context Menus & Drag-and-Drop Groups',
    summary: 'Full mouse-driven tab and group organization.',
    changes: [
      {
        type: 'new',
        text: 'Right-click context menus for tabs, tab groups, and windows.'
      },
      {
        type: 'new',
        text: 'Drag-and-drop tab reordering, group header dragging, and drag-to-merge tab groups.'
      }
    ]
  },
  {
    version: '1.0.0',
    headline: 'Initial Release',
    summary: 'The foundation of QuIt Tabs.',
    changes: [
      {
        type: 'new',
        text: 'Automatic inactive tab countdowns with macOS-native design.'
      },
      {
        type: 'new',
        text: 'One-click Tab Protection, Media auto-pause, Pinned tab controls, and Quit All.'
      },
      {
        type: 'new',
        text: 'QuIt macOS app integration via URL parameters (<code>quit_group</code>, <code>quit_color</code>, <code>quit_protect</code>).'
      }
    ]
  }
];

let activeFilter = 'all';
let searchQuery = '';

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function tagLabel(type) {
  if (type === 'new') return 'New';
  if (type === 'improved') return 'Improved';
  return 'Fix';
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const query = searchQuery.trim().toLowerCase();

  const filteredReleases = RELEASES.map((release, idx) => {
    const matchingChanges = release.changes.filter((item) => {
      if (activeFilter !== 'all' && item.type !== activeFilter) return false;
      if (!query) return true;
      const haystack = `${release.version} ${release.headline} ${release.summary} ${item.text}`.toLowerCase();
      return haystack.includes(query);
    });
    return { ...release, isLatest: idx === 0, changes: matchingChanges };
  }).filter((r) => r.changes.length > 0);

  if (filteredReleases.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  container.innerHTML = filteredReleases.map((release) => `
    <article class="release-card ${release.isLatest ? 'is-latest' : ''}">
      <div class="release-header">
        <div class="release-title-group">
          <span class="version-pill ${release.isLatest ? 'latest' : ''}">v${release.version}</span>
          ${release.isLatest ? '<span class="latest-badge">Latest</span>' : ''}
          <h2 class="release-headline">${release.headline}</h2>
        </div>
      </div>
      <p class="release-summary">${release.summary}</p>
      <ul class="change-list">
        ${release.changes.map((c) => `
          <li class="change-item">
            <span class="change-tag ${c.type}">${tagLabel(c.type)}</span>
            <span class="change-text">${c.text}</span>
          </li>
        `).join('')}
      </ul>
    </article>
  `).join('');
}

async function init() {
  try {
    const settings = await getSettings();
    applyTheme(settings.theme || 'system');

    if (chrome?.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      const badge = document.getElementById('currentVersionBadge');
      if (badge) badge.textContent = `v${manifest.version}`;
    }
  } catch {
    // Fallback if opened outside extension context
  }

  document.querySelectorAll('#filterGroup .filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('#filterGroup .filter-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderTimeline();
    });
  });

  document.getElementById('changelogSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTimeline();
  });

  renderTimeline();
}

init();
