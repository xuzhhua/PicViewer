const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const foldersRouter = require('./routes/folders');
const browseRouter = require('./routes/browse');
const imageRouter = require('./routes/image');
const downloadRouter = require('./routes/download');
const ignoredRouter = require('./routes/ignored');
const searchRouter = require('./routes/search');
const actionsRouter = require('./routes/actions');

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

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/folders', foldersRouter);
app.use('/api/browse', browseRouter);
app.use('/api/image', imageRouter);
app.use('/api/download', downloadRouter);
app.use('/api/ignored', ignoredRouter);
app.use('/api/search', searchRouter);
app.use('/api/actions', actionsRouter);

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

/**
 * Start the HTTP server. Returns the http.Server instance.
 * @param {number} [port] - Port to listen on (default: from config or 3456)
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
function startServer(port) {
  const targetPort = port || getPort();
  const MAX_RETRIES = 100;

  return new Promise((resolve, reject) => {
    function tryPort(p, attempts) {
      if (attempts >= MAX_RETRIES) {
        return reject(new Error(`Failed to find an available port after ${MAX_RETRIES} attempts`));
      }

      const server = app.listen(p, '0.0.0.0', () => {
        console.log(`PicViewer running at http://localhost:${p}`);
        console.log(`LAN access:  http://${getLocalIP()}:${p}`);
        resolve({ server, port: p });
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${p} is in use, trying ${p + 1}...`);
          tryPort(p + 1, attempts + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(targetPort, 0);
  });
}

// Run standalone if called directly (not imported by Electron)
if (require.main === module) {
  startServer().catch((err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });
}

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

module.exports = { app, startServer, getPort };
