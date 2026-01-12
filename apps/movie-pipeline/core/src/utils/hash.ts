import fs from 'node:fs';
import crypto from 'node:crypto';

export async function hashBuffer(buf: Buffer) {
  const h = crypto.createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}

export async function hashString(text: string) {
  const h = crypto.createHash('sha256');
  h.update(text, 'utf8');
  return h.digest('hex');
}

export async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => reject(err));
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}
