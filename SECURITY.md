# Security

## What there is to attack

The site is a static browser application. It does not operate a wallet backend
or request private keys. Its main trust boundaries are public blockchain/API
data, transaction preparation, wallet responses, and the files served to visitors.

## What the page does about it

**Everything on screen is hostile input.** The messages are bytes strangers paid
to put on a public chain. They are escaped before rendering, a
Content-Security-Policy with `default-src 'none'` caps what any of it could reach,
`connect-src` allows mempool.space and the configured public price feeds. The
inline application script is pinned by a CSP hash, and injected inline event
handlers are not allowed. Block and transaction parsers enforce size and length
bounds. Images are opened only on request, after byte, dimension and animation
checks; unsupported previews link to the original transaction.

**Transactions are checked before signing and broadcasting.** Selected funding
transactions are fetched and their IDs, amounts and address scripts are checked.
The prepared transaction must use those inputs, the original message bytes, and
change to the same address. Signed results must retain the prepared version,
inputs, sequences, outputs and locktime. Supported signatures must commit to all
outputs. The app broadcasts only after these checks; it does not independently
verify signatures or replace Bitcoin's validation rules. Transaction IDs are
validated before display.

**The builder is pinned.** `post.js` loads with a Subresource Integrity hash. If
that file is altered anywhere between the repository and your browser, it does not
execute.

**Wallet selection is temporary.** It stays in memory for the open page and is not
restored on reload. The page disconnects only a wallet explicitly selected here;
it does not disconnect every installed wallet on startup. Up to 1,000 public IDs
of successfully sent transactions are stored locally for message colours. These
labels are display preferences, not proof of authorship. Message drafts, wallet
addresses and private keys are not saved by the app.

**Connection and spending are separate.** Connecting requests an account from the
wallet. Publishing requires a signed Bitcoin transaction. Review the outputs and
fee in the wallet before approving.

## What it does not protect against

- **`index.html` being replaced.** If the repository, the GitHub account or the
  domain is taken over, the attacker controls the check as well as the builder.
  Nothing in the page can defend against that. Your wallet's own confirmation
  screen, which shows the real outputs, is the last line — read it.
- **Lookalike domains.** Same answer: read the outputs before approving.
- **Wallet extensions themselves**, and anything already running in your browser.
- **An incorrect API view of the chain or unspent status.** This page is not a full
  node and does not independently validate proof of work, the complete chain, or
  recommended fee rates. A displayed fee check is not a guarantee of a fair fee.
- **Whatever you choose to publish.** Data in an `OP_RETURN` is permanent and
  public once confirmed. The application cannot edit or delete confirmed posts.

## Reporting

Open an issue, or reach [@RenshuBTC](https://x.com/RenshuBTC). Please do not put
details of an unfixed flaw in a public issue.
