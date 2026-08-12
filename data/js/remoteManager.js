/**
 * remoteManager.js — WebSocket client for phone remote control
 *
 * Used by the presenter side to create a remote session,
 * generate the QR code URL, and handle commands from connected phones.
 */

const SESSION_KEY = 'pdf-presenter-remote-session';

let ws = null;
let sessionId = null;
let remoteCount = 0;
let reviewCount = 0;
let _onCommand = null;
let _onStatusChange = null;
let reconnectTimer = null;
let _onQaQuestion = null;
let _onReviewClientChange = null;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Create a new remote session and connect to the WebSocket server.
 * @returns {Promise<string>} session ID
 */
function connect() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState <= 1) {
      resolve(sessionId);
      return;
    }

    sessionId = generateSessionId();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'create-session', sessionId }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      switch (msg.type) {
        case 'session-created':
          _fireStatusChange();
          resolve(sessionId);
          break;

        case 'remote-joined':
          remoteCount = msg.remoteCount || 0;
          _fireStatusChange();
          break;

        case 'remote-left':
          remoteCount = msg.remoteCount || 0;
          _fireStatusChange();
          break;

        case 'remote-command':
          if (_onCommand) _onCommand(msg.command);
          break;

        case 'qa-question':
          if (_onQaQuestion) _onQaQuestion({ text: msg.text, timestamp: msg.timestamp });
          break;

        case 'review-client-joined':
        case 'review-client-left':
          reviewCount = msg.reviewCount || 0;
          if (_onReviewClientChange) _onReviewClientChange({ reviewCount });
          break;
      }
    };

    ws.onerror = () => {
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = () => {
      remoteCount = 0;
      reviewCount = 0;
      _fireStatusChange();
      if (_onReviewClientChange) _onReviewClientChange({ reviewCount });
    };
  });
}

/**
 * Disconnect and destroy the session.
 */
function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  sessionId = null;
  remoteCount = 0;
  reviewCount = 0;
  _fireStatusChange();
  if (_onReviewClientChange) _onReviewClientChange({ reviewCount });
}

/**
 * Push current page state to all connected remotes.
 */
function sendStateUpdate(currentPage, totalPages) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'state-update',
      currentPage,
      totalPages,
    }));
  }
}

/**
 * Register callback for remote commands ('next' or 'prev').
 */
function onRemoteCommand(callback) {
  _onCommand = callback;
}

/**
 * Register callback for status changes (connected, remote count, etc).
 * callback({ connected, remoteCount })
 */
function onStatusChange(callback) {
  _onStatusChange = callback;
}

/**
 * Whether the WebSocket is connected.
 */
function isConnected() {
  return ws !== null && ws.readyState === 1 && sessionId !== null;
}

/**
 * Get the current session ID.
 */
function getSessionId() {
  return sessionId;
}

/**
 * Get the number of connected remotes.
 */
function getRemoteCount() {
  return remoteCount;
}

/**
 * Build the URL that the phone should open.
 */
function getRemoteUrl() {
  if (!sessionId) return null;
  return `${location.origin}/remote.html?session=${sessionId}`;
}

/**
 * Build the QR code image URL (server-generated PNG).
 */
function getQRCodeUrl() {
  const remoteUrl = getRemoteUrl();
  if (!remoteUrl) return null;
  return `/api/qr?url=${encodeURIComponent(remoteUrl)}`;
}

/**
 * Build the Q&A URL that the audience should open.
 */
function getQaUrl() {
  if (!sessionId) return null;
  return `${location.origin}/qa.html?session=${sessionId}`;
}

/**
 * Build the QR code image URL for Q&A.
 */
function getQaQRCodeUrl() {
  const qaUrl = getQaUrl();
  if (!qaUrl) return null;
  return `/api/qr?url=${encodeURIComponent(qaUrl)}`;
}

/**
 * Register callback for incoming Q&A questions.
 */
function onQaQuestion(callback) {
  _onQaQuestion = callback;
}

/**
 * Push a rendered slide image to all connected review clients.
 */
function sendPageImage(pageNum, dataUrl) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'page-image',
      pageNum,
      dataUrl,
    }));
  }
}

/**
 * Tell review clients which page is live right now (for "Follow" mode),
 * independent of whether that page's image was already sent before.
 */
function sendCurrentPage(pageNum) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'current-page',
      pageNum,
    }));
  }
}

/**
 * Tell review clients to drop their cached slides — the presenter just
 * loaded a different file, so old page numbers no longer mean anything.
 */
function sendDeckReset() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'deck-reset' }));
  }
}

/**
 * Build the Slide Review URL that the audience should open.
 */
function getReviewUrl() {
  if (!sessionId) return null;
  return `${location.origin}/review.html?session=${sessionId}`;
}

/**
 * Build the QR code image URL for Slide Review.
 */
function getReviewQRCodeUrl() {
  const reviewUrl = getReviewUrl();
  if (!reviewUrl) return null;
  return `/api/qr?url=${encodeURIComponent(reviewUrl)}`;
}

/**
 * Register callback for review-audience connect/disconnect events.
 * callback({ reviewCount })
 */
function onReviewClientChange(callback) {
  _onReviewClientChange = callback;
}

/**
 * Get the number of connected review viewers.
 */
function getReviewCount() {
  return reviewCount;
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

function generateSessionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 64; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function _fireStatusChange() {
  if (_onStatusChange) {
    _onStatusChange({
      connected: isConnected(),
      remoteCount,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Export                                                              */
/* ------------------------------------------------------------------ */

export default {
  connect,
  disconnect,
  sendStateUpdate,
  onRemoteCommand,
  onStatusChange,
  isConnected,
  getSessionId,
  getRemoteCount,
  getRemoteUrl,
  getQRCodeUrl,
  getQaUrl,
  getQaQRCodeUrl,
  onQaQuestion,
  sendPageImage,
  sendCurrentPage,
  sendDeckReset,
  getReviewUrl,
  getReviewQRCodeUrl,
  onReviewClientChange,
  getReviewCount,
};
