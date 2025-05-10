console.log('Moodle Downloader content script loaded.');

function isMoodleCoursePage() {
  const currentUrl = window.location.href;
  return currentUrl.includes('moodle') && currentUrl.includes('course');
}

function findSesskey(doc) {
  const sesskeyInput = doc.querySelector(
    'input[type="hidden"][name="sesskey"]'
  );
  if (sesskeyInput && sesskeyInput.value) {
    return sesskeyInput.value;
  }
  const scripts = doc.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent) {
      const match = script.textContent.match(
        /"sesskey"\s*:\s*"([A-Za-z0-9]+)"/
      );
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  return null;
}

async function processAndDownloadFiles() {
  chrome.runtime.sendMessage({
    action: 'downloadStatus',
    status: 'processing',
  });
  console.log('processAndDownloadFiles: Starting link discovery.');

  const finalDownloadableItems = [];
  const urlsToVisit = [];
  const processedOrScheduledUrls = new Set();
  const baseMoodleUrl = new URL(window.location.href).origin;

  if (isMoodleCoursePage()) {
    document
      .querySelectorAll(
        'a.aalink.stretched-link, a.grid-section-inner.d-flex.flex-column.h-100, a.aalink[href*="/folder/view.php"], a.aalink[href*="/resource/view.php"]'
      )
      .forEach((a) => {
        if (a.href) {
          const absUrl = new URL(a.href, document.baseURI).href;
          if (!processedOrScheduledUrls.has(absUrl)) {
            urlsToVisit.push(absUrl);
            processedOrScheduledUrls.add(absUrl);
            console.log(`Initial scan: Added to visit queue - ${absUrl}`);
          }
        }
      });
  } else {
    console.warn(
      'Not on a Moodle course page, or initial link scan failed to identify it as such.'
    );
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'failed',
      error: 'Not a Moodle course page',
    });
    return { status: 'failed', error: 'Not a Moodle course page' };
  }

  if (urlsToVisit.length === 0) {
    console.warn('No initial links found on the course page to process.');
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'failed',
      error: 'No initial links found',
    });
    return { status: 'failed', error: 'No initial links found' };
  }

  while (urlsToVisit.length > 0) {
    const currentUrl = urlsToVisit.shift();
    console.log(`Processing from queue: ${currentUrl}`);

    try {
      const pageResponse = await fetch(currentUrl);
      if (!pageResponse.ok) {
        console.warn(
          `Failed to fetch ${currentUrl}, status: ${pageResponse.status}`
        );
        continue;
      }
      const pageHtml = await pageResponse.text();
      const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
      const pageBaseUrl = pageResponse.url;

      if (currentUrl.includes('/mod/folder/view.php')) {
        console.log(`Identified as FOLDER page: ${currentUrl}`);
        let folderZipUrlConstructed = false;
        let downloadForm;
        const buttons = Array.from(
          pageDoc.querySelectorAll(
            'button[type="submit"], input[type="submit" i]'
          )
        );
        const downloadFolderButton = buttons.find(
          (btn) =>
            (btn.textContent &&
              btn.textContent
                .trim()
                .toLowerCase()
                .includes('download folder')) ||
            (btn.value &&
              btn.value.trim().toLowerCase().includes('download folder'))
        );

        if (downloadFolderButton)
          downloadForm = downloadFolderButton.closest('form');

        if (downloadForm) {
          const actionAttr =
            downloadForm.getAttribute('action') ||
            downloadFolderButton.getAttribute('formaction');
          const formActionUrl = actionAttr
            ? new URL(actionAttr, pageBaseUrl).href
            : null;
          const folderIdInput = downloadForm.querySelector('input[name="id"]');
          const folderId = folderIdInput
            ? folderIdInput.value
            : new URL(currentUrl).searchParams.get('id');
          const sesskey = findSesskey(pageDoc);

          if (folderId && sesskey) {
            const folderZipUrl = new URL(
              `${baseMoodleUrl}/mod/folder/download_folder.php`
            );
            folderZipUrl.searchParams.set('id', folderId);
            folderZipUrl.searchParams.set('sesskey', sesskey);
            console.log(`Constructed FOLDER ZIP URL: ${folderZipUrl.href}`);
            if (!processedOrScheduledUrls.has(folderZipUrl.href)) {
              finalDownloadableItems.push({
                url: folderZipUrl.href,
                type: 'folder_zip',
              });
              processedOrScheduledUrls.add(folderZipUrl.href); // Mark this specific download URL as processed
            }
            folderZipUrlConstructed = true;
          } else {
            console.warn(
              `Could not find all details for folder ZIP URL (ID: ${folderId}, Sesskey: ${sesskey}) for ${currentUrl}`
            );
          }
        }
        if (!folderZipUrlConstructed) {
          console.warn(
            `Could not get folder ZIP URL for ${currentUrl}. Scanning for individual files inside.`
          );
          pageDoc
            .querySelectorAll(
              'a.aalink[href*="resource/view.php"], a[href*="pluginfile.php"]'
            )
            .forEach((a) => {
              if (a.href) {
                const absLink = new URL(a.href, pageBaseUrl).href;
                if (!processedOrScheduledUrls.has(absLink)) {
                  urlsToVisit.push(absLink);
                  processedOrScheduledUrls.add(absLink);
                  console.log(
                    `Folder Fallback: Added to visit queue - ${absLink}`
                  );
                }
              }
            });
        }
      } else if (
        currentUrl.includes('/mod/resource/view.php') ||
        currentUrl.includes('pluginfile.php')
      ) {
        console.log(`Identified as RESOURCE/PLUGINFILE page: ${currentUrl}`);
        if (!finalDownloadableItems.some((item) => item.url === currentUrl)) {
          finalDownloadableItems.push({ url: currentUrl, type: 'file' });
        }
      } else {
        console.log(
          `Scanning general Moodle page: ${currentUrl} for more links.`
        );
        pageDoc
          .querySelectorAll(
            'a.aalink[href*="/folder/view.php"], a.aalink[href*="/resource/view.php"]'
          )
          .forEach((a) => {
            if (a.href) {
              const absLink = new URL(a.href, pageBaseUrl).href;
              if (!processedOrScheduledUrls.has(absLink)) {
                urlsToVisit.push(absLink);
                processedOrScheduledUrls.add(absLink);
                console.log(`General Scan: Added to visit queue - ${absLink}`);
              }
            }
          });
      }
    } catch (err) {
      console.warn(
        `Error processing URL ${currentUrl} in discovery loop:`,
        err
      );
    }
  }

  console.log(
    'Link discovery phase complete. Final items to download:',
    finalDownloadableItems
  );

  if (finalDownloadableItems.length === 0) {
    console.warn('No downloadable items found after full scan.');
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'failed',
      error: 'No items found after scan',
    });
    return { status: 'failed', error: 'No items found after scan' };
  }

  const zip = new JSZip();
  let filesAddedToZip = 0;

  for (const item of finalDownloadableItems) {
    let actualFileUrl = item.url;
    let responseForFile;
    let originalPageUrlForFilenameFallback = item.url;

    try {
      console.log(`Downloading item: ${item.url} (type: ${item.type})`);

      if (
        item.type === 'file' &&
        actualFileUrl.includes('/resource/view.php')
      ) {
        console.log(
          `Fetching resource page: ${actualFileUrl} to find actual file link or handle redirect.`
        );
        const resourcePageResponse = await fetch(actualFileUrl);
        if (!resourcePageResponse.ok) {
          console.warn(
            `Failed to fetch resource page ${actualFileUrl}, status: ${resourcePageResponse.status}`
          );
          continue;
        }
        originalPageUrlForFilenameFallback = actualFileUrl;

        if (
          resourcePageResponse.url !== actualFileUrl &&
          (resourcePageResponse.url.includes('pluginfile.php') ||
            !resourcePageResponse.headers
              .get('content-type')
              ?.includes('text/html'))
        ) {
          console.log(
            `Redirected from ${actualFileUrl} to ${resourcePageResponse.url}`
          );
          actualFileUrl = resourcePageResponse.url;
          responseForFile = resourcePageResponse;
        } else {
          const resourcePageHtml = await resourcePageResponse.text();
          const resourcePageDoc = new DOMParser().parseFromString(
            resourcePageHtml,
            'text/html'
          );
          const downloadLinkElement = resourcePageDoc.querySelector(
            'div[role="main"] a[href*="pluginfile.php"],' +
              'div.resourceworkaround a[href*="pluginfile.php"],' +
              'div.resourcecontent a[href*="pluginfile.php"],' +
              'section#region-main a[href*="pluginfile.php"],' +
              'section#region-main div.box.generalbox a[href*="pluginfile.php"]'
          );
          if (downloadLinkElement && downloadLinkElement.href) {
            actualFileUrl = new URL(
              downloadLinkElement.href,
              resourcePageResponse.url
            ).href;
            console.log(
              `Found actual file URL on resource page ${originalPageUrlForFilenameFallback}: ${actualFileUrl}`
            );
          } else {
            console.warn(
              `No direct pluginfile.php link found on ${originalPageUrlForFilenameFallback}. Will attempt to download the page itself or rely on redirect for ${actualFileUrl}.`
            );
          }
        }
      }

      if (!responseForFile) {
        console.log(`Fetching actual file content from: ${actualFileUrl}`);
        responseForFile = await fetch(actualFileUrl); // This is for item.type 'folder_zip' or resolved 'file'
      }

      if (!responseForFile.ok) {
        console.warn(
          `Failed to fetch actual file content ${actualFileUrl}, status: ${responseForFile.status}`
        );
        continue;
      }

      const blob = await responseForFile.blob();
      let filename = null;
      const disposition = responseForFile.headers.get('content-disposition');
      if (disposition && disposition.includes('attachment')) {
        const filenameRegex = /filename\*?=(?:UTF-8'')?([^;\r\n]+|"([^"]*)")/i;
        const matches = filenameRegex.exec(disposition);
        if (matches != null) {
          if (matches[2]) {
            filename = decodeURIComponent(matches[2]);
          } else if (matches[1]) {
            filename = decodeURIComponent(matches[1]);
          }
        }
        if (filename) filename = filename.replace(/['"]/g, '');
      }

      if (!filename) {
        try {
          const path = new URL(actualFileUrl).pathname;
          filename = decodeURIComponent(
            path.substring(path.lastIndexOf('/') + 1)
          );
        } catch (e) {
          console.warn('Error parsing URL for filename:', actualFileUrl, e);
        }
      }

      if (
        !filename ||
        filename.trim() === '' ||
        (item.type === 'file' && filename === 'view.php')
      ) {
        const urlParams = new URLSearchParams(
          new URL(originalPageUrlForFilenameFallback).search
        );
        const id = urlParams.get('id');
        filename = `${item.type}_${id || Date.now()}`;
        const typeExt = blob.type.split('/')[1];
        if (typeExt && !filename.includes('.')) {
          let ext = typeExt
            .replace(
              'vnd.openxmlformats-officedocument.wordprocessingml.document',
              'docx'
            )
            .replace('vnd.ms-powerpoint', 'ppt')
            .replace(
              'vnd.openxmlformats-officedocument.presentationml.presentation',
              'pptx'
            )
            .replace('x-zip-compressed', 'zip');
          if (
            ext === 'octet-stream' ||
            (ext === 'zip' && !actualFileUrl.toLowerCase().endsWith('.zip'))
          ) {
            if (actualFileUrl.toLowerCase().endsWith('.pdf')) ext = 'pdf';
            else if (actualFileUrl.toLowerCase().endsWith('.zip')) ext = 'zip';
            else if (actualFileUrl.toLowerCase().endsWith('.pptx'))
              ext = 'pptx';
            else if (actualFileUrl.toLowerCase().endsWith('.ppt')) ext = 'ppt';
            else if (actualFileUrl.toLowerCase().endsWith('.docx'))
              ext = 'docx';
            else if (item.type === 'folder_zip')
              ext = 'zip';
            else ext = '';
          }
          if (ext && ext !== 'octet-stream') filename += `.${ext}`;
        }
      }

      filename = filename
        .replace(/[^a-zA-Z0-9.\-_\s]/g, '_')
        .replace(/\s+/g, '_');

      zip.file(filename, blob);
      filesAddedToZip++;
      console.log(
        `Added ${filename} (from ${actualFileUrl}, type: ${item.type}) to main course zip.`
      );
    } catch (err) {
      console.warn(
        `Failed to process or add item ${item.url} (actual URL: ${actualFileUrl}) to zip:`,
        err
      );
    }
  }

  if (filesAddedToZip === 0) {
    console.warn('No files were successfully added to the main course zip.');
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'failed',
      error: 'No files zipped',
    });
    return { status: 'failed', error: 'No files zipped' };
  }

  try {
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    let courseName = 'course_materials';
    const courseNameElement = document.querySelector(
      'h1, .h1, header h1, #page-header h1'
    );
    if (courseNameElement) {
      courseName = courseNameElement.textContent
        .trim()
        .replace(/[^a-zA-Z0-9_\-]+/g, '_');
    }
    link.download = `${courseName}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    console.log('Main course zip file download triggered.');
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'complete',
    });
    return { status: 'success' };
  } catch (error) {
    console.error('Error generating or downloading main course zip:', error);
    chrome.runtime.sendMessage({
      action: 'downloadStatus',
      status: 'failed',
      error: 'Zip generation failed',
    });
    return { status: 'failed', error: 'Zip generation failed' };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownload') {
    console.log('Received startDownload message from popup.');
    processAndDownloadFiles()
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('Error in processAndDownloadFiles promise chain:', error);
        sendResponse({
          status: 'failed',
          error: error.message || 'Unknown error during download processing',
        });
      });
    return true;
  } else if (request.action === 'checkMoodlePage') {
    sendResponse({ isMoodleCoursePage: isMoodleCoursePage() });
    return false;
  }
});
