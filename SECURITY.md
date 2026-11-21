# Security

## Reporting a vulnerability

Write to **info@soqver.com** with the subject "Security". Please do not open a public issue for a vulnerability
before it is fixed. Include what you did, what happened and what you expected. You will get a reply within
five working days.

In scope:

- the reference validator and readers in this repository (for example an input that makes a reader accept an expired,
  disputed or wrongly scoped claim, a digest or signature check that can be bypassed, a crash or excessive resource
  use on a crafted source);
- the specification itself, when following it exactly leads a reader to an unsafe answer;
- the hosted endpoints at soqver.com (`/mcp`, `/api/v1/`).

## Notes for implementers

- A source is data from the network. Limit its size, never execute anything from it, and treat text values as
  untrusted when you pass them to a language model.
- A valid source proves structure only. A signature proves origin and integrity. Who is trusted to attest a claim
  is the decision of the consumer; a reader with no trust policy must not treat any attestation as a review.
- Fetch sources over HTTPS only and do not follow redirects to private address ranges.
