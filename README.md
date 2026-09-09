# Bitcoin AllChat

[bitcoinallchat.com](https://bitcoinallchat.com) — the OP_RETURN outputs of recent
Bitcoin blocks, read as one conversation, and a composer for adding to it.

There is no server, no database, no account and no cookie. The page is a single
HTML file that fetches raw blocks from mempool.space and parses them in your
browser. Nothing is stored anywhere; the chain is the database.

## Reading

`index.html` walks the wire format of each block, pulls the scriptPubKey out of
every output beginning with `OP_RETURN`, joins all of its data pushes, and decides
whether the bytes are a message, a picture, or protocol noise.

- **Multiple pushes are joined.** Anything over 520 bytes has to be split, so a
  reader that takes only the first push truncates long messages.
- **Token data is skipped.** `OP_RETURN OP_13` is a token protocol, not writing.
- **Short messages count.** Two words, an emoji, or bare punctuation like `:(`
  reads as someone talking. A lone alphanumeric token — `MMSS`, `ordi`, `SATFLOW`
  — reads as a protocol marker and stays hidden.
- **Pictures are recognised by magic bytes** and shown only when you click, because
  anyone can pay to put an image in a block.

A quoted reply is a transaction that spends an output of the transaction it
answers, between two different wallets. Wallets spending their own change, and
reposts of identical text, are excluded — otherwise one person posting repeatedly
looks like a conversation with themselves.

## Writing

You type, the page builds an unsigned PSBT with one `OP_RETURN` output carrying
your bytes and change back to the address you are spending from, and your wallet
signs it. The page never sees a key, never holds a coin, and takes nothing. The
only cost is the miner fee.

`post-src.js` builds the transaction: bech32/bech32m and base58check address
decoding, coin selection, PSBT v0 serialisation, extraction of a signed PSBT, and
BBQr for offline signers. It handles `bc1q`, `bc1p` and legacy `1…` addresses.
Nested SegWit (`3…`) is not supported and says so.

Bitcoin Core v30 relays up to 100,000 bytes of `OP_RETURN` data by default; older
nodes stop at 83, which is where the composer starts showing a byte count.

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

## Credit

Data from [mempool.space](https://mempool.space). Built by
[@RenshuBTC](https://x.com/RenshuBTC). MIT licensed.
