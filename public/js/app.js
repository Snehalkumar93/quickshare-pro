/**
 * QuickShare Pro V2 — Main App Workspace Controller
 * Clean Linear/Vercel SaaS design system, room-scoped Socket.io, strict security & CSP.
 */

(function () {
  'use strict';

  // State
  let currentRoom = null;
  let currentDeviceId = localStorage.getItem('quickshare_device_id');
  if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('quickshare_device_id', currentDeviceId);
  }

  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isMobileScreen = window.innerWidth <= 768;
  const currentDeviceType = (isTouch && isMobileScreen) ? 'Phone' : 'Laptop';

  let socket = null;
  let itemsList = [];
  const activeUploadXhrs = new Map();

  // DOM Elements
  const headerRoomBadge = document.getElementById('headerRoomBadge');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const presencePill = document.getElementById('presencePill');
  const presenceCountText = document.getElementById('presenceCountText');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const openPairBtn = document.getElementById('openPairBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');
  const endSessionBtn = document.getElementById('endSessionBtn');
  const offlineBanner = document.getElementById('offlineBanner');

  const feedScroll = document.getElementById('feedScroll');
  const loadingSkeletons = document.getElementById('loadingSkeletons');
  const emptyState = document.getElementById('emptyState');
  const emptyConnectBtn = document.getElementById('emptyConnectBtn');

  const uploadProgressList = document.getElementById('uploadProgressList');
  const filePicker = document.getElementById('filePicker');
  const attachBtn = document.getElementById('attachBtn');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const dragOverlay = document.getElementById('dragOverlay');

  // Modals
  const pairingModal = document.getElementById('pairingModal');
  const closePairingBtn = document.getElementById('closePairingBtn');
  const qrCodeImg = document.getElementById('qrCodeImg');
  const dialogRoomCodeDisplay = document.getElementById('dialogRoomCodeDisplay');
  const dialogPinDisplay = document.getElementById('dialogPinDisplay');
  const dialogUrlText = document.getElementById('dialogUrlText');
  const copyPairLinkBtn = document.getElementById('copyPairLinkBtn');

  const lightboxModal = document.getElementById('lightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');
  const downloadLightboxBtn = document.getElementById('downloadLightboxBtn');

  const endSessionModal = document.getElementById('endSessionModal');
  const closeEndModalBtn = document.getElementById('closeEndModalBtn');
  const cancelEndSessionBtn = document.getElementById('cancelEndSessionBtn');
  const confirmEndSessionBtn = document.getElementById('confirmEndSessionBtn');

  const toastRegion = document.getElementById('toastRegion');

  // --- Render Lucide Icons ---
  function renderHeaderIcons() {
    QuickIcons.render('archive', document.getElementById('zipIconWrap'));
    QuickIcons.render('qrcode', document.getElementById('qrIconWrap'));
    QuickIcons.render('logOut', document.getElementById('exitIconWrap'));
    QuickIcons.render('paperclip', document.getElementById('attachIconWrap'));
    QuickIcons.render('send', document.getElementById('sendIconWrap'));
    QuickIcons.render('download', document.getElementById('lbDownloadIconWrap'));
  }

  // --- Theme Management ---
  function initTheme() {
    let savedTheme;
    try {
      savedTheme = localStorage.getItem('quickshare_theme');
    } catch (e) {}

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
      if (current === 'dark') nextTheme = 'light';
      else if (current === 'light') nextTheme = 'dark';
      else nextTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('quickshare_theme', nextTheme); } catch (e) {}
      updateThemeUI(nextTheme);
    });
  }

  // --- Toasts ---
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

  // --- Sound Effects ---
  function playPopSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.06);
    } catch (e) {}
  }

  // --- Verify Room & Init App ---
  async function checkRoomSession() {
    try {
      loadingSkeletons.style.display = 'flex';
      const res = await fetch('/api/rooms/current');
      if (!res.ok) {
        // Not in an active room, redirect to landing
        window.location.href = '/';
        return;
      }

      currentRoom = await res.json();
      roomCodeDisplay.textContent = currentRoom.code;
      dialogRoomCodeDisplay.textContent = currentRoom.code;
      dialogPinDisplay.textContent = currentRoom.pin;

      initSocket();
      loadItems();
    } catch (err) {
      console.error('Session check failed:', err);
      window.location.href = '/';
    }
  }

  // --- Socket.io Integration (Scoped to Room) ---
  function initSocket() {
    if (socket || !currentRoom) return;

    socket = io({
      transports: ['websocket', 'polling'],
      query: {
        roomId: currentRoom.code,
        deviceType: currentDeviceType,
        deviceId: currentDeviceId
      }
    });

    socket.on('connect', () => {
      offlineBanner.classList.remove('active');
    });

    socket.on('disconnect', () => {
      offlineBanner.classList.add('active');
    });

    socket.on('presence:update', (data) => {
      updatePresenceUI(data);
    });

    socket.on('item:created', (item) => {
      addItemToFeed(item, true);
      playPopSound();
    });

    socket.on('item:deleted', ({ id }) => {
      removeItemFromFeed(id);
    });

    socket.on('room:ended', () => {
      showToast('This session has been ended by the host.', true);
      setTimeout(() => { window.location.href = '/'; }, 1500);
    });

    socket.on('room:expired', () => {
      showToast('This room session has expired.', true);
      setTimeout(() => { window.location.href = '/'; }, 1500);
    });
  }

  function updatePresenceUI(data) {
    const count = data.count || 1;
    presenceCountText.textContent = count === 1 ? '1 device' : `${count} devices`;
    if (count >= 2) {
      presencePill.classList.add('active-multi');
      presencePill.setAttribute('title', `${count} devices online in room`);
    } else {
      presencePill.classList.remove('active-multi');
      presencePill.setAttribute('title', '1 device online. Click Connect device to pair phone.');
    }
  }

  // --- Feed & Safe DOM Construction ---
  function formatTime(isoStr) {
    try {
      return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Safe linkification without innerHTML
  function linkifySafe(text) {
    const fragment = document.createDocumentFragment();
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }

      const link = document.createElement('a');
      link.href = match[0];
      link.textContent = match[0];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.appendChild(link);

      lastIndex = urlRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    return fragment;
  }

  function createMessageElement(item) {
    const isMine = item.senderId === currentDeviceId;

    const row = document.createElement('div');
    row.className = `bubble-row ${isMine ? 'mine' : 'theirs'}`;
    row.dataset.id = item.id;

    const box = document.createElement('div');
    box.className = 'bubble-box';

    // Content: Text or File
    if (item.type === 'text') {
      const textEl = document.createElement('div');
      textEl.className = 'bubble-text';
      textEl.appendChild(linkifySafe(item.content));
      box.appendChild(textEl);
    } else if (item.type === 'file') {
      const fileCard = document.createElement('div');
      fileCard.className = 'file-card';

      const mime = item.mimeType || '';
      const isRasterImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
      const isVideo = mime.startsWith('video/');
      const isAudio = mime.startsWith('audio/');

      if (isRasterImage) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'file-thumbnail-wrap';
        thumbWrap.title = 'Click to open full-screen lightbox';

        const img = document.createElement('img');
        img.className = 'file-thumbnail-img';
        img.src = item.fileUrl;
        img.alt = item.fileName || 'Shared image';
        img.loading = 'lazy';
        img.onclick = () => openLightbox(item.fileUrl, item.fileName);

        thumbWrap.appendChild(img);
        fileCard.appendChild(thumbWrap);
      } else if (isVideo) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'file-thumbnail-wrap';

        const video = document.createElement('video');
        video.className = 'file-video-elem';
        video.src = item.fileUrl;
        video.controls = true;
        video.preload = 'metadata';

        thumbWrap.appendChild(video);
        fileCard.appendChild(thumbWrap);
      }

      // Metadata Bar
      const metaBar = document.createElement('div');
      metaBar.className = 'file-meta-bar';

      const textInfo = document.createElement('div');
      textInfo.className = 'file-text-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'file-title';
      titleSpan.textContent = item.fileName || 'Shared file';
      titleSpan.title = item.fileName || '';
      textInfo.appendChild(titleSpan);

      const subSpan = document.createElement('span');
      subSpan.className = 'file-sub';

      const ext = (item.fileName || '').split('.').pop().toUpperCase();
      const badge = document.createElement('span');
      badge.className = 'file-badge';
      badge.textContent = ext || 'FILE';
      subSpan.appendChild(badge);

      subSpan.appendChild(document.createTextNode(formatBytes(item.fileSize)));
      textInfo.appendChild(subSpan);

      metaBar.appendChild(textInfo);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'file-actions';

      const downloadBtn = document.createElement('a');
      downloadBtn.className = 'file-action-btn';
      downloadBtn.href = `${item.fileUrl}?download=1`;
      downloadBtn.download = item.fileName || 'file';
      downloadBtn.title = 'Download';
      downloadBtn.setAttribute('aria-label', `Download ${item.fileName}`);
      downloadBtn.innerHTML = QuickIcons.get('download');
      actions.appendChild(downloadBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'file-action-btn delete';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete';
      deleteBtn.setAttribute('aria-label', `Delete ${item.fileName}`);
      deleteBtn.innerHTML = QuickIcons.get('trash');
      deleteBtn.onclick = () => deleteItem(item.id);
      actions.appendChild(deleteBtn);

      metaBar.appendChild(actions);
      fileCard.appendChild(metaBar);

      if (isAudio) {
        const audio = document.createElement('audio');
        audio.src = item.fileUrl;
        audio.controls = true;
        audio.style.width = '100%';
        audio.style.padding = '8px';
        fileCard.appendChild(audio);
      }

      box.appendChild(fileCard);
    }

    row.appendChild(box);

    // Metadata Row
    const metaRow = document.createElement('div');
    metaRow.className = 'bubble-meta';

    const devIcon = document.createElement('span');
    devIcon.innerHTML = item.senderDevice === 'Phone' ? QuickIcons.get('phone') : QuickIcons.get('laptop');
    metaRow.appendChild(devIcon);

    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(item.timestamp);
    metaRow.appendChild(timeSpan);

    if (item.type === 'text') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'file-action-btn';
      copyBtn.style.width = '24px';
      copyBtn.style.height = '24px';
      copyBtn.style.marginLeft = '4px';
      copyBtn.innerHTML = QuickIcons.get('copy');
      copyBtn.title = 'Copy text';
      copyBtn.setAttribute('aria-label', 'Copy message text');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(item.content);
          showToast('Text copied to clipboard');
        } catch (e) {
          showToast('Failed to copy', true);
        }
      };
      metaRow.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'file-action-btn delete';
      delBtn.style.width = '24px';
      delBtn.style.height = '24px';
      delBtn.innerHTML = QuickIcons.get('trash');
      delBtn.title = 'Delete message';
      delBtn.setAttribute('aria-label', 'Delete message');
      delBtn.onclick = () => deleteItem(item.id);
      metaRow.appendChild(delBtn);
    }

    row.appendChild(metaRow);
    return row;
  }

  function addItemToFeed(item, animate = true) {
    if (itemsList.some(it => it.id === item.id)) return;
    itemsList.unshift(item);

    emptyState.style.display = 'none';
    const el = createMessageElement(item);
    if (!animate) el.style.animation = 'none';

    feedScroll.prepend(el);
    updateDownloadZipState();
  }

  function removeItemFromFeed(id) {
    const el = feedScroll.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.classList.add('deleting');
      setTimeout(() => {
        el.remove();
        itemsList = itemsList.filter(it => it.id !== id);
        if (itemsList.length === 0) {
          emptyState.style.display = 'flex';
        }
        updateDownloadZipState();
      }, 200);
    }
  }

  function updateDownloadZipState() {
    const hasFiles = itemsList.some(it => it.type === 'file');
    downloadZipBtn.disabled = !hasFiles;
  }

  // --- API Actions ---
  async function loadItems() {
    try {
      const res = await fetch('/api/items');
      loadingSkeletons.style.display = 'none';

      if (!res.ok) {
        window.location.href = '/';
        return;
      }

      const items = await res.json();
      itemsList = [];
      feedScroll.querySelectorAll('.bubble-row').forEach(e => e.remove());

      if (items && items.length > 0) {
        emptyState.style.display = 'none';
        for (let i = items.length - 1; i >= 0; i--) {
          addItemToFeed(items[i], false);
        }
      } else {
        emptyState.style.display = 'flex';
      }
      updateDownloadZipState();
    } catch (err) {
      loadingSkeletons.style.display = 'none';
      console.error('Failed to load items:', err);
    }
  }

  async function sendText() {
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/items/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          senderDevice: currentDeviceType,
          senderId: currentDeviceId
        })
      });

      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || 'Failed to send message', true);
      }
    } catch (err) {
      showToast('Network error sending message', true);
    }
  }

  // --- Determinate Upload Progress & Upload Execution ---
  function uploadFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const uploadId = 'up_' + Math.random().toString(36).substring(2, 9);
      createUploadRow(uploadId, file);
      executeUpload(uploadId, file);
    }
  }

  function createUploadRow(uploadId, file) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.id = uploadId;

    const header = document.createElement('div');
    header.className = 'upload-row-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'upload-row-name';
    nameSpan.textContent = file.name;
    header.appendChild(nameSpan);

    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';
    rightGroup.style.gap = '8px';

    const percentSpan = document.createElement('span');
    percentSpan.className = 'upload-percent text-xs';
    percentSpan.style.color = 'var(--text-3)';
    percentSpan.textContent = '0%';
    rightGroup.appendChild(percentSpan);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.style.padding = '0 6px';
    cancelBtn.innerHTML = QuickIcons.get('x');
    cancelBtn.setAttribute('aria-label', `Cancel upload of ${file.name}`);
    cancelBtn.onclick = () => {
      const xhr = activeUploadXhrs.get(uploadId);
      if (xhr) xhr.abort();
      row.remove();
      activeUploadXhrs.delete(uploadId);
    };
    rightGroup.appendChild(cancelBtn);

    header.appendChild(rightGroup);
    row.appendChild(header);

    const track = document.createElement('div');
    track.className = 'upload-bar-track';

    const fill = document.createElement('div');
    fill.className = 'upload-bar-fill';
    track.appendChild(fill);
    row.appendChild(track);

    uploadProgressList.appendChild(row);
  }

  function executeUpload(uploadId, file) {
    const row = document.getElementById(uploadId);
    if (!row) return;

    const percentSpan = row.querySelector('.upload-percent');
    const fill = row.querySelector('.upload-bar-fill');

    const formData = new FormData();
    formData.append('files', file);
    formData.append('senderDevice', currentDeviceType);
    formData.append('senderId', currentDeviceId);

    const xhr = new XMLHttpRequest();
    activeUploadXhrs.set(uploadId, xhr);

    xhr.open('POST', '/api/items/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        percentSpan.textContent = `${percent}%`;
        fill.style.width = `${percent}%`;
      }
    };

    xhr.onload = () => {
      activeUploadXhrs.delete(uploadId);
      if (xhr.status === 201) {
        fill.style.width = '100%';
        percentSpan.textContent = 'Done';
        setTimeout(() => row.remove(), 600);
        showToast(`Uploaded ${file.name}`);
      } else {
        let msg = 'Upload failed';
        try {
          const errData = JSON.parse(xhr.responseText);
          msg = errData.error || msg;
        } catch (e) {}
        row.remove();
        showToast(msg, true);
      }
    };

    xhr.onerror = () => {
      activeUploadXhrs.delete(uploadId);
      row.remove();
      showToast(`Network error uploading ${file.name}`, true);
    };

    xhr.send(formData);
  }

  async function deleteItem(id) {
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Item deleted');
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to delete', true);
      }
    } catch (e) {
      showToast('Error deleting item', true);
    }
  }

  // --- Pairing Dialog ---
  async function openPairingDialog() {
    try {
      const res = await fetch('/api/pairing');
      if (!res.ok) throw new Error();
      const data = await res.json();

      qrCodeImg.src = data.qrDataUrl;
      if (dialogUrlText) dialogUrlText.textContent = data.directUrl;
      const dialogUrlLink = document.getElementById('dialogUrlLink');
      if (dialogUrlLink) {
        dialogUrlLink.href = data.directUrl;
      }
      copyPairLinkBtn.dataset.url = data.directUrl;
      pairingModal.classList.add('open');
    } catch (err) {
      showToast('Failed to load pairing details', true);
    }
  }

  if (openPairBtn) openPairBtn.addEventListener('click', openPairingDialog);
  if (emptyConnectBtn) emptyConnectBtn.addEventListener('click', openPairingDialog);
  if (closePairingBtn) closePairingBtn.addEventListener('click', () => pairingModal.classList.remove('open'));
  if (pairingModal) {
    pairingModal.addEventListener('click', (e) => {
      if (e.target === pairingModal) pairingModal.classList.remove('open');
    });
  }

  if (copyPairLinkBtn) {
    copyPairLinkBtn.addEventListener('click', async () => {
      const url = copyPairLinkBtn.dataset.url;
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          showToast('Pairing link copied');
        } catch (e) {
          showToast('Failed to copy', true);
        }
      }
    });
  }

  // Header Room Badge Copy
  if (headerRoomBadge) {
    headerRoomBadge.addEventListener('click', async () => {
      if (currentRoom) {
        try {
          await navigator.clipboard.writeText(currentRoom.code);
          showToast(`Room code ${currentRoom.code} copied`);
        } catch (e) {}
      }
    });
  }

  // --- Lightbox ---
  function openLightbox(url, title = 'Photo') {
    lightboxImg.src = url;
    downloadLightboxBtn.href = `${url}?download=1`;
    downloadLightboxBtn.download = title;
    lightboxModal.classList.add('open');
  }

  function closeLightbox() {
    lightboxModal.classList.remove('open');
  }

  if (closeLightboxBtn) closeLightboxBtn.addEventListener('click', closeLightbox);
  if (lightboxModal) {
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) closeLightbox();
    });
  }

  // --- End Session Flow ---
  if (endSessionBtn) {
    endSessionBtn.addEventListener('click', () => {
      endSessionModal.classList.add('open');
    });
  }
  if (closeEndModalBtn) closeEndModalBtn.addEventListener('click', () => endSessionModal.classList.remove('open'));
  if (cancelEndSessionBtn) cancelEndSessionBtn.addEventListener('click', () => endSessionModal.classList.remove('open'));

  if (confirmEndSessionBtn) {
    confirmEndSessionBtn.addEventListener('click', async () => {
      confirmEndSessionBtn.disabled = true;
      confirmEndSessionBtn.innerHTML = '<span class="btn-spinner"></span> Ending...';

      try {
        await fetch(`/api/rooms/${currentRoom.code}/end`, { method: 'POST' });
        window.location.href = '/';
      } catch (e) {
        window.location.href = '/';
      }
    });
  }

  // --- Download All as ZIP ---
  if (downloadZipBtn) {
    downloadZipBtn.addEventListener('click', () => {
      window.location.href = '/api/items/zip';
      showToast('Downloading all room files as ZIP');
    });
  }

  // --- Keyboard Shortcuts & Esc Handlers ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightboxModal.classList.contains('open')) closeLightbox();
      if (pairingModal.classList.contains('open')) pairingModal.classList.remove('open');
      if (endSessionModal.classList.contains('open')) endSessionModal.classList.remove('open');
    }
  });

  // --- Composer Input Handlers ---
  if (messageInput) {
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      sendBtn.disabled = messageInput.value.trim().length === 0;
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendText);

  if (attachBtn && filePicker) {
    attachBtn.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', () => {
      if (filePicker.files && filePicker.files.length > 0) {
        uploadFiles(filePicker.files);
        filePicker.value = '';
      }
    });
  }

  // --- Drag and Drop Everywhere ---
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) dragOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dragOverlay.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // --- Clipboard Paste Support ---
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    const filesToUpload = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) filesToUpload.push(file);
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault();
      uploadFiles(filesToUpload);
      showToast(`Pasted ${filesToUpload.length} item(s) from clipboard`);
    }
  });

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderHeaderIcons();
    checkRoomSession();
  });
})();
