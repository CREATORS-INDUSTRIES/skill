#!/usr/bin/env bash
# Stands in for a real deploy: prints the call it was given and exits clean.
# The point of the example is that this file SHIPS WITH THE SKILL -- the
# frontmatter declares `includes: scripts`, so the tool has something to run
# wherever the skill ends up.
set -euo pipefail
echo "deploy.sh $*"
