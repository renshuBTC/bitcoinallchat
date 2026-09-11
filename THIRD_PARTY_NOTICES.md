# Third-party notices

The application is licensed under the [MIT License](LICENSE). Third-party code
retains its own copyright and license.

| Component | Version | Use | License |
| --- | --- | --- | --- |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | Bundled in `post.js` for offline QR codes | [MIT; Kazuhiko Arase](licenses/qrcode-generator.txt) |
| [esbuild](https://github.com/evanw/esbuild) | 0.28.2 | Development build tool; not shipped to visitors | [MIT; Evan Wallace](https://github.com/evanw/esbuild/blob/main/LICENSE.md) |

The QR generator's notice is also included in the generated `post.js` bundle.
Dependency versions and registry integrity hashes are recorded in
`package-lock.json`.

The page requests Inter, Newsreader and IBM Plex Mono through Google Fonts;
the font files are not vendored in this repository. Blockchain data comes from
mempool.space, the Bitcoin price feed from Binance, and user-requested message
translation opens Google Translate. These services are not included in this
project's MIT license, and their names do not imply endorsement.
