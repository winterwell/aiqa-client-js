#!/usr/bin/env bash
# Publish aiqa-client to npm. See how-to-publish.md.
# Assumes setup has been done: npm login, and the aiqa repo checked out as a sibling.
set -euo pipefail

cd "$(dirname "$0")"

PKG_VERSION=$(node -p "require('./package.json').version")
VERSION_JSON=$(node -p "require('./version.json').VERSION")

echo "Publishing aiqa-client $PKG_VERSION"

if [ "$PKG_VERSION" != "$VERSION_JSON" ]; then
	echo "ERROR: version mismatch - package.json says $PKG_VERSION, version.json says $VERSION_JSON"
	echo "Bump both, then retry."
	exit 1
fi

if grep -q '^## Pending version' changelog.md; then
	echo "WARNING: changelog.md still has a '## Pending version' section."
	echo "Stamp it with $PKG_VERSION before releasing."
fi

echo "Logged in to npm as: $(npm whoami)"

if npm view "aiqa-client@$PKG_VERSION" version >/dev/null 2>&1; then
	echo "ERROR: aiqa-client@$PKG_VERSION is already published. Version numbers cannot be reused."
	exit 1
fi

echo "Checking src/common against the canonical source in aiqa/server/src/common"
npm run sync-types -- --check

echo "Typechecking"
npm run typecheck

echo "Running tests"
npm test

echo "Building"
npm run build

echo
echo "Tarball contents:"
npm pack --dry-run

echo
read -r -p "Publish aiqa-client $PKG_VERSION to npm? [y/N] " reply
if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
	echo "Aborted. Nothing published."
	exit 1
fi

npm publish

echo "Published aiqa-client $PKG_VERSION"
echo "Now tag it:  git tag v$PKG_VERSION && git push --tags"
