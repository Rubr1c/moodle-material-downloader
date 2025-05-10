let downloadState = {
  isDownloadActive: false,
  lastProgressMessage: 'Ready',
  lastUiStateForPopup: 'idle',
  hasError: false,
  contentScriptActive: false,
};

const DEFAULT_IDLE_STATE = {
  isDownloadActive: false,
  lastProgressMessage: 'Ready',
  lastUiStateForPopup: 'idle',
  hasError: false,
  contentScriptActive: false,
};

chrome.runtime.onInstalled.addListener(() => {
  console.log('Moodle Downloader extension installed.');
  chrome.storage.local.set({ downloadState: DEFAULT_IDLE_STATE });
});

chrome.storage.local.get('downloadState', (data) => {
  if (data.downloadState) {
    downloadState = data.downloadState;
    console.log('Background: Loaded state from storage', downloadState);
    if (
      downloadState.isDownloadActive ||
      downloadState.lastUiStateForPopup === 'downloading' ||
      downloadState.lastUiStateForPopup === 'cancelling'
    ) {
      console.log(
        'Background: Resetting potentially stale active download state on startup.'
      );
      updateAndStoreState(DEFAULT_IDLE_STATE);
    }
  } else {
    updateAndStoreState(DEFAULT_IDLE_STATE);
  }
});

function updateAndStoreState(newStateProperties) {
  downloadState = { ...downloadState, ...newStateProperties };
  chrome.storage.local.set({ downloadState });
  console.log('Background: State updated', downloadState);
  // Relay updated state to any open popup immediately
  chrome.runtime.sendMessage({
    action: 'stateUpdateFromBackground',
    newState: downloadState,
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(
    'Background received message:',
    request,
    'from sender:',
    sender && sender.tab
      ? `tab ${sender.tab.id}`
      : sender && sender.id
      ? `extension ${sender.id}`
      : 'unknown'
  );

  if (request.action === 'startDownload') {
    console.log('Background: Received startDownload from popup');
    updateAndStoreState({
      isDownloadActive: true,
      lastProgressMessage: 'Initializing download...',
      lastUiStateForPopup: 'downloading',
      hasError: false,
      contentScriptActive: false,
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'startDownload', from: 'background' },
          (contentResponse) => {
            if (chrome.runtime.lastError) {
              console.error(
                'Background: Error relaying startDownload to content:',
                chrome.runtime.lastError.message
              );
              updateAndStoreState({
                ...DEFAULT_IDLE_STATE,
                lastProgressMessage: `Error starting: ${chrome.runtime.lastError.message}`,
                hasError: true,
                lastUiStateForPopup: 'failed',
              });
              if (sendResponse)
                sendResponse({
                  status: 'failed',
                  error: `Relay error: ${chrome.runtime.lastError.message}`,
                });
            } else {
              console.log(
                'Background: Content script ack for startDownload:',
                contentResponse
              );
              if (
                contentResponse &&
                contentResponse.status === 'success_starting'
              ) {
                updateAndStoreState({ contentScriptActive: true }); // Now it's truly active in content script
                if (sendResponse) sendResponse({ status: 'success_relayed' });
              } else {
                const errorMsg =
                  (contentResponse && contentResponse.error) ||
                  'Content script failed to start or unknown response.';
                updateAndStoreState({
                  ...DEFAULT_IDLE_STATE,
                  lastProgressMessage: errorMsg,
                  hasError: true,
                  lastUiStateForPopup: 'failed',
                });
                if (sendResponse)
                  sendResponse({ status: 'failed', error: errorMsg });
              }
            }
          }
        );
      } else {
        updateAndStoreState({
          ...DEFAULT_IDLE_STATE,
          lastProgressMessage: 'No active tab for startDownload',
          hasError: true,
          lastUiStateForPopup: 'failed',
        });
        if (sendResponse)
          sendResponse({ status: 'failed', error: 'No active tab' });
      }
    });
    return true;
  } else if (request.action === 'cancelDownload') {
    console.log('Background: Received cancelDownload from popup');
    if (!downloadState.isDownloadActive && !downloadState.contentScriptActive) {
      console.log('Background: No active download to cancel.');
      updateAndStoreState(DEFAULT_IDLE_STATE);
      if (sendResponse) sendResponse({ status: 'idle' }); // Or status: 'not_active'
      return false;
    }
    updateAndStoreState({
      lastProgressMessage: 'Cancelling...',
      lastUiStateForPopup: 'cancelling',
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'cancelDownload', from: 'background' },
          (contentResponse) => {
            if (chrome.runtime.lastError) {
              console.error(
                'Background: Error relaying cancelDownload to content:',
                chrome.runtime.lastError.message
              );
              updateAndStoreState({
                lastProgressMessage: `Cancel relay error. May be stuck. ${chrome.runtime.lastError.message}`,
                hasError: true,
              });
              if (sendResponse)
                sendResponse({ status: 'failed', error: 'Relay error' });
            } else {
              console.log(
                'Background: Content script ack for cancelDownload:',
                contentResponse
              );
              if (
                contentResponse &&
                (contentResponse.status === 'cancelled' ||
                  contentResponse.status === 'cancelling_acknowledged')
              ) {
                updateAndStoreState(DEFAULT_IDLE_STATE); // Successfully cancelled, go to idle
                if (sendResponse) sendResponse({ status: 'cancelled' });
              } else {
                console.warn(
                  'Background: Content script did not confirm cancellation properly.',
                  contentResponse
                );
                updateAndStoreState({
                  ...DEFAULT_IDLE_STATE,
                  lastProgressMessage:
                    'Cancellation attempt made, but state unclear.',
                  lastUiStateForPopup: 'failed',
                  hasError: true,
                });
                if (sendResponse)
                  sendResponse({
                    status: 'failed',
                    error: 'Cancel state unclear',
                  });
              }
            }
          }
        );
      } else {
        updateAndStoreState({
          ...DEFAULT_IDLE_STATE,
          lastProgressMessage: 'No active tab for cancel',
          hasError: true,
          lastUiStateForPopup: 'failed',
        });
        if (sendResponse)
          sendResponse({ status: 'failed', error: 'No active tab for cancel' });
      }
    });
    return true;
  } else if (request.action === 'progressUpdate') {
    if (downloadState.isDownloadActive || downloadState.contentScriptActive) {
      updateAndStoreState({ lastProgressMessage: request.statusText });
    }
    if (sendResponse) sendResponse({ received: true });
  } else if (request.action === 'downloadStatus') {
    console.log(
      'Background: Received final downloadStatus from content script',
      request
    );
    if (request.status === 'complete') {
      updateAndStoreState({
        ...DEFAULT_IDLE_STATE,
        lastProgressMessage: 'Download complete!',
        lastUiStateForPopup: 'completed',
      });
    } else if (request.status === 'failed') {
      updateAndStoreState({
        ...DEFAULT_IDLE_STATE,
        lastProgressMessage: request.error || 'Download failed.',
        lastUiStateForPopup: 'failed',
        hasError: true,
      });
    } else if (request.status === 'cancelled') {
      updateAndStoreState(DEFAULT_IDLE_STATE);
    }
    if (sendResponse) sendResponse({ received: true });
  } else if (request.action === 'getDownloadState') {
    if (sendResponse) sendResponse(downloadState);
  } else if (request.action === 'checkMoodlePage') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, request, (contentResponse) => {
          if (chrome.runtime.lastError) {
            console.error(
              'Background: Error relaying checkMoodlePage to content:',
              chrome.runtime.lastError.message
            );
            if (sendResponse)
              sendResponse({ error: chrome.runtime.lastError.message });
            return;
          }
          if (sendResponse) sendResponse(contentResponse);
        });
      } else {
        if (sendResponse)
          sendResponse({ error: 'No active tab for checkMoodlePage' });
      }
    });
    return true;
  }
  return request.action === 'getDownloadState' ? false : true;
});

console.log('Background script (v2) loaded and listeners attached.');
