// Minimal CDP driver: evaluate a JS expression in the app's WebView.
// usage: node cdp.mjs "<expression>"   (result printed as JSON)
// Requires: adb forward tcp:9333 localabstract:webview_devtools_remote_*
const port = process.env.CDP_PORT || 9333;

const list = await (await fetch(`http://localhost:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
if (!page) {
  console.error("no page target");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const send = (id, method, params = {}) =>
  ws.send(JSON.stringify({ id, method, params }));

ws.onopen = () => {
  send(1, "Runtime.enable");
  send(2, "Runtime.evaluate", {
    expression: process.argv[2],
    awaitPromise: true,
    returnByValue: true,
  });
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 2) {
    const r = msg.result?.result;
    if (msg.result?.exceptionDetails) {
      console.error("EXCEPTION:", JSON.stringify(msg.result.exceptionDetails).slice(0, 500));
      process.exit(2);
    }
    console.log(JSON.stringify(r?.value, null, 1));
    process.exit(0);
  }
};

setTimeout(() => {
  console.error("timeout");
  process.exit(3);
}, 20000);
