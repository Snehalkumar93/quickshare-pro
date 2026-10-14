const fs = require('fs');
const http = require('http');
const path = require('path');

function uploadFile(filePath, device = 'Phone', deviceId = 'phone_client_1') {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mime = fileName.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4';

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    );

    const footer = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="senderDevice"\r\n\r\n${device}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="senderId"\r\n\r\n${deviceId}\r\n` +
      `--${boundary}--\r\n`
    );

    const payload = Buffer.concat([header, fileData, footer]);

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/items/upload?pin=123456',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
        'Cookie': 'quickshare_pin=123456'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Uploaded ${fileName}: HTTP ${res.statusCode}`);
        resolve(data);
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  await uploadFile('test_media/sample_photo.jpg', 'Phone', 'phone_client_demo');
  await uploadFile('test_media/sample_video.mp4', 'Laptop', 'laptop_client_demo');
  console.log('All sample uploads completed successfully');
}

run().catch(console.error);
