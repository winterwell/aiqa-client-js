# Publishing to npm

The package is published to the public npm registry as
[`aiqa-client`](https://www.npmjs.com/package/aiqa-client).

## Quick update

```bash
./publish.sh
```

That runs the checks, builds, shows you the tarball contents, and asks before publishing.

## Prerequisites

1. An npm account that is a maintainer of `aiqa-client`, and a login on this machine:

```bash
npm login          # or: npm login --registry https://registry.npmjs.org/
npm whoami         # confirm
```

2. The `aiqa` repo checked out as a sibling of this one, so the `src/common` drift check
   can run. See CLAUDE.md.

3. Confirm you are pointed at the public registry, not an internal mirror:

```bash
npm config get registry     # expect https://registry.npmjs.org/
```

`publishConfig.registry` in package.json pins this for publish regardless, so a
company-wide Artifactory mirror in your global npm config will not misdirect a release.

## Releasing

1. **Bump the version.** Two files, and they must agree:
   - `package.json` -> `"version"`
   - `version.json` -> `"VERSION"` (shared convention with the Python and Go clients;
     keep the three aligned where practical)

2. **Stamp the changelog.** Rename the `## Pending version` heading in `changelog.md` to
   the version being released, and start a fresh `## Pending version` section above it.

3. **Publish:**

```bash
./publish.sh
```

Or by hand:

```bash
npm run sync-types -- --check   # src/common matches the aiqa server repo
npm run typecheck               # includes all of src/common
npm test
npm run build
npm pack --dry-run              # review what will ship
npm publish
```

`prepublishOnly` re-runs the drift check, typecheck and build, so `npm publish` cannot
ship a stale `dist/`.

4. **Tag the release:**

```bash
git tag v$(node -p "require('./package.json').version")
git push --tags
```

## Verifying before you publish

`npm publish` is effectively irreversible - a version number can never be reused, even
after `npm unpublish`. So check the tarball first:

```bash
npm pack --dry-run
```

Expect `dist/` (JS + `.d.ts` + source maps), `README.md`, `LICENSE` and `changelog.md`,
and nothing else. In particular there should be no `src/`, no `test/`, no `.claude/`, and
under `dist/common/types/` only the types the client actually uses - not the whole
vendored server tree. The `files` allowlist in package.json and the entry-point-scoped
`tsconfig.build.json` are what keep that true.

To test it as a consumer would see it:

```bash
npm pack
mkdir /tmp/aiqa-consume && cd /tmp/aiqa-consume && npm init -y
npm install /path/to/aiqa-client-<version>.tgz
node -e "console.log(Object.keys(require('aiqa-client')))"
```

## Automated publishing

For CI, use an npm automation token (they bypass 2FA):

```bash
# npmjs.com -> Access Tokens -> Generate New Token -> Automation
export NODE_AUTH_TOKEN=<token>
echo "//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}" > .npmrc
npm publish
```

Do not commit `.npmrc` with a token in it.

## Troubleshooting

- **`403 Forbidden`** - not logged in, not a maintainer of the package, or the version
  already exists. `npm view aiqa-client versions` lists what is taken.
- **`402 Payment Required`** - npm thinks the package is private. Check
  `publishConfig.access` is `public`.
- **`EOTP`** - 2FA is enabled on the account; supply the one-time password with
  `npm publish --otp=<code>`.
- **Published something broken** - do not try to unpublish, it is restricted and the
  version is burnt either way. Publish a patch, and `npm deprecate
  aiqa-client@<bad-version> "use <good-version>"` to steer people off it.
