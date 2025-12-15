/**
 * State Management Module
 * Global state variables and setters for the popup
 */

// ============================================================================
// Global State Variables
// ============================================================================

export let currentTab = null;
export let allTabs = [];
export let tabGroups = {}; // Store tab group info: { groupId: { title, color } }
export let tabStates = {};
export let settings = {};
export let groupByWindow = true; // Always show window groups
export let searchQuery = '';
export let editMode = false; // Edit mode for showing checkboxes
export let quitConfirmMode = false; // Quit all confirmation mode

// Selection state
export let selectedTabIds = new Set();

// Sortable.js instance
export let sortableInstance = null;

// Context menu state
export let contextMenuState = {
    visible: false,
    targetTabId: null,
    targetGroupId: null,
    targetWindowId: null,
    type: null // 'tab', 'group', or 'window'
};

// ============================================================================
// State Setters
// ============================================================================

export function setCurrentTab(tab) {
    currentTab = tab;
}

export function setAllTabs(tabs) {
    allTabs = tabs;
}

export function setTabGroups(groups) {
    tabGroups = groups;
}

export function setTabStates(states) {
    tabStates = states;
}

export function setSettings(newSettings) {
    settings = newSettings;
}

export function setGroupByWindow(value) {
    groupByWindow = value;
}

export function setSearchQuery(query) {
    searchQuery = query;
}

export function setEditMode(mode) {
    editMode = mode;
}

export function setQuitConfirmMode(mode) {
    quitConfirmMode = mode;
}

export function setSelectedTabIds(ids) {
    selectedTabIds = ids;
}

export function setSortableInstance(instance) {
    sortableInstance = instance;
}

export function setContextMenuState(state) {
    contextMenuState = state;
}

// ============================================================================
// State Utilities
// ============================================================================

export function clearSelectedTabIds() {
    selectedTabIds.clear();
}

export function addSelectedTabId(id) {
    selectedTabIds.add(id);
}

export function deleteSelectedTabId(id) {
    selectedTabIds.delete(id);
}
