#!/usr/bin/env bash
#MISE description="Build the SkillFlow website into _site/"

set -euo pipefail

# _site/ is generated and gitignored; a fresh build leaves no stale pages.
rm -rf _site
node site/build.mjs --skill skills/skillflow --license LICENSE --out _site
