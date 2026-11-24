// VAPID (RFC 8292) helpers: base64url codecs, key import, ES256 JWT signing via WebCrypto.

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes, leading 0x04), base64url. */
  publicKey: string;
  /** Raw P-256 private scalar (32 bytes), base64url. */
  privateKey: string;
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Builds the JWK for a P-256 key pair from the raw VAPID encodings. */
export function vapidJwk(keys: VapidKeys): JsonWebKey {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  const d = b64urlDecode(keys.privateKey);
  if (d.length !== 32) throw new Error('VAPID private key must be 32 bytes');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: b64urlEncode(d),
    ext: true,
  };
}

export async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', vapidJwk(keys), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Generates a fresh P-256 VAPID key pair with WebCrypto (same encodings as scripts/gen-vapid.mjs). */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!pubJwk.x || !pubJwk.y || !privJwk.d) throw new Error('WebCrypto did not export P-256 coordinates');
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub.set(b64urlDecode(pubJwk.x), 1);
  pub.set(b64urlDecode(pubJwk.y), 33);
  return { publicKey: b64urlEncode(pub), privateKey: privJwk.d };
}

/**
 * Signs an ES256 VAPID JWT for one push endpoint.
 * aud = endpoint origin, exp = now + 12h, sub = VAPID subject (mailto: or https: URL).
 * WebCrypto returns the signature already as raw r||s (64 bytes), so no DER conversion is needed.
 */
export async function createVapidJwt(
  endpoint: string,
  subject: string,
  keys: VapidKeys,
  now: Date,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const key = await importVapidPrivateKey(keys);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input) as BufferSource);
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`;
}
