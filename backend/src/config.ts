import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: required('DATABASE_URL', 'postgres://kpi:kpi@localhost:5432/kpi'),
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Administrator',
  /** Calendar year in which the financial year starts (April). FY26/27 -> 2026. */
  fiscalYearStart: parseInt(process.env.FISCAL_YEAR_START || '2026', 10),
  corsOrigin: process.env.CORS_ORIGIN || '',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '200', 10)
};
