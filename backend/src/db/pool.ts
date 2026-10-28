import { Pool, types } from 'pg';
import { config } from '../config';

// numeric (1700) and bigint (20) arrive as strings by default; the calculation
// engine works with plain JS numbers (as the original browser app did).
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});
