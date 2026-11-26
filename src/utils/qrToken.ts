import crypto from 'crypto';

export interface HandoffQrToken {
  deliveryId: string;
  expiresAt: number;
  nonce: string;
  signature: string;
}

export function getQrTokenTtlSeconds(): number {
  const ttl = Number(process.env.QR_TOKEN_TTL_SECONDS ?? '1800');
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) {
    throw new Error('QR_TOKEN_TTL_SECONDS must be an integer between 1 and 86400');
  }
  return ttl;
}

export function getQrTokenSecret(): string {
  const secret = process.env.QR_TOKEN_SECRET ?? process.env.JWT_SECRET ?? '';
  if (secret.length < 16) throw new Error('QR_TOKEN_SECRET must contain at least 16 characters');
  return secret;
}

export function generateQrToken(
  deliveryId: string,
  now = Date.now(),
  nonce = crypto.randomUUID(),
): string {
  const expiresAt = now + getQrTokenTtlSeconds() * 1000;
  const payload = `${deliveryId}:${expiresAt}:${nonce}`;
  const signature = crypto.createHmac('sha256', getQrTokenSecret()).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ deliveryId, expiresAt, nonce, signature })).toString(
    'base64url',
  );
}

export function hashQrToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyQrToken(token: string): { deliveryId: string; expiresAt: number } {
  let decoded: HandoffQrToken;
  try {
    decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')) as HandoffQrToken;
  } catch {
    throw new Error('Invalid QR token format');
  }

  if (
    !decoded ||
    typeof decoded.deliveryId !== 'string' ||
    !decoded.deliveryId ||
    typeof decoded.expiresAt !== 'number' ||
    typeof decoded.nonce !== 'string' ||
    typeof decoded.signature !== 'string'
  ) {
    throw new Error('Invalid QR token format');
  }

  if (Date.now() >= decoded.expiresAt) throw new Error('QR token has expired');

  const payload = `${decoded.deliveryId}:${decoded.expiresAt}:${decoded.nonce}`;
  const expected = crypto.createHmac('sha256', getQrTokenSecret()).update(payload).digest('hex');
  const actualBuffer = Buffer.from(decoded.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid QR token signature');
  }

  return { deliveryId: decoded.deliveryId, expiresAt: decoded.expiresAt };
}
