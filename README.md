# Bitcoin AllChat

[Bitcoin AllChat](https://bitcoinallchat.com/) is a browser app for reading Bitcoin
OP_RETURN messages and images and publishing messages and replies with a Bitcoin wallet.

There is no application backend or user account. The static page fetches raw
blocks from mempool.space and parses them in your browser. Published data is on
Bitcoin. Up to 1,000 successfully sent transaction IDs are saved in this browser's
local storage for message colours; message text, wallet addresses and keys are not.
The site always uses dark mode. An optional display-language code is also saved locally.

## Reading

`index.html` walks the wire format of each block, pulls the scriptPubKey out of
every output beginning with `OP_RETURN`, joins all of its data pushes, and decides
whether the bytes are a message, a picture, or protocol noise.

- **Multiple pushes are joined.** The composer splits data into pushes of up to
  520 bytes. Reading only the first push would truncate those long messages.
- **Token data is skipped.** `OP_RETURN OP_13` is a token protocol, not writing.
- **Unicode messages are supported.** Letters, combining marks, joined scripts,
  scripts written without spaces, and emoji are recognised. Messages and reply
  previews follow their text direction, including Arabic and Hebrew. Repeated
  greetings are treated equally across languages. Known protocol markers such as
  `MMSS`, `ordi`, and `SATFLOW` remain in Everything.
- **Pictures are recognised by magic bytes** and shown only when you click, because
  anyone can pay to put an image in a block.
  Still-image previews are limited to 100 kB, 8,192 pixels per edge and 16 million
  pixels overall. Animated, oversized or unsupported images link to their transaction.

Conversation uses language and payload heuristics; it cannot verify human
authorship. Everything also shows parsed protocol data in pages of up to 2,000
matching entries. **Earlier Payloads** browses loaded history and fetches one
earlier batch at its edge; **Latest Payloads** returns to new arrivals. Unsupported
and skipped outputs are not displayed.

Use **⋯ → Reply** to quote a message above the composer. Cancel removes the reply
selection and keeps the draft. The posted payload includes the original
transaction ID and output index, so readers can resolve the exact message even
when a transaction contains several OP_RETURN outputs. Older quoted replies are
still inferred from spend links, with shared outputs and repeated text used to
filter apparent self-replies. Neither method verifies a person's identity.

Messages sent successfully from this browser receive a green bubble and a **You**
label. These local display markers are not proof of authorship. They synchronize
between tabs, not different browsers, and disappear when site storage is cleared.

## Languages and translation

The globe button beside Search opens **Language** settings. Choose a display
language and apply it to the sidebar, composer, dialogs and visible messages.
The menu offers 39 target languages from the browser's documented translation
list; support for a particular pair depends on the browser and device.

Translation uses the browser's on-device `Translator` and `LanguageDetector`
APIs. Chrome supports these APIs on desktop, not mobile; other browsers may not
provide them. See the [browser documentation](https://developer.chrome.com/docs/ai/translator-api).
The first use can download language resources. **Enable Translation** supplies
another user action when the browser requires it for an additional language pack.
Unavailable or failed translations leave the original text visible.

Translated messages appear below the unchanged original with an **Auto-translated**
label. Only visible text messages are queued, with two concurrent translation
jobs, bounded caches and a 5,000-character limit per message. Large messages use
the currently expanded text; protocol data and attachments are not translated.
Automatic language detection and translation can be inaccurate, especially for
short or mixed-language messages.

The site sends no message text to a translation service and stores no translations.
Choosing **Original (No Translation)** restores English controls and removes
translations. Drafts, signed transaction bytes, wallet addresses, transaction IDs,
amounts and attachment names are kept out of interface translation.

## Writing

You type, the page builds an unsigned PSBT with one `OP_RETURN` output carrying
your bytes and change back to the address you are spending from, and your wallet
signs it. The page does not request private keys or charge a service fee. Miner
fees apply. Xverse and UniSat open their official download pages when the selected
extension is unavailable; Offline supports signing on a separate device.
The signing choices are always visible. Connect Xverse or UniSat before typing,
then press Enter or the send arrow to prepare and sign a message. You can also
type first and choose a wallet. Connections are held only for the current page;
the site does not save wallet addresses or reconnect automatically on reload.

Replies use AllChat's versioned payload format:

    BAC1:reply:<64-character transaction ID>:<output index>\n<original payload bytes>

Here `\n` means one LF byte, not a literal backslash and n. The original body can
be UTF-8 text or a file. The reader strips one validated header before classifying
the body. Unsupported or malformed headers remain ordinary payload data. The
reference bytes count toward size limits and fees, and are included in the
independent transaction check. This is an application format, not a special
Bitcoin transaction type; it does not spend from or pay the original poster.
Missing quoted content can be loaded on demand from its transaction and output.

`post-src.js` builds the transaction: bech32/bech32m and base58check address
decoding, coin selection, PSBT v0 serialisation, extraction of a signed PSBT, and
BBQr for offline signers. It handles `bc1q`, `bc1p` and legacy `1…` addresses.
Nested SegWit (`3…`) is not supported and says so.

The app accepts inputs up to 100,000 bytes, which is not a guarantee that a file
can be relayed or mined. [Bitcoin Core v30](https://bitcoincore.org/en/releases/30.0/)
sets a default aggregate data-carrier script limit of 100,000 bytes; transaction
size limits and script overhead reduce usable payload capacity. Nodes can apply
different policies.

## The check before signing

`index.html` reads the finished transaction back and refuses to hand it to your
wallet unless:

- every input comes from the same script,
- every output is either the one `OP_RETURN`, carrying exactly the bytes you
  typed and no coins, or change back to that same script,
- inputs minus outputs equals the fee it showed you,
- and that fee is not wildly above the rate you chose.

This parser is deliberately separate from `post-src.js` and duplicates the little
it needs, so a swapped builder cannot both write a bad transaction and approve it.

Selected funding transactions are also checked against their IDs, amounts and
address scripts. Wallets return signed data without broadcasting; the app checks
that inputs, outputs, amounts and message bytes still match before submission.
Pasted offline results receive the same comparison. The API supplies current
confirmation/unspent status and fee recommendations; this page is not a full node.

## Verifying what is served

`post.js` is loaded with a Subresource Integrity hash, so an altered builder will
not run. Rebuild it and compare:

    npm install
    sh build.sh

Expected output:

    sha384-Hs8mtIGN+GjUlNluDQhvRgmOKVLd87Vmq/BVEs4KuTsTVB3eZEF9TQfZMSJ1ljJ4

That is the same string as the `integrity` attribute in `index.html`. Pinned
versions (esbuild 0.28.2, qrcode-generator 2.0.4) make the build byte-identical.

`index.html` itself cannot be pinned by the browser — nothing can pin the entry
document. Compare it against this repository, and read the outputs your wallet
shows you before approving anything.

## Running it

After editing JavaScript, run `node scripts/update-csp.cjs` to update the inline
Content-Security-Policy hash and translation-module integrity hashes, then run
`npm test`. The CSP rejects injected inline handlers and scripts that do not match
the application hash.

Any static server works, and the file has no build step of its own:

    python3 -m http.server 8000

Fonts come from Google Fonts and message data from mempool.space. The BTC/USDT
price uses Binance's unauthenticated public market-data REST and WebSocket feeds.
The stream reconnects automatically, with REST fallback and stale-price handling.
These hosts are declared in the Content-Security-Policy.

## Checks

Run `npm test` (Node.js 20 or newer) for the conversation-classifier, wallet-routing,
offline-dialog, reply-payload, price-feed, ownership and composer-keyboard tests.
They exercise the page's actual functions
with local fixtures; they do not connect a wallet or broadcast a transaction.

## Credit

Data from [mempool.space](https://mempool.space). Built by
[@RenshuBTC](https://x.com/RenshuBTC). MIT licensed.
