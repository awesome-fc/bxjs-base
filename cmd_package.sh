#!/usr/bin/env bash

if [ -d "./node_modules/@bxjs/base" ]; then
    # 在正式应用项目中
    source ./node_modules/@bxjs/base/cmd.sh
else
    # 在bxjs本地git仓库中调试发布代码
    echo 'ERROR！请在项目根目录下执行命令！'
    exit -1
fi

# 对当前工程编译打包发布到FC上
ROOT=$PWD
cd $ROOT
rm -rf $ROOT/dist
mkdir -p $ROOT/dist/target
./node_modules/typescript/bin/tsc
if [ $? != 0 ]; then
    echo 'make error'
    exit
fi

# 拷贝需要发布的文件
cp -rvf app package.json package-lock.json tsconfig.json $ROOT/dist/target
cp -rvf ./node_modules/@bxjs/base/global.d.ts $ROOT/dist/target

cd $ROOT/dist/target
npm install --production

#优化前的代码尺寸
#added 489 packages in 6.738s
#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  13981738 Jul 20 12:30 dist/target.zip

#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  13979020 Jul 20 12:40 dist/target.zip

# 裁剪掉2MB的代码尺寸
#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  11631050 Jul 20 12:57 dist/target.zip

#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  10683123 Jul 20 13:19 dist/target.zip

#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff   9738975 Jul 20 13:39 dist/target.zip

# 找到一个低级库存放了一堆的fonts与后端项目无关的字库（一个大头的库被裁掉了）
#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  7462289 Jul 20 14:11 dist/target.zip

# 降低到代码尺寸极限大小大约裁掉50%代码尺寸大小
#➜  toufang-system-web git:(develop) ✗ ls -l dist/target.zip
#-rw-r--r--  1 chujinghui  staff  7033798 Jul 20 14:56 dist/target.zip

# 删除发布版本中多余的文件减小代码尺寸（减少代码尺寸同时隐藏ts的源代码）
rm -rf `find $ROOT/dist -name package\-lock.json | xargs`
#rm -rf `find $ROOT/dist -name package.json | xargs`
rm -rf `find $ROOT/dist -name tsconfig.json | xargs`
rm -rf `find $ROOT/dist -name bin | xargs`
rm -rf `find $ROOT/dist -name .bin | xargs`
rm -rf `find $ROOT/dist -name \*.ts | xargs`
rm -rf `find $ROOT/dist -name \*.md | xargs`
rm -rf `find $ROOT/dist -name \*.markdown | xargs`
rm -rf `find $ROOT/dist -name \*LICENSE\* | xargs`
rm -rf `find $ROOT/dist -name \*license\* | xargs`
rm -rf `find $ROOT/dist -name \*CopyrightNotice\* | xargs`
rm -rf `find $ROOT/dist -name .npmignore | xargs`
rm -rf `find $ROOT/dist -name .travis.yml | xargs`
rm -rf `find $ROOT/dist -name .jshintrc | xargs`
rm -rf `find $ROOT/dist -name .editorconfig | xargs`
rm -rf `find $ROOT/dist -name .gitattributes | xargs`
rm -rf `find $ROOT/dist -name .eslintrc | xargs`
rm -rf `find $ROOT/dist -name .coveralls.yml | xargs`
rm -rf `find $ROOT/dist -name AUTHORS | xargs`
#rm -rf `find $ROOT/dist/target/node_modules -name src | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name doc | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name docs | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name fonts | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name test | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name tests | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name example | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name examples | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name benchmark | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*samples\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name @types | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name demo | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name typings | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name Makefile | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.debug.js | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.min.js | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name locales | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name completion.sh* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name appveyor.yml | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name codecov.yml | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name bower.json | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name Gruntfile.js | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name karma.conf.js | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name yarn.lock | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.sh | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*ChangeLog\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*babelrc\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*eslint\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*tslint\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.png\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.webpack.config.js\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.coffee\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.h | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name CHANGELOG | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name .idea | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name .zuul.yml | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*TODO\* | xargs`
rm -rf `find $ROOT/dist/target/node_modules -name \*.patch\* | xargs`
rm -rf $ROOT/dist/target/node_modules/ramda/es
rm -rf $ROOT/dist/target/node_modules/protobufjs/cli
rm -rf $ROOT/dist/target/node_modules/protobufjs/docs
rm -rf $ROOT/dist/target/node_modules/protobufjs/scripts
rm -rf $ROOT/dist/target/node_modules/protobufjs/jsdoc.json
rm -rf $ROOT/dist/target/node_modules/protobufjs/*.png
rm -rf $ROOT/dist/target/node_modules/inversify/amd
rm -rf $ROOT/dist/target/node_modules/inversify/es
rm -rf $ROOT/dist/target/node_modules/inversify/dts
rm -rf $ROOT/dist/target/node_modules/fsevents

# 阿里云公网发布环境下函数计算的入口定义(hack阿里云封装的私有日志机制实现兼容日常和预发express的日志打印格式)
echo "console.setLogLevel('error'); console.log = console.error; exports.handler = require('@bxjs/base/framework/index').handler" > ./index.js
zip -q -9 -r $ROOT/dist/target.zip *

# 删除打包生成的中间文件避免IDE和GIT影响
rm -rf `find $ROOT/app -name \*.js | xargs`
rm -rf `find $ROOT/test -name \*.js | xargs`
cd $ROOT
