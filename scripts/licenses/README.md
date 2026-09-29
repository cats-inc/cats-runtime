# Supplemental bundle license texts

`Apache-2.0.txt` is the unmodified original downloaded from
<https://www.apache.org/licenses/LICENSE-2.0.txt> on 2026-09-29.
SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
Keep its bytes unchanged (LF); the build verifies this hash.

`jpeg-js@0.4.4`'s root LICENSE covers Eugene Ware's BSD notice, but its
`lib/decoder.js` carries notmasteryet's Apache-2.0 notice and `lib/encoder.js`
carries Adobe's BSD notice and Andreas Ritter attribution. The bundle helper
checks the installed source hashes and copies these original headers, plus this
full Apache license. A changed jpeg-js version or source requires renewed review.

For other bundled dependencies, the helper collects root license/notice files.
Dependency upgrades or additions still require review for file-level and nested
licenses; package metadata alone is not a complete license inventory. External
dependencies retain their own original files when redistributed.
