# Bitcoin AllChat

[Bitcoin AllChat](https://bitcoinallchat.com/) reads text messages from
Bitcoin OP_RETURN outputs and publishes messages using a Bitcoin wallet.

A static browser application: no application server, user accounts, or private-key
collection. Blockchain data is fetched from mempool.space and decoded locally.
Publishing creates a Bitcoin transaction and incurs miner fees.

Write a message and press Enter or Send to begin. An installed wallet opens
directly; signing links and the offline option appear after this first send
attempt and remain available. If no wallet is installed, choose a download link
or an offline signer. Shift+Enter inserts a line break.

## Features

- Read recent messages, scroll up for earlier blocks, search dated results back
  to the first Liquid whitehat message, or inspect parsed protocol data.
- Publish text with Xverse, UniSat, or an offline signer.
- Quote replies with an exact transaction-and-output reference stored on-chain.
- Choose from 39 interface languages using the globe menu. Message translation
  opens Google Translate only when selected from a message's options.
- Dark appearance and a live Bitcoin price quoted in USDT.

Use a burner wallet for safety. Bitcoin AllChat accepts no liability for Bitcoin
losses, theft, or security breaches.

## Run locally

Install [Node.js](https://nodejs.org/) 22 or newer, then:

```sh
git clone https://github.com/renshuBTC/bitcoinallchat.git
cd bitcoinallchat
npm start
```

Open [localhost:8000](http://127.0.0.1:8000/). The committed browser assets are ready
to serve; dependency installation is needed only to rebuild them. Any static
HTTPS host can serve the application.

## Develop and verify

```sh
npm ci
npm run build
npm run check
npm test
```

Dependencies are version-locked, and installation scripts are disabled by
`.npmrc`. The build runs on Windows, macOS and Linux. It rebuilds the transaction
bundle and language catalog, then updates the browser integrity hashes.
`npm run check` fails if committed generated files differ from their sources.
Tests use local fixtures and do not request wallet access or broadcast transactions.

## Project guide

| File or directory | Purpose |
| --- | --- |
| `index.html` | Page, blockchain reader, wallet integration and independent transaction checks |
| `post-src.js`, `entry.js` | Transaction-builder source and bundle entry point |
| `post.js` | Generated transaction and QR-code bundle |
| `locales/` | Editable interface translations |
| `locales.js` | Generated browser language catalog |
| `ui-language.js`, `language-settings.js` | Interface translation and language menu |
| `translate.js` | User-requested Google Translate links |
| `scripts/`, `tests/` | Build, preview and regression checks |

## Behavior and limits

- Messages are public once published. Confirmed posts cannot be edited or deleted
  by this application.
- Reply references use the existing `BAC1` application format. Bitcoin itself has
  no native reply field; payment links alone do not establish reply intent.
- Conversation filtering and inferred older replies use heuristics. Sender labels
  and local **You** markers are not identity verification.
- Search opens with a quick lookup of the Liquid exchange. Typing a query starts
  a limited block scan; scroll down through the results to continue farther back,
  as far as block 965,818. Results cover loaded messages and may be incomplete.
- Up to 1,000 successfully published transaction IDs and the selected interface
  language may be saved locally. Drafts, wallet addresses and private keys are not.
- Text and its reply reference are limited to 100,000 bytes, with stricter limits
  imposed by the completed transaction size and network policy.
- The page is not a full node. It relies on external APIs for chain data, unspent
  status and fee recommendations. Wallet confirmation remains essential.

See [Architecture](docs/ARCHITECTURE.md) for data flow, reply encoding, supported
wallets and external services.

## Contribute and report issues

Read [Contributing](CONTRIBUTING.md) for development and translation changes.
Use [GitHub issues](https://github.com/renshuBTC/bitcoinallchat/issues) for ordinary
bugs and suggestions. Report vulnerabilities privately through the
[security policy](SECURITY.md).

## License and credits

[MIT License](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md).
Blockchain data: [mempool.space](https://mempool.space).
Created by [@RenshuBTC](https://x.com/RenshuBTC).
