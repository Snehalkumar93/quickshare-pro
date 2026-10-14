const fs = require('fs');
const http = require('http');

fs.writeFileSync('test_media/test_doc.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');

const boundary = '----WebKitFormBoundarySVG';
const fileData = fs.readFileSync('test_media/test_doc.svg');
const pre = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="test_doc.svg"\r\nContent-Type: image/svg+xml\r\n\r\n`);
const post = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="senderDevice"\r\n\r\nLaptop\r\n--${boundary}--\r\n`);
const payload = Buffer.concat([pre, fileData, post]);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/items/upload?pin=123456',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': payload.length
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const item = json.items[0];
    console.log('Uploaded SVG item isMedia:', item.isMedia);

    http.get(`http://localhost:3000${item.fileUrl}`, (fileRes) => {
      console.log('SVG File Content-Type:', fileRes.headers['content-type']);
      console.log('SVG File Content-Disposition:', fileRes.headers['content-disposition']);
      console.log('SVG X-Content-Type-Options:', fileRes.headers['x-content-type-options']);
    });
  });
});
req.write(payload);
req.end();
