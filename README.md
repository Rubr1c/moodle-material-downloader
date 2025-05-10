# Moodle Course Material Downloader Chrome Extension

This Chrome extension helps users download course materials from Moodle sites more conveniently by attempting to gather all resources and folders into a single ZIP file.

## Features

- **One-Click Download:** Initiates the download process for available materials on a Moodle course page via the extension popup.
- **Resource Discovery:** Scans the Moodle course page for links to:
  - Individual files (PDFs, documents, etc.)
  - Moodle Folders
  - Pages that may contain links to resources.
- **Folder Handling:**
  - Attempts to use Moodle's "Download folder" functionality to grab an entire folder as a ZIP.
  - If direct folder download isn't available or fails, it scans the folder page for individual file links.
- **ZIP Packaging:** All collected files and folder ZIPs are packaged into a single downloadable ZIP file, named after the course if the title can be determined.
- **Progress Display:** The extension popup shows the current status of the download process (e.g., "Scanning...", "Downloading [filename]...", "Zipping...").
- **Cancel Functionality:** Allows the user to cancel the download process.
- **State Persistence (Basic):** The popup attempts to reflect the ongoing download state if closed and reopened (managed via the background script).

## How it Works

1.  **Popup (`popup.html`, `popup.js`):**

    - Provides the user interface (Download/Cancel buttons, status messages).
    - On opening, it queries the background script for the current download state to update its UI.
    - When "Download" is clicked, it sends a message to the background script to initiate the process.
    - When "Cancel" is clicked, it sends a message to the background script.
    - Listens for state and progress updates from the background script to update the UI.

2.  \*\*Background Script (`background.js`):

    - Acts as the central coordinator and state manager.
    - Stores the current download state (e.g., active, progress message, UI state for popup) using `chrome.storage.local` for basic persistence.
    - Relays commands (start, cancel) from the popup to the content script.
    - Receives progress and final status updates from the content script, updates its stored state, and relays these to the popup.
    - Resets potentially stale active download states on startup to prevent the UI from showing incorrect information after an extension reload.

3.  \*\*Content Script (`content.js`):
    - This is injected into Moodle course pages.
    - **Link Discovery:** When a download is initiated:
      - It first scans the main course page for links (resources, folders, other Moodle activity/section pages).
      - It maintains a queue of pages to visit and iteratively fetches them.
      - For **Folder pages** (`/mod/folder/view.php`), it tries to find a "Download folder" button and extract the necessary `id` and `sesskey` (session key) to construct a direct URL to download the folder as a ZIP.
      - If folder ZIP download fails, it scans the folder page for individual file links.
      - For **Resource pages** (`/mod/resource/view.php`), it notes the URL for later processing (which involves fetching this page to find the actual `pluginfile.php` link or following redirects).
      - For other general Moodle pages, it scans them for further resource or folder links.
    - **File Fetching & Zipping:**
      - Once all potential downloadable items are identified, it iterates through them.
      - For each item, it fetches the actual file content (handling redirects and parsing resource pages as needed).
      - It attempts to determine a correct filename using `Content-Disposition` headers or URL parsing.
      - Uses the [JSZip](https://stuk.github.io/jszip/) library to add each fetched file (or folder ZIP) into a main course ZIP.
    - **Communication:**
      - Sends progress updates (e.g., "Scanning X", "Downloading Y", "Zipping Z") and final status (success, failure, cancelled) to the background script.
      - Listens for cancellation signals.

## Files

- `manifest.json`: Defines the extension's properties, permissions, and scripts.
- `popup.html`: The HTML structure for the extension's popup.
- `popup.js`: Handles the logic and UI for the popup.
- `background.js`: Manages state and communication between the popup and content script.
- `content.js`: Injected into Moodle pages to find and download materials.
- `jszip.min.js`: The JSZip library (v3.7.1) used for creating ZIP files. (Bundled locally)
- `icon.png`: The extension icon (you may need to create 16x16, 48x48, and 128x128 versions as specified in `manifest.json`, or use this single one for all if your `icon.png` is suitable).

## How to Run Locally (for Development/Testing)

1.  **Clone or Download:** Get all the project files onto your local machine.
2.  **Ensure `jszip.min.js` is Present:** The file `jszip.min.js` must be in the root directory of the extension (alongside `manifest.json`). If it's missing, download it from a CDN like [cdnjs](https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js) and place it there.
3.  **Open Chrome Extensions:** Open Google Chrome and navigate to `chrome://extensions/`.
4.  **Enable Developer Mode:** In the top-right corner of the Extensions page, toggle "Developer mode" ON.
5.  **Load Unpacked:**
    - Click the "Load unpacked" button that appears (usually on the top-left).
    - In the file dialog, navigate to and select the **root folder** of this extension (the folder containing `manifest.json`).
6.  **Verify:** The "Moodle Course Material Downloader" extension should now appear in your list of extensions. Ensure there are no errors displayed on its card (if there are, click "Errors" to see details, often related to manifest issues or missing files).
7.  **Pin the Extension (Optional):** Click the puzzle piece icon (Extensions) in your Chrome toolbar, then click the pin icon next to the "Moodle Course Material Downloader" to make it easily accessible.

## Usage

1.  Navigate to a Moodle course page.
2.  Log in to Moodle if you haven't already.
3.  Click the extension icon in your Chrome toolbar.
4.  The popup should appear. If you are on a valid Moodle course page, the "Download Materials" button should be enabled.
5.  Click "Download Materials".
6.  The popup will display progress. A ZIP file containing the downloaded materials will eventually be saved to your browser's default download location.
7.  You can click "Cancel Download" during the process if needed.

## Important Considerations & Limitations

- **Moodle Version/Theme:** Moodle sites can vary significantly in their HTML structure depending on the Moodle version and the applied theme. The CSS selectors used in `content.js` to find links and the "Download folder" button might need adjustments for different Moodle instances.
- **Session/Authentication:** The extension relies on your active Moodle login session in the browser tab where it's used. If your session expires or you're not logged in, it won't be able to access course materials.
- **`sesskey`:** Moodle uses a `sesskey` (session key) for actions like downloading folders. The script attempts to find this key. If it can't, folder downloads via the direct ZIP method might fail.
- **Complex Content Types:** Some Moodle resources might be embedded content, external links, or activities (like quizzes) that are not directly downloadable as files. This extension primarily focuses on downloadable files and folders.
- **Rate Limiting/Server Load:** Downloading many files quickly could potentially put a strain on the Moodle server or trigger rate-limiting if the server has such protections. Use responsibly.
- **Error Handling:** While basic error handling and status updates are in place, complex or unexpected Moodle page structures might lead to errors or missed files.
- **Security:** The extension requests `activeTab` and `storage` permissions. `activeTab` is used to interact with the current Moodle page. `storage` is used by the background script to save basic download state.

## License

This project is likely to be under your own desired license. Remember to include the license for JSZip:

- **JSZip:** (c) 2009-2016 Stuart Knightley - Dual licensed under the MIT license or GPLv3. (The bundled `jszip.min.js` file contains the license header).
