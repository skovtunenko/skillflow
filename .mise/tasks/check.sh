#!/usr/bin/env bash
#MISE description="Run the SkillFlow tests"

set -euo pipefail

# Browser tests skip without Chrome, unless CI or SKILLFLOW_BROWSER=required makes Chrome mandatory.
node --test "build/**/skillflow/tests/*.test.mjs"
