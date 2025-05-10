document.addEventListener('DOMContentLoaded', function () {
  const downloadBtn = document.getElementById('download-button');
  const cancelBtn = document.getElementById('cancel-button');
  const statusMessageEl = document.getElementById('status-message');

  function updateStatus(message, isError = false) {
    statusMessageEl.textContent = message;
    statusMessageEl.style.color = isError ? '#c0392b' : '#2c3e50';
  }

  function setUIState(state, message = null, isError = false) {
    switch (state) {
      case 'idle':
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download Materials';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        updateStatus(message || 'Ready');
        break;
      case 'checkingPage':
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Checking...';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        updateStatus(message || 'Verifying Moodle page...');
        break;
      case 'downloading':
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';
        cancelBtn.classList.remove('hidden');
        cancelBtn.disabled = false;
        if (message) updateStatus(message);
        break;
      case 'cancelling':
        downloadBtn.disabled = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
        updateStatus(message || 'Attempting to cancel...');
        break;
      case 'cancelled':
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download Materials';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancel Download';
        updateStatus(message || 'Download cancelled.');
        break;
      case 'completed':
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download Again';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        updateStatus(message || 'Download complete!');
        break;
      case 'failed':
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Retry Download';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        updateStatus(message || 'An error occurred.', true);
        break;
      case 'noActiveTab':
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Download Materials';
        cancelBtn.classList.add('hidden');
        cancelBtn.disabled = true;
        updateStatus(message || 'No active tab found.', true);
        break;
      default:
        console.warn('Unknown UI state:', state);
        setUIState('idle', `Unknown state: ${state}`);
    }
  }

  // On popup open, get current state from background script
  chrome.runtime.sendMessage({ action: 'getDownloadState' }, (response) => {
    console.log('Popup: Received initial state from background:', response);
    if (chrome.runtime.lastError) {
      console.warn(
        'Popup: Error getting initial state from background:',
        chrome.runtime.lastError.message
      );
      setUIState('failed', 'Could not retrieve status. Reload extension.');
      return;
    }
    if (response) {
      handleStateUpdate(response);
    } else {
      setUIState('checkingPage');
    }
    // Then, always re-check the Moodle page status as context might have changed
    chrome.runtime.sendMessage(
      { action: 'checkMoodlePage' },
      function (pageCheckResponse) {
        if (chrome.runtime.lastError) {
          console.warn(
            'Popup: Error checking Moodle page on load:',
            chrome.runtime.lastError.message
          );
          if (!response || !response.isDownloadActive) {
            setUIState('failed', 'Error connecting to page.');
          }
        } else if (pageCheckResponse && pageCheckResponse.isMoodleCoursePage) {
          if (
            (!response || !response.isDownloadActive) &&
            downloadBtn.textContent !== 'Download Again'
          ) {
            setUIState('idle');
          }
        } else {
          if (!response || !response.isDownloadActive) {
            setUIState('failed', 'Not a Moodle course page.');
          }
        }
      }
    );
  });

  function handleStateUpdate(state) {
    console.log('Popup: Handling state update', state);
    setUIState(
      state.lastUiStateForPopup || 'idle',
      state.lastProgressMessage,
      state.hasError
    );

    if (
      state.isDownloadActive ||
      state.lastUiStateForPopup === 'downloading' ||
      state.lastUiStateForPopup === 'cancelling'
    ) {
      downloadBtn.disabled = true;
      cancelBtn.classList.remove('hidden');
      cancelBtn.disabled = state.lastUiStateForPopup === 'cancelling';
      if (state.lastUiStateForPopup === 'cancelling')
        cancelBtn.textContent = 'Cancelling...';
      else cancelBtn.textContent = 'Cancel Download';
    } else {
      // Not active, ensure cancel button is hidden and correctly stateful
      cancelBtn.classList.add('hidden');
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancel Download';
    }
    // Special case for completed state where download button text changes
    if (state.lastUiStateForPopup === 'completed') {
      downloadBtn.textContent = 'Download Again';
      downloadBtn.disabled = false; // Explicitly enable
    } else if (
      state.lastUiStateForPopup === 'failed' &&
      !state.isDownloadActive
    ) {
      downloadBtn.textContent = 'Retry Download';
      downloadBtn.disabled = false; // Explicitly enable
    }
  }

  downloadBtn.addEventListener('click', function () {
    setUIState('downloading', 'Initializing download...');
    chrome.runtime.sendMessage(
      { action: 'startDownload' },
      function (response) {
        if (chrome.runtime.lastError) {
          console.error(
            'Popup: Error sending startDownload to background:',
            chrome.runtime.lastError.message
          );
          setUIState(
            'failed',
            `Start error: ${chrome.runtime.lastError.message}`
          );
          return;
        }
        if (response && response.status === 'failed') {
          setUIState('failed', response.error || 'Failed to initiate download');
        }
      }
    );
  });

  cancelBtn.addEventListener('click', function () {
    setUIState('cancelling');
    chrome.runtime.sendMessage(
      { action: 'cancelDownload' },
      function (response) {
        if (chrome.runtime.lastError) {
          console.error(
            'Popup: Error sending cancelDownload to background:',
            chrome.runtime.lastError.message
          );
          setUIState(
            'downloading',
            'Failed to send cancel. Still downloading.'
          );
        }
      }
    );
  });

  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    console.log('Popup received message:', request);

    if (request.action === 'stateUpdateFromBackground') {
      handleStateUpdate(request.newState);
    } else if (request.fromBackground) {
      if (request.action === 'downloadStatus') {
        setUIState(
          request.status,
          request.error || request.statusText,
          request.status === 'failed'
        );
      } else if (request.action === 'progressUpdate') {
        if (downloadBtn.disabled) {
          updateStatus(request.statusText || 'Processing...');
        }
      }
    }
    if (sendResponse) sendResponse({ receivedInPopup: true });
    return true;
  });
});
