# QuIt-Tabs

> Automatically close inactive browser tabs with elegant macOS-native design

A Chrome extension that automatically closes inactive tabs after a configurable countdown, helping you maintain a clean and organized browser workspace.

## ✨ Features

### Smart Tab Management
- ⏱️ **Automatic Countdown** - Tabs start counting down when you leave them
- 🎯 **Exclusion Rule Types** - Granular control over what gets protected
- 📊 **Real-time Display** - See countdown timers for all tabs at a glance
- 🛡️ **Flexible Protection** - Never close important tabs
- 🖱️ **Drag-and-Drop** - Reorder tabs or move between windows by dragging
- 🔀 **Merge Duplicates** - One-click to close duplicate tabs (same URL)
- 👆 **Click to Switch** - Click any tab in the list to instantly switch to it

### Tab Groups & Batch Operations (NEW!)
- 📁 **Chrome Tab Groups** - Full visual representation of tab groups with colors
- ✏️ **Edit Mode** - Select multiple tabs with checkboxes for batch operations
- 📦 **Batch Move to Group** - Move selected tabs to any existing tab group
- 🪟 **Batch Move to Window** - Move selected tabs between windows
- 🔓 **Batch Ungroup** - Remove selected tabs from their groups
- 🔍 **Search Tabs** - Quickly filter tabs by title or URL

### QuIt App Integration (NEW!)
Works with [QuIt macOS App](https://github.com/moseiei132/QuIt) for seamless tab management:
- 🔗 **URL Parameters** - Open tabs with auto-grouping via `quit_group` parameter
- 🎨 **Auto-Color Groups** - Set group color via `quit_color` parameter
- ⏸️ **Auto-Pause** - Pause countdown via `quit_pause` parameter
- 🔄 **Duplicate Detection** - Prevents opening duplicate tabs from QuIt app
- 🧹 **URL Cleaning** - Automatically removes QuIt parameters after processing

### Website Presets (NEW!)
- 🌐 **Smart Recognition** - Recognizes popular websites for better UX
- 📝 **Preset Labels** - Shows friendly names in exclusion modal
- ⚡ **Query String Detection** - Auto-detects search pages to preserve URLs

### Media Detection (NEW!)
- 🎵 **Pause on Media** - Don't close tabs playing audio/video
- 🔊 **Visual Indicator** - Shows play icon on tabs with active media

### Exclusion Rules
Protect tabs from auto-closing with powerful pattern matching:

1. **Exact URL** - Protect specific URL with query params
2. **Path (This Page)** - Protect a specific page path
3. **Domain (All Pages)** - Protect entire domain
4. **Domain (Exact Match)** - Protect main domain only

#### Advanced Options
- 🔗 **Include Query String** - Toggle to preserve URL parameters
- 📊 **Live Preview** - See exactly what will be protected

### Advanced Features
- ⚙️ **Per-Tab Custom Timeouts** - Override global countdown for specific rules
- ⏸️ **Pause/Resume** - Temporarily pause countdown on any tab
- 🎨 **Native macOS Design** - Beautiful light/dark mode support
- 💾 **Import/Export** - Backup and share your rules
- 🎯 **Priority System** - Smart rule matching when multiple rules apply
- 👁️ **Current Tab Toggle** - Show/hide current tab section with eye icon

## 🖥️ Supported Browsers

**All Chromium-based browsers** (uses Chrome Extension Manifest V3):
- ✅ Google Chrome
- ✅ Microsoft Edge
- ✅ Brave
- ✅ Opera
- ✅ Vivaldi
- ✅ Arc
- ✅ Any other Chromium browser

**Coming soon:**
- 🔜 Firefox (requires minor API adjustments)
- 🔜 Safari (requires conversion tool)

## 📦 Installation

### From Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/moseiei132/QuIt-Tabs.git
   cd QuIt-Tabs
   ```

2. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `QuIt-Tabs` folder

3. **Start using!**
   - Click the extension icon in your toolbar
   - Configure your preferred countdown time
   - Add exclusion rules for sites you want to protect

## 🎯 Usage

### Basic Setup

1. **Configure Global Countdown**
   - Click the extension icon
   - Go to Settings
   - Set your preferred countdown time (default: 5 minutes)

2. **Add Exclusion Rules**
   - Navigate to a page you want to protect
   - Click the extension icon
   - Click "Exclude"
   - Choose the rule type that fits your need
   - Click "Add Rule"

### Understanding Tab States

- **Active** - Currently viewing (no countdown)
- **4:59** - Counting down, will close in 4 minutes 59 seconds
- **∞** - Protected by exclusion rule (never closes)
- **⏸** - Countdown paused

### Rule Examples

**Protect all GitHub pages:**
- Type: All Pages on Domain
- Pattern: `github.com/*`

**Protect only your Google Drive:**
- Type: Current Path + Subpaths
- Pattern: `drive.google.com/drive/*`

**Protect exact search result:**
- Type: Exact URL
- Pattern: Full URL with query parameters

## ⚙️ Settings

### General Settings
- **Enable Extension** - Turn on/off auto-closing
- **Global Countdown** - Default time before closing (1-60 minutes)
- **Auto-close Pinned Tabs** - Include pinned tabs in countdown
- **Pause on Media** - Don't close tabs playing audio/video

### Exclusion Rules
- View all your protection rules
- Edit or delete existing rules
- Import/export rule sets

## 🛠️ Development

### Built With
- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- macOS native design system
- Web Extensions API

### Project Structure
```
QuIt-Tabs/
├── manifest.json          # Extension manifest (V3)
├── background.js          # Service worker - tab states, countdown, alarms
├── popup/                 # Extension popup
│   ├── popup.html         # Main popup UI
│   ├── popup.js           # Popup logic, tab rendering, batch operations
│   ├── popup.css          # Popup styling
│   └── modal.css          # Exclusion modal styling
├── options/               # Settings page
│   ├── options.html
│   ├── options.js
│   └── options.css
├── utils/                 # Shared utilities
│   ├── storage.js         # Settings and state persistence
│   ├── matcher.js         # URL pattern matching with priority
│   ├── quit-integration.js # QuIt app URL parameter handling
│   └── search-detector.js  # Search page detection for query strings
└── icons/                 # Extension icons
```

### Key Files
- **background.js** - Manages tab states, countdown logic, alarm handling, QuIt integration
- **popup/popup.js** - Main UI, exclusion modal, tab list, batch operations, edit mode
- **utils/matcher.js** - URL pattern matching with priority system
- **utils/storage.js** - Settings and state persistence
- **utils/quit-integration.js** - Handles QuIt app URL parameters
- **utils/search-detector.js** - Detects search URLs for query string handling

### Rule Priority
When multiple rules match a URL, the most specific rule wins:

1. Exact URL (highest priority)
2. Current Path Only
3. Current Path + Subpaths
4. Domain Only
5. Subdomains Only
6. All Pages on Domain
7. Domain + All Subdomains (lowest priority)

## 🎨 Design Philosophy

QuIt-Tabs follows macOS native design principles:
- SF Pro font family
- Adaptive light/dark mode
- Subtle shadows and borders
- Smooth animations
- Clean, minimalist interface

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

## 🔗 Related Projects

Part of the QuIt ecosystem:
- [QuIt](https://github.com/moseiei132/QuIt) - macOS app for automatically quitting inactive applications

## 👨‍💻 Author

**Dulyawat** - [GitHub](https://github.com/moseiei132)

## 🙏 Acknowledgments

Inspired by the need to maintain focus and reduce browser clutter during deep work sessions.

---

**Note:** This extension only starts counting down when you leave a tab. Active tabs are never closed, ensuring you never lose your current work.
