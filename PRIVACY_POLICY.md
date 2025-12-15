# Privacy Policy for QuIt Tabs

**Last Updated:** December 15, 2025

This Privacy Policy describes how **QuIt Tabs** ("we", "us", or "our") collects, uses, and discloses information when you use our Chrome Extension.

We are committed to protecting your privacy. **QuIt Tabs is designed to be privacy-first and operates entirely on your local device.** We do not collect, store, or transmit your personal data, browsing history, or settings to any external servers.

## 1. Data Collection and Usage

**QuIt Tabs** processes the following data locally on your machine to provide its core functionality:

*   **Tabs and Browsing Activity:** The extension monitors the activity status of your open tabs (e.g., when they were last accessed) to determine if they should be auto-closed. This data resides solely in your browser's memory and local storage. It is never sent to us or any third parties.
*   **Settings and Preferences:** Your configuration settings (e.g., custom timers, protected tabs, "Single Window Mode" preference) are saved using Chrome's `storage` API. This data is synced across your signed-in Chrome browsers if you have Chrome Sync enabled, but it is handled directly by Chrome and is not accessible to us.
*   **Extension History (Local Only):** We store a separate, local log of tabs closed *specifically by QuIt Tabs*. This allows you to review and restore auto-closed tabs conveniently. **Use of this feature does NOT read, modify, or interact with your standard browser history.** This log is stored exclusively in your browser's local storage and is never transmitted anywhere. You can clear this extension-specific history at any time.
*   **Window Focus:** We track which browser window is currently in focus to support the "Single Window Mode" feature. This interaction data is transient and used only for immediate logic.

## 2. Permissions

We request the following permissions to function:

*   **`tabs`**: Required to read the status of your tabs, detect inactivity, and close them when the timer expires.
*   **`tabGroups`**: Required to handle tabs that are part of a group properly.
*   **`activeTab`**: Used to identify the currently active tab to prevent it from being closed.
*   **`storage`**: Used to save your extension settings locally.
*   **`alarms`**: Used to schedule the background checks for tab inactivity.

**We do NOT use these permissions to track your browsing history for advertising, marketing, or data mining purposes.**

## 3. Third-Party Services

**QuIt Tabs** does not integrate with any third-party analytics, tracking, or advertising services. Your data remains yours.

## 4. Updates to This Policy

We may update this Privacy Policy from time to time. If we make material changes, we will notify you by updating the date at the top of this policy and potentially via a notice within the extension.

## 5. Contact Us

If you have any questions about this Privacy Policy, please contact us at GitHub Issues: https://github.com/moseiei132/QuIt-Tabs/issues
