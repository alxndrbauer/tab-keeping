// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Tab activity tracking (in-memory)
const tabLastActive = new Map();

// Discarded timestamps — persisted to survive browser restarts
let tabDiscardedAt = {};

// Default settings
const DEFAULT_SETTINGS = {
  unloadAfterMinutes: 30,
  closeAfterMinutes: 1440
};

async function getSettings() {
  return browser.storage.local.get(DEFAULT_SETTINGS);
}

// Persist tabDiscardedAt to storage
function saveDiscardedAt() {
  browser.storage.local.set({ _tabDiscardedAt: tabDiscardedAt });
}

// Initialize on startup: load persisted state and sync with current tabs
async function initializeTabs() {
  // Restore persisted discard timestamps
  const stored = await browser.storage.local.get({ _tabDiscardedAt: {} });
  tabDiscardedAt = stored._tabDiscardedAt;

  const tabs = await browser.tabs.query({});
  const knownTabIds = new Set(tabs.map(t => t.id));

  // Remove stale entries for tabs that no longer exist
  for (const id of Object.keys(tabDiscardedAt)) {
    if (!knownTabIds.has(parseInt(id, 10))) {
      delete tabDiscardedAt[id];
    }
  }

  for (const tab of tabs) {
    if (tab.active) continue;

    // Use tab.lastAccessed (ms since epoch) as the activity baseline
    tabLastActive.set(tab.id, tab.lastAccessed || Date.now());

    // Record discard time for tabs already discarded but not yet tracked
    if (tab.discarded && !tabDiscardedAt[tab.id]) {
      // We don't know when it was discarded, so use the oldest signal we have:
      // lastAccessed is a reasonable proxy (discarded after last use)
      tabDiscardedAt[tab.id] = tab.lastAccessed || Date.now();
    }
  }

  saveDiscardedAt();
}

// Track tabs created during session restore (arrive after initializeTabs)
browser.tabs.onCreated.addListener((tab) => {
  if (tab.active) return;
  if (!tabLastActive.has(tab.id)) {
    tabLastActive.set(tab.id, tab.lastAccessed || Date.now());
  }
  if (tab.discarded && !tabDiscardedAt[tab.id]) {
    tabDiscardedAt[tab.id] = tab.lastAccessed || Date.now();
    saveDiscardedAt();
  }
});

// Track when tab becomes active
browser.tabs.onActivated.addListener(({ tabId }) => {
  tabLastActive.set(tabId, Date.now());
  // If the user revisits a discarded tab, Firefox reloads it automatically —
  // clear the discard timestamp so the close timer resets
  if (tabDiscardedAt[tabId]) {
    delete tabDiscardedAt[tabId];
    saveDiscardedAt();
  }
});

// Track discard state changes
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.discarded === true && !tabDiscardedAt[tabId]) {
    tabDiscardedAt[tabId] = Date.now();
    saveDiscardedAt();
  }

  // Tab was reloaded/un-discarded: reset discard timer
  if (changeInfo.discarded === false) {
    delete tabDiscardedAt[tabId];
    saveDiscardedAt();
  }

  if (tab.active) {
    tabLastActive.set(tabId, Date.now());
  }
});

// Cleanup when tab is removed
browser.tabs.onRemoved.addListener((tabId) => {
  tabLastActive.delete(tabId);
  delete tabDiscardedAt[tabId];
  saveDiscardedAt();
});

// Main alarm handler
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tabCheck') return;

  const settings = await getSettings();
  const unloadAfterMs = settings.unloadAfterMinutes * 60 * 1000;
  const closeAfterMs = settings.closeAfterMinutes * 60 * 1000;
  const now = Date.now();

  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (tab.active) continue;

    // Stage 1: unload inactive tabs
    if (!tab.discarded) {
      const lastActive = tabLastActive.get(tab.id) || tab.lastAccessed || 0;
      if (now - lastActive > unloadAfterMs) {
        try {
          await browser.tabs.discard(tab.id);
          console.log(`[Tab Keeping] Unloaded tab ${tab.id}: ${tab.title}`);
        } catch (e) {
          console.error(`[Tab Keeping] Failed to unload tab ${tab.id}:`, e);
        }
      }
    }

    // Stage 2: close discarded unpinned tabs
    if (tab.discarded && !tab.pinned) {
      const discardedTime = tabDiscardedAt[tab.id];
      if (discardedTime && now - discardedTime > closeAfterMs) {
        try {
          await browser.tabs.remove(tab.id);
          console.log(`[Tab Keeping] Closed tab ${tab.id}: ${tab.title}`);
        } catch (e) {
          console.error(`[Tab Keeping] Failed to close tab ${tab.id}:`, e);
        }
      }
    }
  }
});

// Ensure alarm exists (avoid duplicates on background script restart)
browser.alarms.get('tabCheck').then(alarm => {
  if (!alarm) {
    browser.alarms.create('tabCheck', { periodInMinutes: 1 });
  }
});

// On browser startup: wait for session restore to finish before initializing
browser.runtime.onStartup.addListener(() => {
  setTimeout(initializeTabs, 3000);
});

// On first install or update: initialize immediately
browser.runtime.onInstalled.addListener(initializeTabs);
