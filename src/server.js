// src/server.js
import http from 'http';
import os from 'os';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

http.createServer(app).listen(PORT, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(`http://${net.address}:${PORT}`);
    }
  }
  const local = `http://localhost:${PORT}`;
  const lines = [
    '',
    'HTTP server listening:',
    `  • Local:   ${local}`,
    ...(addrs.length ? [`  • Network: ${addrs.join(', ')}`] : []),
    'Swagger UI:',
    `  • ${local}/swagger`,
    ...(addrs.length ? addrs.map(a => `  • ${a}/swagger`) : []),
    '',
  ];
  console.log(lines.join('\n'));
});
