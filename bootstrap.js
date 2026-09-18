(() => {
  if (window.__wmAverageBootstrapInjected) return;
  window.__wmAverageBootstrapInjected = true;

  const urls = [
    chrome.runtime.getURL('page-bridge.js'),
    chrome.runtime.getURL('content.js')
  ];

  const parent = document.head || document.documentElement;

  for (const src of urls) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.wmAverageInjected = '1';
    parent.appendChild(script);
  }
})();