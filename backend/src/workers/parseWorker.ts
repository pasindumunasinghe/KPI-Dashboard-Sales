import { parentPort } from 'worker_threads';
import { parseUpload, UploadError, type DatasetKey } from '../importers/parse';

// Parsing a large SAP export (hundreds of thousands of rows) is CPU-bound, so it
// runs here to keep the Express event loop responsive.
parentPort!.on('message', (msg: { dataset: DatasetKey; buffer: Uint8Array }) => {
  try {
    const parsed = parseUpload(msg.dataset, msg.buffer);
    parentPort!.postMessage({ ok: true, parsed });
  } catch (err) {
    if (err instanceof UploadError) {
      parentPort!.postMessage({ ok: false, userError: true, message: err.message, missing: err.missing });
    } else {
      parentPort!.postMessage({ ok: false, userError: false, message: (err as Error).message });
    }
  }
});
