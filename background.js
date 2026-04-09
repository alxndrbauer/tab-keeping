// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Discarded timestamps — persisted to survive browser restarts.
// tabLastActive is NOT stored: we use tab.lastAccessed from the browser instead.
let tabDiscardedAt = {};

const DEFAULT_SETTINGS = {
  unloadAfterMinutes: 30,
  closeAfterMinutes: 1440
};

async function getSettings() {
  try {
    return await browser.storage.local.get(DEFAULT_SETTINGS);
  } catch (e) {
    console.error('[Tab Keeping] Failed to read settings:', e);
    return DEFAULT_SETTINGS;
  }
}

async function saveDiscardedAt() {
  try {
    await browser.storage.local.set({ _tabDiscardedAt: tabDiscardedAt });
  } catch (e) {
    console.error('[Tab Keeping] Failed to save discardedAt:', e);
  }
}

async function loadDiscardedAt() {
  try {
    const result = await browser.storage.local.get({ _tabDiscardedAt: {} });
    tabDiscardedAt = result._tabDiscardedAt || {};

    // Prune entries for tabs that no longer exist
    const tabs = await browser.tabs.query({});
    const knownIds = new Set(tabs.map(t => String(t.id)));
    let pruned = false;
    for (const id of Object.keys(tabDiscardedAt)) {
      if (!knownIds.has(id)) {
        delete tabDiscardedAt[id];
        pruned = true;
      }
    }
    // Seed discard time for already-discarded tabs we haven't seen before
    for (const tab of tabs) {
      if (tab.discarded && !tabDiscardedAt[tab.id]) {
        tabDiscardedAt[tab.id] = tab.lastAccessed || Date.now();
        pruned = true;
      }
    }
    if (pruned) await saveDiscardedAt();
    console.log('[Tab Keeping] Loaded, tracking', Object.keys(tabDiscardedAt).length, 'discarded tabs');
  } catch (e) {
    console.error('[Tab Keeping] Failed to load discardedAt:', e);
  }
}

// ── Event listeners ──────────────────────────────────────────────────────────

browser.tabs.onCreated.addListener((tab) => {
  if (tab.discarded && !tabDiscardedAt[tab.id]) {
    tabDiscardedAt[tab.id] = tab.lastAccessed || Date.now();
    saveDiscardedAt();
  }
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  if (tabDiscardedAt[tabId]) {
    delete tabDiscardedAt[tabId];
    saveDiscardedAt();
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.discarded === true && !tabDiscardedAt[tabId]) {
    tabDiscardedAt[tabId] = Date.now();
    saveDiscardedAt();
  }
  if (changeInfo.discarded === false && tabDiscardedAt[tabId]) {
    delete tabDiscardedAt[tabId];
    saveDiscardedAt();
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabDiscardedAt[tabId]) {
    delete tabDiscardedAt[tabId];
    saveDiscardedAt();
  }
});

// ── Main alarm ───────────────────────────────────────────────────────────────

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'initDelay') {
    await loadDiscardedAt();
    return;
  }

  if (alarm.name !== 'tabCheck') return;

  const settings = await getSettings();
  const unloadAfterMs = settings.unloadAfterMinutes * 60 * 1000;
  const closeAfterMs = settings.closeAfterMinutes * 60 * 1000;
  const now = Date.now();

  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (tab.active) continue;

    // Stage 1: unload inactive tabs (use tab.lastAccessed — no in-memory map needed)
    if (!tab.discarded) {
      const lastActive = tab.lastAccessed || 0;
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

// ── Startup ──────────────────────────────────────────────────────────────────

// Ensure the recurring check alarm exists
browser.alarms.get('tabCheck').then(alarm => {
  if (!alarm) browser.alarms.create('tabCheck', { periodInMinutes: 1 });
});

// Use a one-shot alarm (not setTimeout) to load state after session restore.
// Alarms survive background page suspension; setTimeout does not.
browser.alarms.create('initDelay', { delayInMinutes: 0.05 }); // ~3 seconds
