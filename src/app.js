// src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

import { swaggerOptions } from './config/swagger.js';
import routes from './routes/index.routes.js';
import { notFound, errorHandler } from './middlewares/error-handler.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Dev/Prod-safe Helmet. No invalid meta, no COEP in dev.
app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
// After (allow cross-origin media consumption):
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' } // << important
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Static (optional)
app.use(express.static(path.join(process.cwd(), 'public')));

// Quiet favicon console noise
app.get('/favicon.ico', (_req, res) => res.status(204).end());

/* ============================
   Swagger Docs
   ============================ */
const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Optional: raw spec (not used by the UI, but handy for debugging)
app.get('/swagger.json', (_req, res) => {
  res.type('application/json').status(200).send(swaggerSpec);
});

// CSP for the Swagger page (allows self + CDN assets)
const swaggerCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
    styleSrc:  ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
    imgSrc:    ["'self'", "data:", "https://unpkg.com", "https://cdn.jsdelivr.net"],
    connectSrc:["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"], // API calls are same-origin => 'self'
    workerSrc: ["'self'", "blob:"],
    frameAncestors: ["'self'"],
  },
});

// Serve Swagger UI — spec is inlined; server URL matches page origin (http or https)
app.get('/swagger', swaggerCsp, (_req, res) => {
  const specJson = JSON.stringify(swaggerSpec);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>DX OCR API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; background: #fff; }
    #swagger-ui { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>

  <script>
    (function () {
      // Clone spec and set the first server to the exact page origin (scheme preserved)
      var spec = ${specJson};
      var origin = window.location.origin; // e.g., https://dxocr.vercel.app or http://192.168.x.x:3000
      spec.servers = [{ url: origin, description: 'This Origin' }, { url: '/', description: 'Relative' }];
      window.__SWAGGER_SPEC__ = spec;
    })();
  </script>

  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        spec: window.__SWAGGER_SPEC__,
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true
      });
    };
  </script>
</body>
</html>`;
  res.type('text/html; charset=utf-8').status(200).send(html);
});

/* ===== Health ===== */
app.get('/health', (_req, res) => {
  res.json({ success: true, status: 'OK' });
});

/* ===== API routes ===== */
app.use('/api', routes);

/* ===== 404 + error handlers ===== */
app.use(notFound);
app.use(errorHandler);

export default app;
