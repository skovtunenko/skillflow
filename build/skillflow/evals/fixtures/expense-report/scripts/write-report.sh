#!/usr/bin/env bash
# Writes report.md in the receipts folder from the approved table on standard input.
set -euo pipefail

folder="$1"
{
  echo "# Expense report"
  echo
  cat
} >"$folder/report.md"
