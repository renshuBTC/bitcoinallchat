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
bounds. The interface displays text; arbitrary payload bytes are not decoded as
images or embedded media.

**Transactions are checked before signing and broadcasting.** Selected funding
transactions are fetched and their IDs, amounts and address scripts are checked.
The prepared transaction must use those inputs, the original message bytes, and
change to the same address. Signed results must retain the prepared version,
inputs, sequences, outputs and locktime. Supported signatures must commit to all
outputs. The app broadcasts only after these checks; it does not independently
verify signatures or replace Bitcoin's validation rules. Transaction IDs are
validated before display and must match the locally computed transaction ID.
Broadcast submissions are not automatically retried after an uncertain response.
Wallet connections are checked for Bitcoin mainnet, and network reads and offline
decompression have explicit size and time limits.

**The builder is pinned.** `post.js` loads with a Subresource Integrity hash. If
that file is altered anywhere between the repository and your browser, it does not
execute.

**Wallet selection is temporary.** It stays in memory for the open page and is not
restored on reload. The page disconnects only a wallet explicitly selected here;
it does not disconnect every installed wallet on startup. Up to 1,000 public IDs
of successfully sent transactions are stored locally for message colours. These
labels are display preferences, not proof of authorship. Message drafts, wallet
addresses and private keys are not saved by the app.

**Interface translations are bundled.** The local dictionaries and translation
modules are integrity-pinned. They insert text and attributes, never HTML, and
exclude original message bodies, drafts, transaction bytes, addresses and amounts.
Only the chosen language code is stored. No browser translation models are used.

**Message translation requires a click.** The Translate link opens a fixed
`https://translate.google.com/` destination in a new tab with the selected
message encoded as a URL parameter. It uses `noopener noreferrer` and does not
send a referrer. Google receives the selected text when that link is opened.
Message and URL lengths are bounded; oversized messages are not truncated or
automatically submitted. Translations never alter the original on-chain data.

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

## Supported version

Security fixes target the current `main` branch and the published site. Older
commits are not maintained as separate releases.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/renshuBTC/bitcoinallchat/security/advisories/new)
for suspected vulnerabilities. Include affected behavior, reproduction steps,
browser/version, and the relevant commit or public transaction ID when applicable.
Use synthetic data and local fixtures where possible.

Do not publish an unfixed exploit in a public issue, and never send private keys,
seed phrases, wallet credentials or private transactions. Ordinary bugs and
feature suggestions can use public GitHub issues.

## Development checks

The repository locks dependencies and disables dependency lifecycle scripts during
installation. `npm run check` rebuilds generated assets in memory and checks all
browser integrity pins. Regression tests cover hostile chain data, wallet and
offline-signing responses, cancellation, UI state and external translation links.
GitHub runs these checks on supported Node.js versions and offers private reports,
dependency alerts and automated code scanning. Passing checks cannot establish that
the application has no vulnerabilities.
