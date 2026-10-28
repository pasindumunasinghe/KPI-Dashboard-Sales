import path from 'path';
import { Worker } from 'worker_threads';
import { UploadError, type DatasetKey, type MonthScope, type ParsedUpload } from './parse';

/** Parses an uploaded workbook in a worker thread (compiled .js, or .ts under tsx). */
export function parseInWorker(dataset: DatasetKey, buffer: Buffer, scope?: MonthScope): Promise<ParsedUpload> {
  const ext = path.extname(__filename);
  const worker = new Worker(path.join(__dirname, '..', 'workers', `parseWorker${ext}`));
  return new Promise<ParsedUpload>((resolve, reject) => {
    worker.once('message', (msg) => {
      void worker.terminate();
      if (msg.ok) resolve(msg.parsed as ParsedUpload);
      else if (msg.userError) reject(new UploadError(msg.message, msg.missing));
      else reject(new Error(msg.message));
    });
    worker.once('error', reject);
    worker.postMessage({ dataset, buffer: new Uint8Array(buffer), scope });
  });
}
