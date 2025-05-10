document.addEventListener('DOMContentLoaded', function () {
  console.log('Popup DOM fully loaded and parsed');
  const downloadBtn = document.getElementById('download-button');

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: 'checkMoodlePage' },
        function (response) {
          if (chrome.runtime.lastError) {
            console.warn(
              'Error checking Moodle page:',
              chrome.runtime.lastError.message
            );
            downloadBtn.disabled = true;
          } else if (response && response.isMoodleCoursePage) {
            downloadBtn.disabled = false;
          } else {
            downloadBtn.disabled = true;
          }
        }
      );
    } else {
      downloadBtn.disabled = true;
    }
  });

  downloadBtn.addEventListener('click', function () {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading...';

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'startDownload' },
          function (response) {
            if (chrome.runtime.lastError) {
              console.error(
                'Error sending message to content script:',
                chrome.runtime.lastError.message
              );
              downloadBtn.textContent = 'Error';
              setTimeout(() => {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
              }, 2000);
            } else if (response && response.status === 'success') {
              console.log('Download initiated by content script.');
              downloadBtn.textContent = 'Done!';
              setTimeout(() => {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
              }, 2000);
            } else {
              console.error(
                'Download failed or unexpected response:',
                response
              );
              downloadBtn.textContent = 'Failed!';
              setTimeout(() => {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download';
              }, 2000);
            }
          }
        );
      } else {
        console.error('Could not find active tab to send message.');
        downloadBtn.textContent = 'Error';
        setTimeout(() => {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download';
        }, 2000);
      }
    });
  });
});

// Listener for messages from the content script (e.g., to update button state)
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'downloadStatus') {
    const downloadBtn = document.getElementById('download-button');
    if (request.status === 'complete') {
      downloadBtn.textContent = 'Done!';
      setTimeout(() => {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download';
      }, 2000);
    } else if (request.status === 'processing') {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Processing...';
    } else if (request.status === 'failed') {
      downloadBtn.textContent = 'Failed!';
      setTimeout(() => {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download';
      }, 2000);
    }
    sendResponse({ received: true });
  }
});
