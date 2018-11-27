#!/usr/bin/env bash

if [ -d "./node_modules/@bxjs/base" ]; then
    # 在正式应用项目中
    source ./node_modules/@bxjs/base/cmd.sh
else
    # 在bxjs本地git仓库中调试发布代码
    source ./cmd.sh
fi

cmd_stop
./node_modules/typescript/bin/tsc