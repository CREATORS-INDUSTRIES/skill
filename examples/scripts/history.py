# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Stands in for reading the deploy history of an environment.
#
# The point of this file in the example is the header above it: PEP 723 inline
# metadata, which `uv run --script` reads to build and cache an environment on
# the spot. A skill that needs libraries carries them like this, in the script,
# and never as a setup step someone has to perform before the skill works.

import sys

env = sys.argv[1] if len(sys.argv) > 1 else "staging"
for version, when in [("v1.4.2", "2h ago"), ("v1.4.1", "yesterday")]:
    print(f"{env}  {version}  {when}")
