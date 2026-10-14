/**
 * QuickShare Pro V2 — Marketing Landing Page Controller
 * Zero inline scripts, strictly adheres to CSP.
 */

(function () {
  'use strict';

  // DOM Elements
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');
  const navStartBtn = document.getElementById('navStartBtn');
  const navJoinBtn = document.getElementById('navJoinBtn');
  const heroStartBtn = document.getElementById('heroStartBtn');
  const heroJoinBtn = document.getElementById('heroJoinBtn');

  const createRoomModal = document.getElementById('createRoomModal');
  const closeCreateModalBtn = document.getElementById('closeCreateModalBtn');
  const confirmCreateBtn = document.getElementById('confirmCreateBtn');
  const ttlSelect = document.getElementById('ttlSelect');
  const createErrorMsg = document.getElementById('createErrorMsg');

  const joinRoomModal = document.getElementById('joinRoomModal');
  const closeJoinModalBtn = document.getElementById('closeJoinModalBtn');
  const confirmJoinBtn = document.getElementById('confirmJoinBtn');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const roomPinInput = document.getElementById('roomPinInput');
  const joinErrorMsg = document.getElementById('joinErrorMsg');
  const toastRegion = document.getElementById('toastRegion');

  // --- Theme Management ---
  function initTheme() {
    let savedTheme;
    try {
      savedTheme = localStorage.getItem('quickshare_theme');
    } catch (e) {
      // Ignore localStorage restrictions
    }

    if (savedTheme === 'dark' || savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateThemeUI(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      updateThemeUI(prefersDark ? 'dark' : 'light');
    }
  }

  function updateThemeUI(theme) {
    if (themeIcon) {
      themeIcon.innerHTML = theme === 'dark' ? QuickIcons.get('sun') : QuickIcons.get('moon');
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      let nextTheme;
      if (current === 'dark') {
        nextTheme = 'light';
      } else if (current === 'light') {
        nextTheme = 'dark';
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        nextTheme = prefersDark ? 'light' : 'dark';
      }

      document.documentElement.setAttribute('data-theme', nextTheme);
      try {
        localStorage.setItem('quickshare_theme', nextTheme);
      } catch (e) {}
      updateThemeUI(nextTheme);
    });
  }

  // --- Render Icons ---
  function renderFeatureIcons() {
    QuickIcons.render('laptop', document.getElementById('featIcon1'));
    QuickIcons.render('shieldCheck', document.getElementById('featIcon2'));
    QuickIcons.render('clock', document.getElementById('featIcon3'));
    QuickIcons.render('image', document.getElementById('featIcon4'));
    QuickIcons.render('phone', document.getElementById('featIcon5'));
    QuickIcons.render('fileText', document.getElementById('featIcon6'));
  }

  // --- Toast Notification ---
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast-item ${isError ? 'toast-error' : 'toast-success'}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.innerHTML = isError ? QuickIcons.get('alertCircle') : QuickIcons.get('check');
    toast.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close-btn';
    closeBtn.innerHTML = QuickIcons.get('x');
    closeBtn.setAttribute('aria-label', 'Dismiss toast');
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    toastRegion.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('dismissing');
      setTimeout(() => toast.remove(), 160);
    }, 4000);
  }

  // --- Modal Open/Close ---
  function openCreateModal() {
    createRoomModal.classList.add('open');
    createErrorMsg.textContent = '';
  }
  function closeCreateModal() {
    createRoomModal.classList.remove('open');
  }

  function openJoinModal() {
    joinRoomModal.classList.add('open');
    joinErrorMsg.textContent = '';
    setTimeout(() => roomCodeInput.focus(), 150);
  }
  function closeJoinModal() {
    joinRoomModal.classList.remove('open');
  }

  if (navStartBtn) navStartBtn.addEventListener('click', openCreateModal);
  if (heroStartBtn) heroStartBtn.addEventListener('click', openCreateModal);
  if (closeCreateModalBtn) closeCreateModalBtn.addEventListener('click', closeCreateModal);

  if (navJoinBtn) navJoinBtn.addEventListener('click', openJoinModal);
  if (heroJoinBtn) heroJoinBtn.addEventListener('click', openJoinModal);
  if (closeJoinModalBtn) closeJoinModalBtn.addEventListener('click', closeJoinModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCreateModal();
      closeJoinModal();
    }
  });

  // --- Create Room API Call ---
  if (confirmCreateBtn) {
    confirmCreateBtn.addEventListener('click', async () => {
      confirmCreateBtn.disabled = true;
      confirmCreateBtn.innerHTML = '<span class="btn-spinner"></span> Creating...';
      createErrorMsg.textContent = '';

      try {
        const ttlHours = parseInt(ttlSelect.value, 10) || 24;
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttlHours })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to create room');
        }

        // Room created and session cookie set! Redirect to app
        window.location.href = '/app';
      } catch (err) {
        confirmCreateBtn.disabled = false;
        confirmCreateBtn.textContent = 'Create Room & Connect ⚡';
        createErrorMsg.textContent = err.message;
        showToast(err.message, true);
      }
    });
  }

  // --- Join Room API Call ---
  if (confirmJoinBtn) {
    confirmJoinBtn.addEventListener('click', async () => {
      const code = roomCodeInput.value.trim().toUpperCase();
      const pin = roomPinInput.value.trim();

      if (!code || code.length !== 6) {
        joinErrorMsg.textContent = 'Please enter a valid 6-character room code.';
        return;
      }
      if (!pin || pin.length !== 6) {
        joinErrorMsg.textContent = 'Please enter the 6-digit PIN.';
        return;
      }

      confirmJoinBtn.disabled = true;
      confirmJoinBtn.innerHTML = '<span class="btn-spinner"></span> Connecting...';
      joinErrorMsg.textContent = '';

      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to join room');
        }

        // Connected!
        window.location.href = '/app';
      } catch (err) {
        confirmJoinBtn.disabled = false;
        confirmJoinBtn.textContent = 'Enter Room';
        joinErrorMsg.textContent = err.message;
        showToast(err.message, true);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderFeatureIcons();
  });
})();
