#!/usr/bin/env bash
# Stands in for posting a release note somewhere.
#
# The point of this one in the example is its second argument: a whole note,
# newlines and all, arriving as ONE argv word. Nothing is quoted in the run
# template and nothing is stripped here -- what the model passed is what this
# script receives.
set -euo pipefail
echo "version: $1"
echo "note follows, $(printf "%s" "$2" | wc -l | tr -d " ") newline(s):"
printf "%s\n" "$2"
