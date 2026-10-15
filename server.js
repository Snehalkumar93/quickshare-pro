const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const qrcode = require('qrcode');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
require('dotenv').config();

// Secrets & Environment Verification
const PORT = parseInt(process.env.PORT || '10000', 10);
let SECRET = process.env.SECRET;

if (process.env.NODE_ENV === 'production' && !SECRET) {
  console.error('FATAL: SECRET environment variable is required in production.');
  process.exit(1);
}
if (!SECRET) {
  SECRET = 'qs_dev_secret_' + crypto.randomBytes(16).toString('hex');
}

const MONGO_URI = process.env.MONGO_URI;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;

if (!MONGO_URI || !CLOUDINARY_URL) {
  console.warn('⚠️  WARNING: Running in local-disk mode (MONGO_URI and/or CLOUDINARY_URL not set). Uploaded files and room data will persist to local disk and will be lost on container restart or redeploy.');
}

const REPORT_EMAIL = process.env.REPORT_EMAIL || 'abuse@quickshare.local';
const MAX_ROOM_MB = parseInt(process.env.MAX_MB || '200', 10);
const MAX_SINGLE_FILE_MB = 50;
const MAX_ROOM_ITEMS = 100;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Blocked Dangerous Extensions
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.sh', '.ps1', '.scr', '.jar', '.apk', '.vbs', '.dll', '.com', '.pif'
]);

// Database / Data Migration
function loadDatabase() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migrate legacy flat array
        const defaultRoom = {
          code: 'DEMO01',
          pin: '123456',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          ttlHours: 24,
          totalBytes: parsed.reduce((sum, it) => sum + (it.fileSize || 0), 0)
        };
        const migratedItems = parsed.map(it => ({
          ...it,
          roomId: it.roomId || 'DEMO01'
        }));
        return { rooms: [defaultRoom], items: migratedItems };
      }
      return {
        rooms: parsed.rooms || [],
        items: parsed.items || []
      };
    }
  } catch (err) {
    console.error('Error reading database, creating clean structure:', err);
  }
  return { rooms: [], items: [] };
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving data.json:', err);
  }
}

let db = loadDatabase();
saveDatabase(db); // Ensure migrated format is persisted

// HMAC Signed Tokens
function signToken(roomId, expiresAt) {
  const payload = `${roomId}.${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [roomId, expiresAtStr, hmac] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(expiresAt) || Date.now() > expiresAt) return null;

  const expectedHmac = crypto.createHmac('sha256', SECRET).update(`${roomId}.${expiresAtStr}`).digest('hex');
  if (crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
    return { roomId, expiresAt };
  }
  return null;
}

// Generate Room Code from Unambiguous Alphabet
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function generateRoomPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Network Interfaces
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

// Dynamic Base URL Resolution for Universal Join Links
function getBaseUrl(req) {
  // 1. PUBLIC_URL env var takes top priority
  if (process.env.PUBLIC_URL && process.env.PUBLIC_URL.trim()) {
    return process.env.PUBLIC_URL.trim().replace(/\/+$/, '');
  }

  // 2. The request's own origin via trust proxy (honoring x-forwarded-proto & x-forwarded-host)
  const host = req ? req.get('host') : null;
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1') && !host.startsWith('0.0.0.0')) {
    const proto = req.protocol || 'http';
    return `${proto}://${host}`;
  }

  // 3. Fallback: local LAN IP for pure local Wi-Fi development
  const ips = getLocalIpAddresses();
  const primaryIp = ips[0] || '127.0.0.1';
  const proto = req && req.protocol ? req.protocol : 'http';
  return `${proto}://${primaryIp}:${PORT}`;
}

// Setup App & Express Server
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Privacy-Preserving Structured Request Logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Only log method, sanitized path, status, and duration (never IP or query params)
    const sanitizedPath = req.path;
    console.log(`[REQ] ${req.method} ${sanitizedPath} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Helmet Security Headers with strict CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
        mediaSrc: ["'self'", "blob:", "https://res.cloudinary.com"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', globalLimiter);

const roomCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Room creation limit reached. Max 5 rooms per hour.' }
});

const roomJoinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: { error: 'Too many join attempts. Please wait 10 minutes.' }
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: { error: 'Upload rate limit reached. Please wait before uploading more files.' }
});

// Auth Middleware: Extracts Room from Cookie Token or Query
function getAuthRoom(req) {
  const token = req.cookies.quickshare_session;
  const verified = verifyToken(token);
  if (!verified) return null;
  const room = db.rooms.find(r => r.code === verified.roomId);
  if (!room) return null;
  if (Date.now() > new Date(room.expiresAt).getTime()) return null;
  return room;
}

function requireAuthRoom(req, res, next) {
  const room = getAuthRoom(req);
  if (!room) {
    return res.status(401).json({ error: 'Session expired or invalid. Please join the room again.' });
  }
  req.room = room;
  next();
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SINGLE_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Blocked file type: ${ext} files are prohibited for security.`));
    }
    cb(null, true);
  }
});

// ==========================================================================
// API Routes
// ==========================================================================

// Config route
app.get('/api/config', (req, res) => {
  res.json({ reportEmail: REPORT_EMAIL, maxMb: MAX_ROOM_MB });
});

// Create Room
app.post('/api/rooms', roomCreateLimiter, (req, res) => {
  let ttlHours = parseInt(req.body.ttlHours, 10);
  if (![1, 24, 168].includes(ttlHours)) ttlHours = 24;

  let code = generateRoomCode();
  while (db.rooms.some(r => r.code === code)) {
    code = generateRoomCode();
  }

  const pin = generateRoomPin();
  const createdAt = new Date().toISOString();
  const expiresAtMs = Date.now() + ttlHours * 3600 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();

  const newRoom = {
    code,
    pin,
    createdAt,
    expiresAt,
    ttlHours,
    totalBytes: 0
  };

  db.rooms.push(newRoom);
  saveDatabase(db);

  const token = signToken(code, expiresAtMs);
  res.cookie('quickshare_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ttlHours * 3600 * 1000
  });

  res.status(201).json({
    code,
    pin,
    createdAt,
    expiresAt,
    ttlHours
  });
});

// Join Room
app.post('/api/rooms/:code/join', roomJoinLimiter, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const { pin } = req.body;

  const room = db.rooms.find(r => r.code === code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found or expired.' });
  }

  if (Date.now() > new Date(room.expiresAt).getTime()) {
    return res.status(410).json({ error: 'This room has expired.' });
  }

  if (!pin || pin.trim() !== room.pin) {
    return res.status(401).json({ error: 'Incorrect 6-digit PIN. Please try again.' });
  }

  const expiresAtMs = new Date(room.expiresAt).getTime();
  const token = signToken(room.code, expiresAtMs);

  res.cookie('quickshare_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(1000, expiresAtMs - Date.now())
  });

  res.json({ success: true, code: room.code });
});

// Current Room Session
app.get('/api/rooms/current', requireAuthRoom, (req, res) => {
  const ips = getLocalIpAddresses();
  const baseUrl = getBaseUrl(req);
  res.json({
    code: req.room.code,
    pin: req.room.pin,
    createdAt: req.room.createdAt,
    expiresAt: req.room.expiresAt,
    ttlHours: req.room.ttlHours,
    totalBytes: req.room.totalBytes || 0,
    localIps: ips,
    joinUrl: `${baseUrl}/join/${req.room.code}?pin=${req.room.pin}`
  });
});

// End Room Session
app.post('/api/rooms/:code/end', requireAuthRoom, (req, res) => {
  const code = req.room.code;

  // Purge all files on disk for this room
  const roomItems = db.items.filter(it => it.roomId === code);
  for (const item of roomItems) {
    if (item.type === 'file' && item.storedName) {
      const p = path.join(UPLOADS_DIR, item.storedName);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    }
  }

  // Remove room items and room record
  db.items = db.items.filter(it => it.roomId !== code);
  db.rooms = db.rooms.filter(r => r.code !== code);
  saveDatabase(db);

  io.to(code).emit('room:ended');
  res.clearCookie('quickshare_session');
  res.json({ success: true, message: 'Room ended and files permanently destroyed.' });
});

// Pairing Details & QR Code Generation (Dynamic Base URL via getBaseUrl)
app.get('/api/pairing', requireAuthRoom, async (req, res) => {
  const baseUrl = getBaseUrl(req);
  const directUrl = `${baseUrl}/join/${req.room.code}?pin=${req.room.pin}`;

  try {
    const qrDataUrl = await qrcode.toDataURL(directUrl, {
      margin: 2,
      width: 256,
      color: { dark: '#0f1020', light: '#ffffff' }
    });

    res.json({
      roomCode: req.room.code,
      pin: req.room.pin,
      directUrl,
      joinUrl: directUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Direct Join Link Verification & Alias
app.get('/api/join', requireAuthRoom, (req, res) => {
  const baseUrl = getBaseUrl(req);
  const directUrl = `${baseUrl}/join/${req.room.code}?pin=${req.room.pin}`;
  res.json({
    roomCode: req.room.code,
    pin: req.room.pin,
    directUrl,
    joinUrl: directUrl
  });
});

// Get Room Items
app.get('/api/items', requireAuthRoom, (req, res) => {
  const roomItems = db.items.filter(it => it.roomId === req.room.code);
  res.json(roomItems);
});

// Send Text / Link
app.post('/api/items/text', requireAuthRoom, (req, res) => {
  const roomItems = db.items.filter(it => it.roomId === req.room.code);
  if (roomItems.length >= MAX_ROOM_ITEMS) {
    return res.status(400).json({ error: `Room limit reached: maximum ${MAX_ROOM_ITEMS} items.` });
  }

  const { content, senderDevice, senderId } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  const newItem = {
    id: crypto.randomUUID(),
    roomId: req.room.code,
    type: 'text',
    content: content.trim(),
    senderDevice: senderDevice === 'Phone' ? 'Phone' : 'Laptop',
    senderId: senderId || 'anonymous',
    timestamp: new Date().toISOString()
  };

  db.items.unshift(newItem);
  saveDatabase(db);

  io.to(req.room.code).emit('item:created', newItem);
  res.status(201).json(newItem);
});

// Upload File
app.post('/api/items/upload', requireAuthRoom, uploadLimiter, (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files selected for upload.' });
    }

    const roomItems = db.items.filter(it => it.roomId === req.room.code);
    if (roomItems.length + req.files.length > MAX_ROOM_ITEMS) {
      // Clean up uploaded files
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
      return res.status(400).json({ error: `Room item limit (${MAX_ROOM_ITEMS}) exceeded.` });
    }

    const uploadTotalBytes = req.files.reduce((s, f) => s + f.size, 0);
    const roomBytes = req.room.totalBytes || 0;
    if (roomBytes + uploadTotalBytes > MAX_ROOM_MB * 1024 * 1024) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
      return res.status(400).json({ error: `Room capacity limit (${MAX_ROOM_MB} MB) exceeded.` });
    }

    const senderDevice = req.body.senderDevice === 'Phone' ? 'Phone' : 'Laptop';
    const senderId = req.body.senderId || 'anonymous';
    const createdItems = [];

    for (const file of req.files) {
      const isRasterImage = file.mimetype.startsWith('image/') && file.mimetype !== 'image/svg+xml';
      const isVideo = file.mimetype.startsWith('video/');
      const isAudio = file.mimetype.startsWith('audio/');
      const isMedia = isRasterImage || isVideo || isAudio;

      // Sanitize display name
      const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._\-\s]/g, '_');

      const newItem = {
        id: crypto.randomUUID(),
        roomId: req.room.code,
        type: 'file',
        fileName: safeName,
        storedName: file.filename,
        fileSize: file.size,
        mimeType: file.mimetype,
        isMedia,
        fileUrl: `/uploads/${file.filename}`,
        senderDevice,
        senderId,
        timestamp: new Date().toISOString()
      };

      db.items.unshift(newItem);
      createdItems.push(newItem);
      io.to(req.room.code).emit('item:created', newItem);
    }

    req.room.totalBytes = (req.room.totalBytes || 0) + uploadTotalBytes;
    saveDatabase(db);

    res.status(201).json({ items: createdItems });
  });
});

// Delete Item
app.delete('/api/items/:id', requireAuthRoom, (req, res) => {
  const { id } = req.params;
  const index = db.items.findIndex(it => it.id === id && it.roomId === req.room.code);
  if (index === -1) {
    return res.status(404).json({ error: 'Item not found in this room.' });
  }

  const [removed] = db.items.splice(index, 1);
  if (removed.type === 'file' && removed.storedName) {
    const p = path.join(UPLOADS_DIR, removed.storedName);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
    req.room.totalBytes = Math.max(0, (req.room.totalBytes || 0) - (removed.fileSize || 0));
  }
  saveDatabase(db);

  io.to(req.room.code).emit('item:deleted', { id });
  res.json({ success: true, id });
});

// Download All Files as ZIP
app.get('/api/items/zip', requireAuthRoom, (req, res) => {
  const fileItems = db.items.filter(it => it.roomId === req.room.code && it.type === 'file' && it.storedName);
  if (fileItems.length === 0) {
    return res.status(400).json({ error: 'No files to download in this room.' });
  }

  const archive = archiver('zip', { zlib: { level: 6 } });
  const filename = `QuickShare_${req.room.code}_${new Date().toISOString().slice(0, 10)}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  archive.pipe(res);

  const seenNames = new Map();
  for (const item of fileItems) {
    const fullPath = path.join(UPLOADS_DIR, item.storedName);
    if (fs.existsSync(fullPath)) {
      let displayName = item.fileName || item.storedName;
      if (seenNames.has(displayName)) {
        const count = seenNames.get(displayName) + 1;
        seenNames.set(displayName, count);
        const parsed = path.parse(displayName);
        displayName = `${parsed.name}_${count}${parsed.ext}`;
      } else {
        seenNames.set(displayName, 1);
      }
      archive.file(fullPath, { name: displayName });
    }
  }

  archive.finalize();
});

// Secure Upload Serving Endpoint
app.get('/uploads/:filename', (req, res) => {
  const requestedFile = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, requestedFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  const item = db.items.find(it => it.storedName === requestedFile);
  const mimeType = item?.mimeType || 'application/octet-stream';
  const originalName = item?.fileName || requestedFile;

  const isSafeInline = (
    (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/')
  );

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (isSafeInline && !req.query.download) {
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
  }

  fs.createReadStream(filePath).pipe(res);
});

// Report Abuse Endpoint
app.post('/api/report', (req, res) => {
  const { roomCode, reason, details } = req.body;
  console.log(`[ABUSE_REPORT] Room: ${roomCode || 'N/A'}, Reason: ${reason}`);
  res.json({ success: true, message: 'Report received.' });
});

// Health Probe
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    activeRooms: db.rooms.length,
    timestamp: new Date().toISOString()
  });
});

// ==========================================================================
// Static Assets & Page Routing
// ==========================================================================

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Landing / Marketing
app.get('/', (req, res) => {
  const room = getAuthRoom(req);
  if (room) {
    return res.redirect('/app');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Workspace App
app.get('/app', (req, res) => {
  const room = getAuthRoom(req);
  if (!room) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Deep link QR Join
app.get('/join/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const room = db.rooms.find(r => r.code === code);

  if (!room) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  // Already authenticated in this room
  const authRoom = getAuthRoom(req);
  if (authRoom && authRoom.code === code) {
    return res.redirect('/app');
  }

  // Fast-track QR join: if valid PIN provided in query parameter, issue cookie and redirect to /app
  const pinQuery = req.query.pin;
  if (pinQuery && pinQuery === room.pin) {
    const expiresAt = new Date(room.expiresAt).getTime();
    const token = signToken(room.code, expiresAt);
    res.cookie('quickshare_session', token, {
      httpOnly: true,
      secure: req.secure || req.protocol === 'https',
      sameSite: 'lax',
      maxAge: expiresAt - Date.now()
    });
    return res.redirect('/app');
  }

  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// Informational Pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, 'public', 'report.html')));

// 404 Handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ==========================================================================
// Scheduled Background Cleanup (Purge Expired Rooms Every 10 Minutes)
// ==========================================================================

function purgeExpiredRooms() {
  const now = Date.now();
  const expiredRooms = db.rooms.filter(r => now > new Date(r.expiresAt).getTime());

  if (expiredRooms.length === 0) return;

  for (const room of expiredRooms) {
    console.log(`[CLEANUP] Purging expired room: ${room.code}`);
    const items = db.items.filter(it => it.roomId === room.code);
    for (const item of items) {
      if (item.type === 'file' && item.storedName) {
        const p = path.join(UPLOADS_DIR, item.storedName);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (e) {}
        }
      }
    }
    db.items = db.items.filter(it => it.roomId !== room.code);
    io.to(room.code).emit('room:expired');
  }

  db.rooms = db.rooms.filter(r => now <= new Date(r.expiresAt).getTime());
  saveDatabase(db);
}

const cleanupTimer = setInterval(purgeExpiredRooms, 10 * 60 * 1000);
if (cleanupTimer && cleanupTimer.unref) {
  cleanupTimer.unref();
}

// ==========================================================================
// Socket.io Room Scoping & Presence
// ==========================================================================

const roomSockets = new Map(); // roomId -> Set of socketIds

io.on('connection', (socket) => {
  const roomId = socket.handshake.query.roomId;
  const deviceType = socket.handshake.query.deviceType || 'Laptop';
  const deviceId = socket.handshake.query.deviceId || socket.id;

  if (!roomId) {
    socket.disconnect();
    return;
  }

  socket.join(roomId);

  if (!roomSockets.has(roomId)) {
    roomSockets.set(roomId, new Map());
  }
  const clientsMap = roomSockets.get(roomId);
  clientsMap.set(socket.id, { deviceType, deviceId });

  const broadcastPresence = () => {
    const list = Array.from(clientsMap.values());
    io.to(roomId).emit('presence:update', {
      count: list.length,
      devices: list.map(d => d.deviceType)
    });
  };

  broadcastPresence();

  socket.on('disconnect', () => {
    clientsMap.delete(socket.id);
    if (clientsMap.size === 0) {
      roomSockets.delete(roomId);
    } else {
      broadcastPresence();
    }
  });
});

// ==========================================================================
// Graceful Shutdown & Server Startup
// ==========================================================================

function gracefulShutdown() {
  console.log('\nGracefully shutting down QuickShare Pro...');
  server.close(() => {
    console.log('HTTP and WebSocket server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` ✨ QUICKSHARE PRO V2 — PUBLIC-READY SAAS`);
    console.log(` 🚀 Listening on port ${PORT}`);
    console.log(` 🌐 Landing: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

module.exports = { app, server, db, purgeExpiredRooms };
