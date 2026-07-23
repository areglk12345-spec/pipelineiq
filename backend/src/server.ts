import 'dotenv/config';
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

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
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

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`pipelineiq-backend listening on :${port}`));
