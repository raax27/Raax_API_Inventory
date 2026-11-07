const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
http.createServer((req, res) => {
  const filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
  }
}).listen(PORT, '0.0.0.0', () => console.log('Raax API inventory listening on http://0.0.0.0:' + PORT));
