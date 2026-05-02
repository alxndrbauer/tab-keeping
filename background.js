// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
    // Ensure default settings exist in storage (Zen may clear storage on restart)
    const existing = await browser.storage.local.get([
      'unloadAfterMinutes',
      'closeAfterMinutes'
    ]);
    if (existing.unloadAfterMinutes === undefined || existing.closeAfterMinutes === undefined) {
      await browser.storage.local.set({
        unloadAfterMinutes: DEFAULT_SETTINGS.unloadAfterMinutes,
        closeAfterMinutes: DEFAULT_SETTINGS.closeAfterMinutes
      });
    }

    const result = await browser.storage.local.get({ _tabDiscardedAt: {} });
    tabDiscardedAt = result._tabDiscardedAt || {};

    const tabs = await browser.tabs.query({});
    const knownIds = new Set(tabs.map(t => String(t.id)));
    let changed = false;

    for (const id of Object.keys(tabDiscardedAt)) {
      if (!knownIds.has(id)) { delete tabDiscardedAt[id]; changed = true; }
    }
    for (const tab of tabs) {
      if (tab.discarded && !tabDiscardedAt[tab.id]) {
        tabDiscardedAt[tab.id] = tab.lastAccessed || Date.now();
        changed = true;
      }
    }
    if (changed) await saveDiscardedAt();
    console.log('[Tab Keeping] Ready, tracking', Object.keys(tabDiscardedAt).length, 'discarded tabs');
  } catch (e) {
    console.error('[Tab Keeping] loadDiscardedAt failed:', e);
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

// ── Alarm handler ────────────────────────────────────────────────────────────

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tabCheck') return;

  const settings = await getSettings();
  const unloadAfterMs = settings.unloadAfterMinutes * 60 * 1000;
  const closeAfterMs = settings.closeAfterMinutes * 60 * 1000;
  const now = Date.now();
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (tab.active) continue;

    if (!tab.discarded) {
      if (now - (tab.lastAccessed || 0) > unloadAfterMs) {
        try {
          await browser.tabs.discard(tab.id);
          console.log(`[Tab Keeping] Unloaded: ${tab.title}`);
        } catch (e) {
          console.error(`[Tab Keeping] Unload failed for tab ${tab.id}:`, e);
        }
      }
    }

    if (tab.discarded && !tab.pinned) {
      const t = tabDiscardedAt[tab.id];
      if (t && now - t > closeAfterMs) {
        try {
          await browser.tabs.remove(tab.id);
          console.log(`[Tab Keeping] Closed: ${tab.title}`);
        } catch (e) {
          console.error(`[Tab Keeping] Close failed for tab ${tab.id}:`, e);
        }
      }
    }
  }
});

// ── Ping handler (content script workaround for Zen startup bug) ─────────────
// With persistent:true the background is alive but onStartup may not fire.
// The content script pings on every page load; if the alarm is missing we
// know initialization was skipped and we kick it off here.

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ping') {
    return browser.alarms.get('tabCheck').then(alarm => {
      return { type: 'pong', initialized: !!alarm };
    });
  }
});

// ── Startup ──────────────────────────────────────────────────────────────────

browser.runtime.onStartup.addListener(async () => {
  await loadDiscardedAt();
});

browser.runtime.onInstalled.addListener(async () => {
  await loadDiscardedAt();
});

// Zen Browser does not fire onStartup reliably.
// When Zen restores sessions it creates windows, so we listen for onCreated
// as a fallback to kick off initialization.
browser.windows.onCreated.addListener(() => {
  initOnce();
});

// Also try onStartup for other browsers / future Zen versions.
browser.windows.getAll().then(() => {
  initOnce();
});

function initOnce() {
  loadDiscardedAt();
  browser.alarms.get('tabCheck').then(alarm => {
    if (!alarm) browser.alarms.create('tabCheck', { periodInMinutes: 1 });
  });
}
