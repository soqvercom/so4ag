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
  // The time rules rest on dates that must be readable: an unreadable date is a refusal, never a pass.
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const at = (x) => (typeof x === 'string' && ISO.test(x) ? Date.parse(x) : NaN);
  const signedAt = at(sig.signed_at); const created = at(key.created_at);
  const retired = key.retired_at === undefined || key.retired_at === null ? null : at(key.retired_at);
  if (!Number.isFinite(signedAt)) reasons.push('bad_signed_at');
  if (!Number.isFinite(created) || (retired !== null && !Number.isFinite(retired))) reasons.push('bad_key_metadata');
  if (Number.isFinite(signedAt)) {
    if (signedAt > now.getTime() + 5 * 60e3) reasons.push('signed_in_future');
    // a retired key still verifies what it signed before it was retired
    if (Number.isFinite(retired) && signedAt >= retired) reasons.push('key_retired');
  }
  try {
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.public_key }, format: 'jwk' });
    if (!edVerify(null, payloadOf(sig), pub, Buffer.from(sig.signature, 'base64url'))) reasons.push('bad_signature');
  } catch { reasons.push('bad_signature'); }
  // integrity: the signature matches this document and key; valid: integrity and the time and key rules together
  const integrity = !reasons.some((r) => ['bad_signature', 'digest_mismatch', 'source_mismatch', 'revision_mismatch', 'algorithm'].includes(r));
  return { valid: reasons.length === 0, integrity, reasons: [...new Set(reasons)], key };
}
