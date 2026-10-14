/**
 * QuickShare Pro V2 — Join Deep Link Controller
 */

(function () {
  'use strict';

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const code = (pathParts[1] || '').toUpperCase();

  const displayRoomCode = document.getElementById('displayRoomCode');
  const joinPinInput = document.getElementById('joinPinInput');
  const submitJoinBtn = document.getElementById('submitJoinBtn');
  const joinError = document.getElementById('joinError');

  if (displayRoomCode) {
    displayRoomCode.textContent = code || 'UNKNOWN';
  }

  // Theme initialization
  try {
    const saved = localStorage.getItem('quickshare_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {}

  async function attemptJoin(pin) {
    if (!code) {
      joinError.textContent = 'Invalid room URL.';
      return;
    }
    if (!pin || pin.length !== 6) {
      joinError.textContent = 'Please enter a 6-digit PIN.';
      return;
    }

    submitJoinBtn.disabled = true;
    submitJoinBtn.innerHTML = '<span class="btn-spinner"></span> Connecting...';
    joinError.textContent = '';

    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to connect');
      }

      // Success! Redirect to /app
      window.location.href = '/app';
    } catch (err) {
      submitJoinBtn.disabled = false;
      submitJoinBtn.textContent = 'Connect to Room';
      joinError.textContent = err.message;
    }
  }

  if (submitJoinBtn) {
    submitJoinBtn.addEventListener('click', () => {
      attemptJoin(joinPinInput.value.trim());
    });
  }

  if (joinPinInput) {
    joinPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        attemptJoin(joinPinInput.value.trim());
      }
    });

    joinPinInput.addEventListener('input', () => {
      if (joinPinInput.value.length === 6) {
        attemptJoin(joinPinInput.value.trim());
      }
    });
  }

  // Auto-join if ?pin= is in URL query
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  if (pinParam && pinParam.length === 6) {
    if (joinPinInput) joinPinInput.value = pinParam;
    attemptJoin(pinParam);
  }
})();
