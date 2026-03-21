const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3799;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(PORT, () => console.log('Mockup on http://localhost:' + PORT));
