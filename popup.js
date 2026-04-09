// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Load settings when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await browser.storage.local.get({
    unloadAfterMinutes: 30,
    closeAfterMinutes: 1440
  });

  document.getElementById('unloadTime').value = settings.unloadAfterMinutes;
  document.getElementById('closeTime').value = settings.closeAfterMinutes;
});

// Save settings when button is clicked
document.getElementById('saveBtn').addEventListener('click', async () => {
  const unloadTime = parseFloat(document.getElementById('unloadTime').value);
  const closeTime = parseFloat(document.getElementById('closeTime').value);

  // Validate inputs
  if (isNaN(unloadTime) || unloadTime < 1) {
    showStatus('Invalid unload time (min 1)', 'error');
    return;
  }
  if (isNaN(closeTime) || closeTime < 1) {
    showStatus('Invalid close time (min 1)', 'error');
    return;
  }
  if (closeTime < unloadTime) {
    showStatus('Close time must be >= unload time', 'error');
    return;
  }

  // Save to storage
  await browser.storage.local.set({
    unloadAfterMinutes: unloadTime,
    closeAfterMinutes: closeTime
  });

  showStatus('Settings saved!', 'success');
  setTimeout(() => showStatus(''), 2000);
});

function showStatus(message, type = '') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}
