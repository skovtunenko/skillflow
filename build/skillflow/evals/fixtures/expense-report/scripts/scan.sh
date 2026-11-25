#!/usr/bin/env bash
# Prints one line per receipt of the month: file, date, amount, currency.
set -euo pipefail

folder="$1" month="$2"
found=0
for receipt in "$folder"/*"$month"*.txt; do
  [[ -f "$receipt" ]] || continue
  found=1
  date=$(sed -n 's/^date: //p' "$receipt")
  amount=$(sed -n 's/^amount: //p' "$receipt")
  currency=$(sed -n 's/^currency: //p' "$receipt")
  printf '%s\t%s\t%s\t%s\n' "$(basename "$receipt")" "$date" "$amount" "$currency"
done

if ((found == 0)); then
  echo "error: no receipts for $month in $folder" >&2
  exit 1
fi
