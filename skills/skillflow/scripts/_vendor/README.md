# Vendored code

`bgotink-kdl/` is the KDL v2 parser `@bgotink/kdl` by Bram Gotink. It holds
the published ES module files that `index.js` imports, copied unchanged, with
no bundler. Node runs them as they are.

- Source: <https://www.npmjs.com/package/@bgotink/kdl>,
  <https://github.com/bgotink/kdl>
- Pin: [bgotink-kdl/PIN.json](bgotink-kdl/PIN.json) holds the version, the
  tarball URL, its `sha512` integrity, the `sha256` of each vendored file,
  and the pinned KDL 2.0.0 test suite with its result.
- License: MIT, [bgotink-kdl/LICENSE.md](bgotink-kdl/LICENSE.md)

## Check and update

The tool is `build/productivity/skillflow/vendor-kdl.mjs` in the source
repository. It uses Node built-in modules only and needs the network. Behind
an HTTP proxy, set `NODE_USE_ENV_PROXY=1`.

1. Run `node build/productivity/skillflow/vendor-kdl.mjs --outdated`. Stop if
   the pinned version is the latest.
2. Read the library's changelog for the new version.
3. Run `node build/productivity/skillflow/vendor-kdl.mjs --update`. It checks
   the tarball against the registry integrity, runs the KDL 2.0.0 test suite
   (at least 318 of 319 cases) and the SkillFlow tests, and replaces
   `bgotink-kdl/` only when both pass. If it fails, keep the pinned version.
4. Run `mise run check` and review the diff of `bgotink-kdl/`.
5. Apply the repository's skill version policy before sharing changed vendored
   files, then commit them and `PIN.json` with any required `metadata.version` raise.

`node build/productivity/skillflow/vendor-kdl.mjs --check` compares every
vendored file byte for byte with the pinned package.
