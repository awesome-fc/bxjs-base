#!/usr/bin/env bash

# 杀掉之前启动的bxjs本地调试进程
cmd_stop(){
    ps -e | grep node | grep ./test.ts | grep .tscache | awk '{print $1}' | xargs kill -9
}
