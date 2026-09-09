# Security

## What there is to attack

No server, no database, no accounts, no funds and no keys are held anywhere. The
site is static files plus your own wallet. So the interesting attacks are not
against the site's data — there is none — but against what the page hands your
wallet to sign, and against the files themselves.

## What the page does about it

**Everything on screen is hostile input.** The messages are bytes strangers paid
to put on a public chain. They are escaped before rendering, a
Content-Security-Policy with `default-src 'none'` caps what any of it could reach,
`connect-src` allows only mempool.space, and images are opened by the reader
rather than shown on arrival.

**The transaction is checked before it is signed.** See the section in the README.
Coins can leave only as miner fee or as change to the address they came from;
anything else stops in the page rather than reaching your wallet.

**The builder is pinned.** `post.js` loads with a Subresource Integrity hash. If
that file is altered anywhere between the repository and your browser, it does not
execute.

**No wallet state is kept.** Nothing is written to storage, the choice of wallet is
not remembered, and `disconnect()` runs when the page opens, after signing, and
when the page closes. A reload never arrives connected.

**Bitcoin has no standing approvals.** There is no allowance to revoke, on
revoke.cash or anywhere else. A connection only lets a page read which address you
are using; every spend needs a signature given at that moment.

## What it does not protect against

- **`index.html` being replaced.** If the repository, the GitHub account or the
  domain is taken over, the attacker controls the check as well as the builder.
  Nothing in the page can defend against that. Your wallet's own confirmation
  screen, which shows the real outputs, is the last line — read it.
- **Lookalike domains.** Same answer: read the outputs before approving.
- **Wallet extensions themselves**, and anything already running in your browser.
- **Whatever you choose to publish.** Data in an `OP_RETURN` is permanent and
  public. There is no delete.

## Reporting

Open an issue, or reach [@RenshuBTC](https://x.com/RenshuBTC). Please do not put
details of an unfixed flaw in a public issue.
