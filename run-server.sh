#!/bin/bash
# Wrapper script for launchd. Sets up PATH so it can find node/npm.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")"
exec npm run server
