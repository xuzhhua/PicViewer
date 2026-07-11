const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const foldersRouter = require('./routes/folders');
const browseRouter = require('./routes/browse');
const imageRouter = require('./routes/image');
const downloadRouter = require('./routes/download');
const ignoredRouter = require('./routes/ignored');

const app = express();

// Read port from config file (env var > config > default)
function getPort() {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.port) return config.port;
    }
  } catch (e) { /* ignore config parse error */ }
  return 3456;
}
const PORT = getPort();

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/folders', foldersRouter);
app.use('/api/browse', browseRouter);
app.use('/api/image', imageRouter);
app.use('/api/download', downloadRouter);
app.use('/api/ignored', ignoredRouter);

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function startServer(port) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`PicViewer running at http://localhost:${port}`);
    console.log(`LAN access:  http://${getLocalIP()}:${port}`);
    console.log(`Folders:     ${path.join(__dirname, 'data', 'folders.json')}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });
}

startServer(PORT);

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '0.0.0.0';
}
