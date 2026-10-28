import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { config } from './config';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { dataRouter } from './routes/data';
import { periodsRouter } from './routes/periods';
import { uploadsRouter } from './routes/uploads';
import { PeriodLockedError, PeriodStateError, isPeriodLockDbError } from './services/periods';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/periods', periodsRouter);
  app.use('/api', dataRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than the ${config.maxUploadMb} MB limit.` : err.message;
      res.status(413).json({ error: message });
      return;
    }
    if (err instanceof PeriodLockedError) {
      res.status(423).json({ error: err.message, locked: true });
      return;
    }
    if (isPeriodLockDbError(err)) {
      // Raised by the database trigger as a last line of defence.
      res.status(423).json({ error: 'That month is locked. An administrator must unlock it before its data can be changed.', locked: true });
      return;
    }
    if (err instanceof PeriodStateError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
