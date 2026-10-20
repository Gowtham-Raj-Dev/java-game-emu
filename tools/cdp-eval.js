// Minimal Chrome DevTools Protocol client for an Android WebView (adb forward tcp:9333 ...).
// usage: node cdp-eval.js "<js expression>" [listenMs]   -> prints the result and console messages
const http = require('http');
const WebSocket = require('ws');

function getJSON(url) {
  return new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
}
(async () => {
  const targets = await getJSON('http://127.0.0.1:9333/json');
  const t = targets.find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') console.log('[console.' + msg.params.type + '] ' + msg.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') console.log('[exception] ' + JSON.stringify(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description));
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable', {});
  let expr = process.argv[2] || '1';
  if (expr.startsWith('@')) expr = require('fs').readFileSync(expr.substring(1), 'utf8');
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log('RESULT:', JSON.stringify(r.result && (r.result.result ? r.result.result.value : r.result), null, 1));
  await new Promise((res) => setTimeout(res, +(process.argv[3] || 500)));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

