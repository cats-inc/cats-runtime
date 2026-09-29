# Dashboard dependencies

These exact upstream bytes are bundled for offline use, avoiding runtime CDN access.
`manifest.json` records SHA-384 for every asset and its original license text.

- marked 15.0.7: MIT; retained from the dashboard's previous pin.
- DOMPurify 3.4.16: Apache-2.0 OR MPL-2.0; use under Apache-2.0, full upstream
  license retained. [Upstream](https://github.com/cure53/DOMPurify) publishes the
  supported sanitizer version; both pages now share it.
- highlight.js 11.11.1 and github-dark CSS: BSD-3-Clause; both pages share the
  dashboard's previous version.

To update, download the exact versioned URLs, keep the upstream bytes and LICENSE
files, compute SHA-384, and update the manifest, both source HTML pages and the
explicit `/vendor/` route list together. Never accept an unversioned URL or suppress
an integrity failure. Run `node scripts/verify-dashboard-vendor.mjs --upstream`,
`npm run build:ui`, and the dashboard vendor/UI tests. Commit the regenerated HTML.
The normal UI build and tests are offline and fail when local bytes drift; upstream
verification is explicit so a CDN outage does not prevent an offline build.
