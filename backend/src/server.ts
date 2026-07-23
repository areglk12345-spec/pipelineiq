import 'dotenv/config';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './auth/routes';
import { usersRouter } from './users/routes';
import { dealsRouter } from './deals/routes';
import { approvalsRouter } from './approvals/routes';
import { customersRouter } from './customers/routes';
import { securityRouter } from './security/routes';

const app = express();

// Vercel (and most PaaS/serverless hosts) terminate TLS at an edge proxy and
// forward the real client IP via X-Forwarded-For — without this, req.ip is
// always the proxy's own address, which silently breaks the login rate
// limiter (everyone appears to share one IP) and login_audit's IP column.
app.set('trust proxy', 1);

// Frontend is served same-origin — locally via express.static below; on
// Vercel, via its own static hosting (see vercel.json's outputDirectory),
// not through this function at all. Either way, no CORS is needed for the
// primary app. CORS_ORIGIN stays available for any additional client (e.g.
// a future separate admin tool) that needs cross-origin access with
// credentials.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({ origin: allowedOrigins, credentials: true }));
}

app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/deals', dealsRouter);
app.use('/approvals', approvalsRouter);
app.use('/customers', customersRouter);
app.use('/security-settings', securityRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

if (!process.env.VERCEL) {
  // Local dev / a persistent-process host (not this app's target, but kept
  // working): serve the frontend from this same process and listen directly.
  // This directory sits one level up from backend/ regardless of whether
  // this file is running from src/ (tsx dev) or dist/ (compiled), since both
  // share the same depth under backend/.
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`pipelineiq-backend listening on :${port}`));
}

export default app;
