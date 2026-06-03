chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getStatsData') {
    chrome.storage.local.get('MAU_PLUGIN_DATA', function(result) {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, data: result['MAU_PLUGIN_DATA'] || {} });
      }
    });
    return true;
  }
  if (request.action === 'getPerfData') {
    chrome.storage.local.get('MAU_PLUGIN_PERF_DATA', function(result) {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, data: result['MAU_PLUGIN_PERF_DATA'] || {} });
      }
    });
    return true;
  }
});