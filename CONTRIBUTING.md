# Contributing

Bug fixes, tests, documentation and translation improvements are welcome.
Discuss changes to transaction formats, wallet support or external services in
an issue before submitting a large implementation.

## Local workflow

Use Node.js 22 or newer and npm. Fork and clone the repository, then run:

```sh
npm ci
npm start
```

The preview is available at http://127.0.0.1:8000/. Pass another port with
`npm start -- 8765`. This server exposes only the site's browser assets.

After editing:

```sh
npm run build
npm run check
npm test
```

Commit regenerated `post.js`, `locales.js` and `index.html` with source changes.
Do not hand-edit the generated bundles. Build tools run locally and use the
locked dependencies; dependency installation does not run lifecycle scripts.
The build also normalizes line endings in pinned JavaScript modules so their
integrity hashes match the files served by the preview and published site.

For UI changes, check desktop and narrow screens, keyboard navigation, long
messages and both left-to-right and right-to-left text. Test failure and
cancellation paths for wallet changes using mocks. Do not use real funds to test
malformed transactions or ask reviewers to share wallet secrets.

## Translations

Edit the relevant `locales/<language>.json` file. English keys are the source text;
translate only their values. Preserve placeholders such as `{wallet}`, `{fee}`,
`{name}` and `{n}`, and leave brand names, protocol identifiers and units intact.
Run `npm run build` and the checks afterward.

When adding or removing interface copy, update every language. A new language
also needs its code in `locales/index.json`, a native display name in
`language-settings.js`, and a supported Google Translate target in `translate.js`.
The build checks that catalogs are complete and placeholders match.

## Pull requests

Describe the concrete problem, resulting behavior and verification. Keep changes
focused; include regression tests for bugs with meaningful failure cases. Explain
changes to fees, transaction bytes, dependencies, network access or local storage.
Do not commit dependency folders, temporary files, credentials or private wallet data.

The GitHub checks verify generated assets and run tests on Node.js 22 and 24,
on Windows and Linux. Dependency updates are reviewed and rebuilt before merging;
passing checks do not replace review of transaction handling.

## Security and license

Use the private reporting channel in [SECURITY.md](SECURITY.md) for vulnerabilities.
Do not disclose an unfixed exploit through a public issue or pull request.

Contributions are provided under the repository's [MIT License](LICENSE).
Retain relevant third-party notices when adding or updating dependencies.
