#!/usr/bin/env bash

if [ -d "./node_modules/@bxjs/base" ]; then
    # 在正式应用项目中
    source ./node_modules/@bxjs/base/cmd.sh
else
    echo "只允许在应用工程代码中执行本地调试脚本"
    exit
fi

# 本地开发调试app工程
cmd_stop
if [ "$1" == "x" ]; then
    exit 0;
fi
# 删除应用app目录下的所有js文件必须强制使用ts强类型编程
find ./app -name '*.js' -type f -print -exec rm -rf {} \;
rm -rf .tscache
# 动态生成应用层的入口避免ts-node不支持node_modules中的文件加载执行问题
echo "import '@bxjs/base/framework/test'" > ./test.ts
./node_modules/nodemon/bin/nodemon.js --exec "./node_modules/ts-node/dist/bin.js --cache-directory .tscache --project ./tsconfig.json" ./test.ts $1 --ignore dist/ --ignore test/ --ignore resources/ &
