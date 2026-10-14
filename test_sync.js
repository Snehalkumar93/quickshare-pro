const { io } = require('socket.io-client');
const http = require('http');

console.log('Connecting simulated Phone client to Socket.io...');
const socket = io('http://localhost:3000', {
  query: {
    deviceType: 'Phone',
    deviceId: 'phone_test_client'
  }
});

socket.on('connect', () => {
  console.log('✅ Phone client connected with socket ID:', socket.id);
});

socket.on('presence:update', (presence) => {
  console.log('⚡ Presence update received:', JSON.stringify(presence));
});

socket.on('item:created', (item) => {
  console.log('✨ Real-time item:created received:', item.id, item.type, item.senderDevice);
});

socket.on('item:deleted', (data) => {
  console.log('🗑️ Real-time item:deleted received:', data.id);
});

// Send a test message from simulated phone via API
setTimeout(() => {
  const payload = JSON.stringify({
    content: 'Hello from iPhone 14 Pro Max! Real-time sync test 🚀',
    senderDevice: 'Phone',
    senderId: 'phone_test_client'
  });

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/items/text?pin=123456',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const item = JSON.parse(data);
      console.log('📱 Phone posted message:', item.id);

      // Now delete the item after 1 second to test real-time deletion
      setTimeout(() => {
        const delReq = http.request({
          hostname: 'localhost',
          port: 3000,
          path: `/api/items/${item.id}?pin=123456`,
          method: 'DELETE'
        }, (delRes) => {
          console.log('📱 Phone deleted message status:', delRes.statusCode);
          setTimeout(() => {
            socket.disconnect();
            process.exit(0);
          }, 500);
        });
        delReq.end();
      }, 1000);
    });
  });

  req.write(payload);
  req.end();
}, 1000);
