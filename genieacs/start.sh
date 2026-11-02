#!/bin/sh
set -eu

genieacs-cwmp &
genieacs-nbi &
genieacs-fs &
exec genieacs-ui
