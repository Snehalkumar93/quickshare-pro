const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, db, purgeExpiredRooms } = require('../server.js');

test('QuickShare Pro V2 — Automated Test Suite', async (t) => {

  let roomA = null;
  let roomB = null;
  let cookieA = null;
  let cookieB = null;

  await t.test('1. Create Room (Returns 201, 6-char code, 6-digit PIN, session cookie)', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .send({ ttlHours: 24 });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.code, 'Should return room code');
    assert.strictEqual(res.body.code.length, 6, 'Code should be 6 characters');
    assert.strictEqual(res.body.pin.length, 6, 'PIN should be 6 digits');
    assert.strictEqual(res.body.ttlHours, 24);

    const cookies = res.headers['set-cookie'];
    assert.ok(cookies, 'Should set session cookie');
    assert.ok(cookies.some(c => c.includes('quickshare_session=')), 'Cookie should contain quickshare_session');

    roomA = res.body;
    cookieA = cookies[0].split(';')[0];
  });

  await t.test('2. Wrong PIN Rejection (Returns 401 on incorrect PIN)', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomA.code}/join`)
      .send({ pin: '000000' });

    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error.includes('Incorrect 6-digit PIN'));
  });

  await t.test('3. Correct PIN Join (Returns 200 and session cookie)', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomA.code}/join`)
      .send({ pin: roomA.pin });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, roomA.code);
    assert.ok(res.headers['set-cookie'], 'Should set cookie upon joining');
  });

  await t.test('4. Room Isolation (Room A cannot read items from Room B)', async () => {
    // Create Room B
    const resB = await request(app)
      .post('/api/rooms')
      .send({ ttlHours: 1 });
    assert.strictEqual(resB.status, 201);
    roomB = resB.body;
    cookieB = resB.headers['set-cookie'][0].split(';')[0];

    // Post text item into Room A
    const postItemA = await request(app)
      .post('/api/items/text')
      .set('Cookie', cookieA)
      .send({ content: 'Confidential Note for Room A' });
    assert.strictEqual(postItemA.status, 201);

    // Post text item into Room B
    const postItemB = await request(app)
      .post('/api/items/text')
      .set('Cookie', cookieB)
      .send({ content: 'Secret Note for Room B' });
    assert.strictEqual(postItemB.status, 201);

    // Fetch items from Room A
    const getItemsA = await request(app)
      .get('/api/items')
      .set('Cookie', cookieA);
    assert.strictEqual(getItemsA.status, 200);
    const contentsA = getItemsA.body.map(it => it.content);
    assert.ok(contentsA.includes('Confidential Note for Room A'), 'Room A should have its note');
    assert.ok(!contentsA.includes('Secret Note for Room B'), 'Room A must NOT contain Room B items');

    // Fetch items from Room B
    const getItemsB = await request(app)
      .get('/api/items')
      .set('Cookie', cookieB);
    assert.strictEqual(getItemsB.status, 200);
    const contentsB = getItemsB.body.map(it => it.content);
    assert.ok(contentsB.includes('Secret Note for Room B'), 'Room B should have its note');
    assert.ok(!contentsB.includes('Confidential Note for Room A'), 'Room B must NOT contain Room A items');
  });

  await t.test('5. Upload Security: Block Dangerous Extensions (.exe, .bat, etc.)', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .set('Cookie', cookieA)
      .attach('files', Buffer.from('malicious payload'), 'malware.exe');

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Blocked file type'), 'Should block .exe file');
  });

  await t.test('6. Scheduled Room Expiry Cleanup', async () => {
    // Insert a room that expired in the past
    const expiredCode = 'EXPIR1';
    db.rooms.push({
      code: expiredCode,
      pin: '123456',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      ttlHours: 1,
      totalBytes: 0
    });
    db.items.push({
      id: 'exp-item-1',
      roomId: expiredCode,
      type: 'text',
      content: 'Expired text',
      timestamp: new Date().toISOString()
    });

    assert.ok(db.rooms.some(r => r.code === expiredCode), 'Expired room should initially exist');

    // Trigger cleanup
    purgeExpiredRooms();

    assert.ok(!db.rooms.some(r => r.code === expiredCode), 'Expired room should be purged');
    assert.ok(!db.items.some(it => it.roomId === expiredCode), 'Expired room items should be purged');
  });

  await t.test('7. Healthz Probe', async () => {
    const res = await request(app).get('/healthz');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(typeof res.body.uptime === 'number');
  });

});
