/**
 * Flow Agent Bridge - Background Service Worker (MV3)
 * Manages WebSocket bridge with local daemon, downloads, and tab messaging.
 * Copyright (c) 2026 ljl8086. Licensed under MIT.
 */

const SERVER_BASE = 'http://127.0.0.1:8001';
const WS_URL = 'ws://127.0.0.1:8001/ws';
const FLOW_URLS = [
  'https://flow.google.com/*',
  'https://*.flow.google.com/*',
  'https://flow.google/*',
  'https://*.flow.google/*',
  'https://labs.google/*',
  'https://*.labs.google/*'
];

let clientId = 'flow_agent_' + Math.random().toString(36).substring(2, 9);
let ws = null;
let reconnectTimer = null;

function connectBridge() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log('[Flow Agent] WebSocket bridge connected to local daemon');
      ws.send(JSON.stringify({
        type: 'extension_ready',
        clientId: clientId
      }));
    };
    ws.onmessage = async ({ data }) => {
      try {
        const cmd = JSON.parse(data);
        await handleCommand(cmd);
      } catch (e) {
        console.error('[Flow Agent] WS message error:', e);
      }
    };
    ws.onclose = () => {
      ws = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectBridge, 3000);
    };
    ws.onerror = () => {
      try { ws.close(); } catch (_) {}
      ws = null;
    };
  } catch (e) {
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectBridge, 3000);
  }
}

async function sendCallback(msg) {
  const payload = JSON.stringify({ ...msg, session_id: clientId });
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(payload);
      return;
    } catch (_) {}
  }
  try {
    await fetch(`${SERVER_BASE}/api/ext/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  } catch (_) {}
}

async function handleCommand(cmd) {
  if (!cmd || !cmd.method || !cmd.id) return;
  const { id, method, params } = cmd;

  try {
    if (method === 'inject_prompt') {
      const { prompt, auto_submit = true, shot_id = '', mode = '', agent = false } = params || {};
      const tabs = await chrome.tabs.query({ url: FLOW_URLS });
      if (!tabs || tabs.length === 0) {
        sendCallback({ id, status: 404, error: 'NO_ACTIVE_FLOW_TAB' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'INJECT_PROMPT',
          prompt,
          auto_submit,
          shot_id,
          mode,
          agent
        });
        sendCallback({ id, status: res?.status || 200, result: res });
      } catch (tabErr) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 400));
        const res = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'INJECT_PROMPT',
          prompt,
          auto_submit,
          shot_id,
          mode,
          agent
        });
        sendCallback({ id, status: res?.status || 200, result: res });
      }
    } else if (method === 'download_media') {
      const { url, filename } = params || {};
      if (!url) {
        sendCallback({ id, status: 400, error: 'MISSING_URL' });
        return;
      }
      const downloadId = await chrome.downloads.download({
        url,
        filename: filename || 'flow_asset.png',
        saveAs: false,
        conflictAction: 'overwrite'
      });
      sendCallback({ id, status: 200, result: { download_id: downloadId, filename } });
    } else if (method === 'scan_canvas') {
      const tabs = await chrome.tabs.query({ url: FLOW_URLS });
      if (!tabs || tabs.length === 0) {
        sendCallback({ id, status: 404, error: 'NO_ACTIVE_FLOW_TAB' });
        return;
      }
      try {
        const res = await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCAN_CANVAS_MEDIA' });
        sendCallback({ id, status: 200, result: res });
      } catch (e) {
        sendCallback({ id, status: 500, error: e?.message || 'SCAN_FAILED' });
      }
    } else {
      sendCallback({ id, status: 400, error: `UNKNOWN_METHOD: ${method}` });
    }
  } catch (err) {
    sendCallback({ id, status: 500, error: err?.message || 'COMMAND_FAILED' });
  }
}

connectBridge();
