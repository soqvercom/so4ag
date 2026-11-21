# Contributing to SO4AG

Thank you for reading the format closely enough to have something to say about it.

## What helps most

1. **A case the format cannot express.** Show the fact as a business states it today (a link or a quote) and say
   what is lost when it is written in SO4AG 0.1.
2. **A disagreement between readers.** If your reader and the reference one give different answers for the same
   claim, task and time, open an issue with the three inputs. Either the specification is unclear or one reader is wrong;
   both are worth fixing, and the case goes into the conformance suite.
3. **An error in the specification, schema, profiles or the suite.**
4. **A reader in another language** that passes `spec/conformance/0.1/`. We link it from the README.

## Before you open a pull request

```bash
npm install
npm test
python readers/python/so4ag_reader.py conformance spec/conformance/0.1
```

Both must pass. A change of behaviour needs a case in the conformance suite that fails without it.
Keep pull requests to one topic.

## How the format changes

- **0.1 is a working draft.** It may still change, and every change is listed in the Changelog of the specification
  and in `CHANGELOG.md`.
- **Corrections** (wording, examples, a rule stated more exactly) are made in place and dated.
- **A change that would make a valid 0.1 source invalid, or change the answer a conforming reader gives,**
  is discussed in an issue first and goes to the next version (0.2), not into 0.1.
- **New properties and scope keys** belong to a profile. A profile is versioned on its own (`rental-0.1`).
- **Extensions:** anyone may add fields under their own namespace without asking. A source lists the extensions a reader
  must understand; a reader that does not know one of them does not use the affected claims.
- A reader never reads a document of a version it does not know by the rules of another version.

Proposals are judged by one question: does a reader that follows the rule give a safer answer about whether a fact
may be used?

## Licence of contributions

By contributing you agree that code is licensed under Apache-2.0 and text, schema, profiles and conformance cases
under CC BY 4.0, the same as the rest of the repository.

## Conduct

Be exact and be kind. Criticise the text, not the person.
