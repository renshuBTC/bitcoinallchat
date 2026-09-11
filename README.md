# Bitcoin AllChat

[bitcoinallchat.com](https://bitcoinallchat.com) — the OP_RETURN outputs of recent
Bitcoin blocks, read as one conversation, and a composer for adding to it.

There is no application backend or user account. The static page fetches raw
blocks from mempool.space and parses them in your browser. Published data is on
Bitcoin. The theme and up to 1,000 transaction IDs marked as yours are saved in
this browser's local storage; message text, wallet addresses and keys are not.

## Reading

`index.html` walks the wire format of each block, pulls the scriptPubKey out of
every output beginning with `OP_RETURN`, joins all of its data pushes, and decides
whether the bytes are a message, a picture, or protocol noise.

- **Multiple pushes are joined.** The composer splits data into pushes of up to
  520 bytes. Reading only the first push would truncate those long messages.
- **Token data is skipped.** `OP_RETURN OP_13` is a token protocol, not writing.
- **Short messages count.** Two words, an emoji, or bare punctuation like `:(`
  reads as someone talking. A lone alphanumeric token — `MMSS`, `ordi`, `SATFLOW`
  — reads as a protocol marker and stays hidden.
- **Pictures are recognised by magic bytes** and shown only when you click, because
  anyone can pay to put an image in a block.

Conversation uses language and payload heuristics; it cannot verify human
authorship. Everything also shows parsed protocol data, up to the latest 2,000
matching entries. Unsupported and skipped outputs are not displayed.

Quoted replies are inferred from transaction spend links. Shared output scripts
and repeated text help filter apparent self-replies; this does not verify who
controls a wallet.

Messages sent successfully from this browser receive a green bubble and a **You**
label. For older posts, use **⋯ → Mark as Mine**. These are local display markers,
not proof of authorship. **Unmark as Mine** removes a marker. Markers do not sync
between browsers and are lost when this site's browser storage is cleared.

## Writing

You type, the page builds an unsigned PSBT with one `OP_RETURN` output carrying
your bytes and change back to the address you are spending from, and your wallet
signs it. The page does not request private keys or charge a service fee. Miner
fees apply. Xverse and UniSat open their official download pages when the selected
extension is unavailable; Offline supports signing on a separate device.

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

Any static server works, and the file has no build step of its own:

    python3 -m http.server 8000

Fonts come from Google Fonts and message data from mempool.space; both are
declared in the Content-Security-Policy and nothing else is allowed to be reached.

## Checks

Run `npm test` (Node.js 20 or newer) for the conversation-classifier, wallet-routing,
offline-dialog, ownership-marker and composer-keyboard tests. They exercise the page's actual functions
with local fixtures; they do not connect a wallet or broadcast a transaction.

## Credit

Data from [mempool.space](https://mempool.space). Built by
[@RenshuBTC](https://x.com/RenshuBTC). MIT licensed.
