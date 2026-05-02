// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Zen Browser has a bug where extensions aren't properly initialized on startup.
// This content script runs on the first page load and pings the background.
// If there's no response or the alarm is missing, the extension reloads itself.

let retryCount = 0;
const MAX_RETRIES = 5;

function ping() {
  browser.runtime.sendMessage({ type: 'ping' })
    .then((response) => {
      if (!response || !response.initialized) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(ping, 1000);
        } else {
          browser.runtime.reload();
        }
      }
    })
    .catch(() => {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(ping, 1000);
      } else {
        browser.runtime.reload();
      }
    });
}

ping();
