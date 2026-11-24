// Generates a VAPID key pair (P-256) and prints the values and the wrangler commands to store them.
// Usage: npm run vapid   (or: node scripts/gen-vapid.mjs)
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

// Uncompressed point: 0x04 || x || y, base64url (no padding).
const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(pubJwk.x, 'base64url'), Buffer.from(pubJwk.y, 'base64url')]);
const VAPID_PUBLIC_KEY = point.toString('base64url');
// Raw 32-byte private scalar, base64url (no padding).
const VAPID_PRIVATE_KEY = Buffer.from(privJwk.d, 'base64url').toString('base64url');

if (point.length !== 65 || Buffer.from(VAPID_PRIVATE_KEY, 'base64url').length !== 32) {
  throw new Error('Unexpected key sizes');
}

console.log('# Keep the private key secret. Paste these into the Worker secrets:');
console.log(`VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}`);
console.log(`VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}`);
console.log('');
console.log('# Store them (you will be prompted for each value):');
console.log('npx wrangler secret put VAPID_PUBLIC_KEY');
console.log('npx wrangler secret put VAPID_PRIVATE_KEY');
console.log('# VAPID_SUBJECT is a plain var in wrangler.jsonc: set it to mailto:<your email>.');
