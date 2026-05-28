/**
 * content-script.js
 *
 * This runs in the content-script context (isolated world).
 * It injects the inpage.js script into the main world so it can
 * access `window` and register the wallet with the wallet-standard.
 * It also relays messages between inpage.js and the background service worker.
 */

// Inject the inpage script into the page's main world
function injectScript() {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inpage.js");
    script.type = "text/javascript";
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    console.error("[SuperWallet] Failed to inject inpage script:", error);
  }
}

injectScript();

// Relay messages from inpage.js (window) -> background service worker
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.target !== "superwallet-content-script") return;

  const { id, method, params } = event.data;

  try {
    const response = await chrome.runtime.sendMessage({
      id,
      method,
      params,
    });

    window.postMessage(
      {
        target: "superwallet-inpage",
        id,
        result: response?.result,
        error: response?.error,
      },
      "*",
    );
  } catch (error) {
    window.postMessage(
      {
        target: "superwallet-inpage",
        id,
        error: { message: error.message || "Unknown error" },
      },
      "*",
    );
  }
});

// Listen for messages from background -> forward to inpage
chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "superwallet-inpage") {
    window.postMessage(message, "*");
  }
});
