#!/usr/bin/env bash

if [ -d "./node_modules/@bxjs/base" ]; then
    # 在正式应用项目中
    source ./node_modules/@bxjs/base/cmd.sh
else
    # 在bxjs本地git仓库中调试发布代码
    source ./cmd.sh
fi

cmd_stop
rm -rf ./package-lock.json ./npm-debug.log ./yarn.lock ./yarn-error.log
rm -rf ./node_modules
yarn install
