// Detached signature of a SO4AG source (draft for 0.2). Pure functions: no storage, no network.
// The signature covers the digest of the whole manifest (JCS + SHA-256), so any change to any claim breaks it.
import { createHash, createPublicKey, verify as edVerify, sign as edSign } from 'node:crypto';
import { canonicalize } from './index.mjs';

export const SIGNATURE_VERSION = '0.2-draft';
export const manifestDigest = (m) => 'sha256:' + createHash('sha256').update(canonicalize(m)).digest('hex');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const payloadOf = (sig) => { const { signature, ...rest } = sig; return Buffer.from(canonicalize(rest), 'utf8'); };

/** Build the signature document. `privateKey` is a node KeyObject (Ed25519). */
export function signManifest(manifest, { privateKey, keyId, keyUrl, signedAt }) {
  const doc = { so4ag_signature: SIGNATURE_VERSION, source: manifest.id, revision: manifest.revision, digest: manifestDigest(manifest), algorithm: 'Ed25519', key_id: keyId, key_url: keyUrl, signed_at: signedAt };
  return { ...doc, signature: b64u(edSign(null, payloadOf(doc), privateKey)) };
}

/** -> { valid, reasons[], key } ; reasons: source_mismatch, revision_mismatch, digest_mismatch, algorithm, unknown_key, key_retired, bad_signature */
export function verifySignature(manifest, sig, keysDoc, { now = new Date() } = {}) {
  const reasons = [];
  if (!sig || typeof sig !== 'object' || typeof sig.signature !== 'string') return { valid: false, reasons: ['bad_signature'], key: null };
  if (sig.source !== manifest.id) reasons.push('source_mismatch');
  if (sig.revision !== manifest.revision) reasons.push('revision_mismatch');
  if (sig.digest !== manifestDigest(manifest)) reasons.push('digest_mismatch');
  if (sig.algorithm !== 'Ed25519') reasons.push('algorithm');
  const key = (keysDoc?.keys || []).find((k) => k.key_id === sig.key_id && k.algorithm === 'Ed25519');
  if (!key) return { valid: false, reasons: [...reasons, 'unknown_key'], key: null };
  // a retired key still verifies what it signed before it was retired
  if (key.retired_at && Date.parse(sig.signed_at) >= Date.parse(key.retired_at)) reasons.push('key_retired');
  if (Date.parse(sig.signed_at) > now.getTime() + 5 * 60e3) reasons.push('bad_signature');
  try {
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.public_key }, format: 'jwk' });
    if (!edVerify(null, payloadOf(sig), pub, Buffer.from(sig.signature, 'base64url'))) reasons.push('bad_signature');
  } catch { reasons.push('bad_signature'); }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], key };
}
