#!/usr/bin/env bash

if [ -d "./node_modules/@bxjs/base" ]; then
    # 在正式应用项目中
    source ./node_modules/@bxjs/base/cmd.sh
else
    # 在bxjs本地git仓库中调试发布代码
    source ./cmd.sh
fi
cmd_stop

ROOT=$PWD
rm -rf $ROOT/dist
mkdir -p $ROOT/dist/target
cd $ROOT
./node_modules/.bin/ts-node ./cmd.upgrade_package_patch_version.ts # 更新package.json中的version将patch版本号自动加1处理
VERSION=`head -1 $ROOT/__version__`
echo "release version is $VERSION"
git add --all
git commit -m "release $VERSION" .  # 发布前自动递交GIT所有修改的内容方便版本追踪定位
git push

# 编译当前工程
./cmd_make.sh

# 发布@bxjs/base包
cp -rvf framework *.d.ts *.ts *.js *.sh package.json package-lock.json tsconfig.json LICENSE $ROOT/dist/target
cd $ROOT/dist/target
npm publish --registry=https://registry.npmjs.org

# 删除发布生成的中间文件避免IDE和GIT影响
rm -rf `find $ROOT/framework -name \*.js | xargs`
rm -rf $ROOT/*.js
rm -rf $ROOT/dist

echo -e "\033[32m Publish @bxjs/bxjs-cli Successfully! \033[0m"
