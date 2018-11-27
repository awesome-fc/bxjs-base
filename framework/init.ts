/// <reference path="../error.d.ts" />
export function get_root_path_prefix() {
    let prefix = '../'
    if (/\/node_modules\/@bxjs\/base(\-dev)?\/framework$/.test(__dirname)) {
        prefix = '../../../../'
    }
    return prefix
}

// 先加载框架层面的错误定义，再加载用户层面的错误定义，支持用户定义错误覆盖框架层面的错误多语言消息定义。
require('../error')
const path = require('path')
try {
    // 正常应用开发中加载方法
    require(path.join(get_root_path_prefix(), './app/error'))
} catch (err) {
    // 在全局控制台命令上加载方法
    require(path.join(process.cwd(), './app/error'))
}


import {get_suffix_ts_or_js} from './base'
import {__framework_session_init__} from './session'

const fs = require('fs')
const view = require('nunjucks')
const _ = require('lodash')
const typeis = require('type-is')
const querystring = require('querystring')

function get_app_entries_path_prefix() {
    return get_root_path_prefix() + 'app/entries'
}

// https://github.com/eqfox/http-body-parser 参照koa的源码正确解析post请求参数
// 兼容application/json和application/x-www-form-urlencoded两种请求类型。
export function parse_post_param(headers, body) {
    try {
        if (!body) {
            return {}
        }
        if (typeis({headers}, ['json'])) {
            return JSON.parse(body.toString(headers['content-encoding'] || 'utf8'))
        } else if (typeof headers['Content-Type'] == 'string' && headers['Content-Type'].match(/application\/json/)) {
            // bugfix API网关的字段类型值的赋值差异与type-is库的字段名称不兼容问题(content-type与Content-Type区别)
            return JSON.parse(body.toString(headers['content-encoding'] || 'utf8'))
        }
        else if (typeis({headers}, ['urlencoded'])) {
            return querystring.parse(body.toString(headers['content-encoding'] || 'utf8'))
        } else if (typeof headers['Content-Type'] == 'string' && headers['Content-Type'] == 'application/x-www-form-urlencoded') {
            // bugfix 线上乐高post请求参数解析不正确问题调试做兼容适配处理 TODO 待查原因为啥typeis库失效了
            // application/x-www-form-urlencoded
            return querystring.parse(body.toString(headers['content-encoding'] ||
                headers['Content-Encoding'] || 'utf8'))
        }
        else {
            xthrow(ERR$PARAM, {headers, body})
        }
    } catch (err) {
        xthrow(err, {headers, body})
    }
}

// 请求前置过滤处理
async function filter_request_begin(api_path: string, param: any) {
    const entry = require(api_path).default
    xassert(entry)
    const obj = new entry()
    if (obj._) {
        // 强制执行请求参数验证逻辑
        xassert(_.isFunction(obj._))
        await obj._(param)
    }
    // 对于MOCK还是正式请求路由的调用判断处理
    let api_callback = obj.$$
    if ('__mock__' in param) {
        api_callback = obj.$ ? obj.$ : undefined
    } else {
        // 正式请求前置处理：auth鉴权、等等操作统一框架代码实现
        if (obj.context) {
            xassert(_.isFunction(obj.context))
            const context = obj.context()
            xassert(_.isPlainObject(context.param) && _.isFunction(context.auth))
            await context.auth()
        }
    }
    return api_callback
}

// web页面的请求支持get或post，get仅仅用于页面跳转，自动兼容get和post用于表单递交以及web端的接口数据的返回处理（测试场景下支持get线上环境只支持post协议）。
async function web_request_process(api: string, param: any) {
    let prefix = get_app_entries_path_prefix()
    let api_path = `${prefix}/web/${api}`
    let out: any = undefined
    let is_html_request: boolean =
        fs.existsSync(path.resolve(__dirname, `${prefix}/web/${api}.html`))

    try {
        let api_callback = await filter_request_begin(api_path, param)
        xassert(_.isFunction(api_callback))
        out = await api_callback(param) // 回调API对应的业务逻辑实现
        if (is_html_request) {
            // 仅在web请求html页面的时候如果检测到302跳转的时候忽略模板渲染直接返回
            if (global['__redirect_url__'] !== undefined) {
                return
            }
            // 将out转换到对应的html试图绑定之后再输出
            view.configure(path.resolve(__dirname, `${prefix}/web`), {noCache: true, autoescape: false})
            out = view.render(`./${api}.html`, out)
            return out
        } else {
            // 对于web页面的关联ajax接口进行规范rest接口数据格式的统一处理
            return {
                success: true,
                content: out,
                errorLevel: undefined,
                errorCode: undefined,
                errorMsg: undefined,
            }
        }
    } catch (err) {
        // 业务错误报警处理 TODO 需要考虑错误忽略问题
        await xwarn(err, api, param)

        if (is_html_request) {
            // 只对业务逻辑错误处理区分框架错误还是业务错误（业务错误error页面显示，框架错误http错误状态码）FIXME 需要改进掉
            xassert(fs.existsSync(path.resolve(__dirname, `${prefix}/web/error.` + get_suffix_ts_or_js())) &&
                fs.existsSync(path.resolve(__dirname, `${prefix}/web/error.html`)))
            let api_callback = require(`${prefix}/web/error.` + get_suffix_ts_or_js()).default
            xassert(_.isFunction(api_callback))
            out = await api_callback(err)
            view.configure(path.resolve(__dirname, `${prefix}/web`), {noCache: true, autoescape: false})
            out = view.render(`./error.html`, out)
            return out
        } else {
            let data = xerror(err)
            return {
                success: false,
                content: data.param,
                errorLevel: 'error',
                errorCode: data.code,
                errorMsg: data.msg,
            }
        }
    }
}

// rest api接口自动兼容get或post请求处理协议（测试场景下支持get线上环境只支持post协议）
async function rest_request_process(api: string, param: any) {
    try {
        let prefix = get_app_entries_path_prefix()
        let api_path = `${prefix}/rest/${api}`
        let api_callback = await filter_request_begin(api_path, param)
        xassert(_.isFunction(api_callback))
        let out = await api_callback(param) // 回调API对应的业务逻辑实现
        return {
            success: true,
            content: out,
            errorLevel: undefined,
            errorCode: undefined,
            errorMsg: undefined,
        }
    } catch (err) {
        await xwarn(err, api, param)
        let data = xerror(err)
        return {
            success: false,
            content: data.param,
            errorLevel: 'error',
            errorCode: data.code,
            errorMsg: data.msg,
        }
    }

}

// 返回格式是HTML还是JSON取决于API路径对应的ts文件是否存在同名的html模板文件，如果存在则返回HTML否则全部返回JSON数据。
// 约定规范：POST请求都是restful的API接口（根据web和rest的路径进行具体区分），GET请求对应的路径有HTML就是WEB请求否则就是JSON请求。
// 通过约定简化路由的定义。
export async function request_process(api: string, param: any) {
    await __framework_session_init__()
    // 根据API的前缀命名规范自动识别应用类型是纯rest项目还是纯web项目进行对应的处理逻辑
    if (/^\/web\//.test(api)) {
        return await web_request_process(api.replace(/^\/web\//, ''), param)
    } else if (/^\/rest\//.test(api)) {
        let out = await rest_request_process(api.replace(/^\/rest\//, ''), param)
        global['__redirect_url__'] = undefined
        return out
    } else {
        // TODO 正确优化界面提示返回HTTPS状态码错误！！！！过滤无效URL定义。
        xthrow(ERR$PARAM, [api, param])
    }
}

// ajax返回成功结构说明
// {
//     success: true,
//     content: 返回内容，{}/[]
// }
// ajax返回失败结构说明
// {
//     success: false,
//     errorLevel:['info’, 'warn’, 'error’, 'fault’],
//     errorCode:错误码,
//     errorMsg:错误信息说明
// }