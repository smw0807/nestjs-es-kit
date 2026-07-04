#!/bin/bash

npm run build

npm login --scope=@smw0807 --registry=https://npm.pkg.github.com

npm publish --no-provenance