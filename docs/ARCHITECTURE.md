# Architecture

## Static application

`index.html` contains the page, styles and main application. It fetches raw Bitcoin
blocks from mempool.space, parses transaction outputs in the browser and renders
recognized content. Parsing has size/count bounds, and network reads have deadlines.
The latest scan starts with a target of 100 conversation messages; scrolling
exposes additional history without rendering every loaded record at once.

Conversation renders at most 1,000 messages at a time; Everything renders at most
2,000 records. Scroll up for older records and down to revisit newer loaded ones.
Overlapping windows preserve the visible record's position while keeping the DOM
bounded. Quotes and search results can reveal an exact output outside the current
window. Search displays up to 80 results, newest first, with scrolling in either
direction. Displayed dates and times come from block timestamps, not a separate
message creation time.

Opening search fetches the first Liquid whitehat message, transaction
`c103de95817b43f2df635ec6f35ff126ca26a7c6d20570c4b01866b2b3e69a19`, output 0,
in block 965,818. A bounded, paged address lookup finds related messages quickly.
These isolated matches do not count as complete-block coverage, and receiving a
transaction at that address does not prove who authored it.

After a short typing pause, a nonempty search query starts one scan of up to 60
additional blocks, down to block 965,818. Scrolling down at the oldest loaded
result can start another bounded scan. Merely rendering results never starts a
continuation. Changing the query, closing search or leaving the page cancels
pending work; loaded records remain available for the page session.
Only conversational records are retained in a separate archive with a conservative
32 MiB accounting limit. Reaching that limit stops further historical loading for
the current page session without discarding loaded results. Full block scanning can
transfer substantial data. Complete-block coverage is tracked separately from
discovered messages; an empty result list refers only to loaded messages.
Reorganizations invalidate
cached history and reply lookups.

OP_RETURN data pushes are joined before classification. Text is decoded as UTF-8
and supports multilingual scripts and emoji. Known protocol markers remain in the
Everything view. Classification is heuristic and does not establish authorship.
Raw payloads and API values must be treated as untrusted data.

## Replies

The composer stores an exact reference to the selected message in the OP_RETURN
payload using the application's existing format:

```text
BAC1:reply:<64-character transaction ID>:<output index>\n<original payload bytes>
```

Here `\n` means one LF byte. The composer body is UTF-8 text. The reader
strips one validated header before classifying the body; malformed or unsupported
headers remain ordinary data. The reference adds bytes to the transaction and is
included in the independent byte-for-byte checks before signing and broadcasting.

This is an application-level reference recorded on Bitcoin, not a special Bitcoin
transaction type. It does not require spending from or paying the original poster.
Missing quoted content can be fetched from the exact transaction and output.
References and inferred spend links do not prove a person's identity or intent.
Ambiguous spend-based matches are not assigned an arbitrary parent.

The Liquid showcase is an editorial selection of historical messages. Its times
come from block confirmations, and its displayed order is not evidence of a reply
relationship. Signature verification must be performed separately; a PGP marker
alone is not an authenticity check.

## Preparing and publishing

`post-src.js` creates an unsigned PSBT with one zero-value OP_RETURN and, when
applicable, change back to the funding address. The wallet or an offline signer
signs it. The application does not request private keys or charge a service fee.

Offline signing accepts supported signed PSBT/transaction encodings and BBQr
frames in hex, Base32, or compressed Base32. Compressed decoding requires the
browser's native decompression support and has size, time and cancellation limits;
an unsupported browser displays an error instead of downloading another decoder.

Supported spending addresses are native SegWit P2WPKH (`bc1q`, 20-byte program),
Taproot P2TR (`bc1p`, 32-byte program), and legacy P2PKH (`1…`). Nested SegWit
(`3…`) and P2WSH are not supported. Wallet connections are temporary and are not
restored after reload. Connecting without a draft does not initiate signing.

Signing choices start hidden and appear after Enter or Send with a nonempty,
valid-sized draft. Sending uses the active installed wallet, otherwise the first
detected provider (Xverse before UniSat), and asks for account permission before
loading transaction-building resources. If no wallet is installed, it reveals
the download links and offline choice. Cancellation never tries another wallet.

Independent code in `index.html` verifies funding transaction IDs and scripts,
selected amounts, the prepared outputs, message bytes and fees. The wallet returns
signed data without broadcasting. That data must still match the prepared
transaction before submission. The returned transaction ID must match the locally
computed ID. See [Security](../SECURITY.md) for the trust boundaries and limitations.
An uncertain broadcast response is not automatically retried.

Message text and its reply reference have a 100,000-byte limit, and completed
transactions must fit the standard transaction weight limit. Script overhead and
input signatures reduce the available message capacity. Relay policy varies
between nodes, so accepting a draft is not a promise that the network will relay
or mine it.

## Languages and storage

`locales/*.json` contains editable translations; `locales.js` is generated for the
browser. The globe menu applies a language immediately. Interface translation
changes text and labels without changing drafts, original messages, addresses,
amounts or transaction IDs.

The message Translate action opens a fixed Google Translate URL in a new tab with
the selected text and target language. The source language is detected by Google.
The link has no opener reference and sends no referrer. Opening it shares the text
with Google and may record it in browser history. No message translation is
requested automatically and no browser translation model is used. Messages over
5,000 characters or an encoded URL over 8,000 characters must be copied manually;
they are not silently shortened.

Local storage contains only the selected interface language and up to 1,000 public
transaction IDs successfully sent from that browser. The IDs power the green
**You** marker, which is a display preference, not proof of authorship.

## External services and delivery

- mempool.space: blocks, transactions, unspent outputs, fee estimates and explorer links.
- Binance public market-data endpoints: BTC/USDT price and a reconnecting price stream.
- Google Fonts: Inter, Newsreader and IBM Plex Mono.
- Google Translate: only after a user opens a message's Translate link.
- Xverse and UniSat: wallet providers and official extension download pages.

The page uses a restrictive Content Security Policy and integrity pins for its
JavaScript modules and generated transaction bundle. These protect against some
injection and altered-asset scenarios, but cannot protect an entry page replaced
by an attacker controlling the hosting account or domain.

GitHub Pages serves the committed static assets. Rebuilding requires the locked
development dependencies; normal visitors do not load build tools or locale source
files. `npm run check` independently rebuilds in memory and detects stale generated
assets or integrity hashes. Automated tests do not broadcast transactions.
