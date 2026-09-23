function getExtensionRuntime() {
  return (typeof browser !== 'undefined' && browser?.runtime)
    ? browser.runtime
    : (typeof chrome !== 'undefined' && chrome?.runtime)
      ? chrome.runtime
      : null;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (() => {
    if (window.__wmAverageBootstrapInjected) return;
    window.__wmAverageBootstrapInjected = true;

    const extensionRuntime = getExtensionRuntime();
    if (!extensionRuntime?.getURL) return;

    const urls = [
      extensionRuntime.getURL('page-bridge.js'),
      extensionRuntime.getURL('content.js')
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getExtensionRuntime };
}