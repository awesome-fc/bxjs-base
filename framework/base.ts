process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
import 'reflect-metadata'
import {Container} from 'inversify'
import {getConnectionManager, Connection, BaseEntity, getRepository, SelectQueryBuilder} from '@bxjs/typeorm'
import {xsession, xuser, xcache} from './session'
import * as $$ from './plugins'

const path = require('path')
const ErrorStackParser = require('error-stack-parser')
const cookie = require('cookie')
const MobileDetect = require('mobile-detect')
const fetch = require('node-fetch')
const _ = require('lodash')
const moment = require('moment')
const extend = require('extend')
const querystring = require('querystring')
// const parameter = require('parameter')
// const parameterCheckInstance = new parameter({
//     // translate: function () {
//     //     var args = Array.prototype.slice.call(arguments);
//     //     // Assume there have I18n.t method for convert language.
//     //     return I18n.t.apply(I18n, args);
//     // }
// })
const circular_json = require("circular-json")
const mockjs = require('mockjs')
const shortid = require('shortid')
const validatorjs = require('validatorjs')
const cross_spawn = require('cross-spawn')

// FIXME HACK原生方法JSON转换不可逆的BUG（JAVA端传来的富文本字段内容含有\n\t字符串中的字符生成JSON字符串无法正常解析报错）
const raw_stringify = JSON.stringify

function new_stringify(value: any, replacer?: (key: string, value: any) => any,
                       space?: string | number): string {
    let out = raw_stringify(value, replacer, space)
    if (_.isString(out)) {
        out = out.replace(/\\n/g, '\\\\n')
            .replace(/\\t/g, '\\\\t')
            .replace(/\\u/g, '\\\\u') //JAVA端返回的unicode字符转义处理
    }
    return out
}

JSON.stringify = new_stringify as any

// ts-node本地调试需要加载对应的源代码后缀名称
export function get_suffix_ts_or_js() {
    if (global['__env__'] == 'local' && !/^\/code\/node_modules/.test(__dirname)) {
        return 'ts'
    } else {
        return 'js'
    }
}

// 准确定位错误码位置，间接得到函数调用位置地址信息，结合符号报表的正确解析处理完美得到错误定位信息，准确代码调试。
function __get_base_func_caller_source_position(position: number = 3) {
    try {
        throw new Error()
    } catch (err) {
        let out = ErrorStackParser.parse(err)
        let idx = 0
        // 找到第二个TS文件的执行位置
        let find_ts_sufix_file_count = 0
        for (; idx < out.length; idx++) {
            if (/\.ts$/.test(out[idx].fileName)) {
                find_ts_sufix_file_count += 1
            }
            if (find_ts_sufix_file_count == position) {
                break
            }
        }
        if (find_ts_sufix_file_count == position) {
            return '[' + out[idx]['fileName'] + ':' + out[idx]['lineNumber'] + ']'
        } else {
            // TODO 需要定位为什么调用栈无法找到对应的位置出现越界？？
            console.error(err)
            return '#'
        }

    }
}

// 获取异常调用栈用于辅助错误提示定位
export function xstack(err, compact = true) {
    try {
        // TODO 优化裁剪一些无用信息减少日志尺寸更加便于人工分析处理
        let stack = ErrorStackParser.parse(err)
        if (compact) {
            let sources: string[] = []
            for (let v of stack) {
                sources.push(`${v['fileName']}:${v['lineNumber']}`)
            }
            return sources
        }
        return stack
    } catch (err1) {
        let source = __get_base_func_caller_source_position()
        return `invalid error input param (${source})`
    }
}

// // 错误栈的递归嵌套格式显示数据结构定义（param嵌套找到最后一个msg的JSON解析语法错误就是错误链的原始错误发生位置）
// let x = {
//     "code": "UNKNOWN",
//     "msg": "未知错误",
//     "param": {
//         "msg": "您输入的用户名或密码错误，请重新登录 (ErrorCode: 1005, url: https://login.alibaba-inc.com/authorize/login.do)"
//     },
//     "stack": "[\"/Users/chujinghui/Desktop/work/xjs/bxjs/framework/base.ts:110\",\"/Users/chujinghui/Desktop/work/xjs/bxjs/app/entries/web/mobile/meeting-room-visit.ts:161\",\"/Users/chujinghui/Desktop/work/xjs/bxjs/app/entries/web/mobile/meeting-room-visit.js:40\",\"/Users/chujinghui/Desktop/work/xjs/bxjs/app/entries/web/mobile/meeting-room-visit.js:21\",\"/Users/chujinghui/Desktop/work/xjs/bxjs/app/entries/web/mobile/meeting-room-visit.js:13\",\"internal/process/next_tick.js:188\"]",
// }

// 对于异常内容的格式化参数解析处理成为四元组code/msg/param/stack
export function xerror(err, __param?: any) {
    xassert(err instanceof Error)
    try {
        // 标准错误的统一转换处理
        let data: any = JSON.parse(err.message)
        if (data.code && data.msg && ERRORS[data.code]) {
            return data
        }
    } catch (err) {
        // ignore parse error
    }
    // 非标准错误的统一格式转换处理
    let msg = ERRORS[ERR$UNKNOWN]['zh'] // TODO 错误码多语言回传到客户端问题
    let code = ERR$UNKNOWN
    let param: any = {msg: err.message, param: __param} // 用户自定义的错误参数信息 msg为非错误码JSON四元组就是嵌套的终止条件。
    let stack = xstack(err)
    let data = {msg, code, param, stack}
    return data
}

// 用于获取错误栈的root cause根本原因（第一个被拦截的错误发生位置）
export function xroot(err: Error) {
    xassert(err instanceof Error)
    let {msg, param, code, stack} = xerror(err)

    // 递归遍历找到错误链的root cause
    for (; param && param.msg;) {
        try {
            let json: any = JSON.parse(param.msg)
            param = json.param
        } catch (err) {
            msg = param.msg
            code = param.code
            stack = param.stack
            param = param.param
            break
        }
    }
    return {msg, code, param, stack}
}

// TODO 报错处理（显示问题反馈联系人信息）
// 将未处理的错误上抛的异常链记录下来用于精准追踪代码的执行过程（以及准确获取到根节点的错误码）
// 对于promise异步回调的统一出错处理写法实例
// export function login(username: string, password: string) {
//     return new Promise((resolve, reject) => {
//         co(function* () {
//             let user = yield buc.oauthclient.login(username, password)
//             resolve(user)
//         }).catch(async function (err) {
//             xthrow(err, reject)
//         })
//     })
// }
export function xthrow(code: string | Error = ERR$UNKNOWN, param: any = undefined, reject_param: any = undefined) {
    if (code instanceof Error) {
        // promise中进行reject异常处理的抛出错误方法
        let reject: any = _.isFunction(param) ? param : undefined
        if (reject) param = reject_param

        let data: any = {}
        try {
            data = JSON.parse(code.message)
        } catch (err) {
            // ignore
        }
        if (data.code && data.msg && ERRORS[data.code]) {
            // 标准错误直接上抛处理
            if (reject) {
                // promise回调中进行抛错误处理
                let err = new Error(code.message)
                reject(err)
                return
            } else {
                throw new Error(code.message)
            }
        }
        // 将非标准错误转换为标准错误后再上抛处理
        data = xerror(code, param)
        data.code = ERR$UNKNOWN
        data.msg = ERRORS[ERR$UNKNOWN]['zh'] // TODO 错误码的多语言处理转换！！
        data.param = {msg: code.message, param}
        if (reject) {
            // promise回调中进行抛错误处理
            let err = new Error(JSON.stringify(data))
            reject(err)
            return
        } else {
            // 非promise回调中异常传递
            throw new Error(JSON.stringify(data))
        }
    }
    // 对于常量定义错误的统一格式化处理
    let source = __get_base_func_caller_source_position()
    let stack = [source]
    throw new Error(JSON.stringify({code, msg: global['ERRORS'][code]['zh'], param, stack}))
}

export function xassert(expr: any, code: string = ERR$ASSERT, param?: any) {
    let source = __get_base_func_caller_source_position()
    let stack = [source]
    if (!expr) throw new Error(JSON.stringify({code, msg: global['ERRORS'][code]['zh'], param, stack}))
    return expr
}

// // https://github.com/node-modules/parameter 参数验证规则详见此文档（egg团队开发的组件）
// // 注意事项：GET通过URL传递的参数都是字符串类型应该尽量避免GET传递参数，需要多用POST的JSON格式传递参数并且POSTMAN上进行辅助测试正确数据类型映射。
// export function xcheck(param: { [propName: string]: any }, rules: { [propName: string]: any }) {
//     let errors = parameterCheckInstance.validate(rules, param)
//     if (_.isEmpty(errors)) {
//         return true
//     } else {
//         xthrow(ERR$PARAM, errors)
//     }
// }

export function xlog(...args) {
    // 兼容云端以及本地日志调试（解决任意对象的JSON字符串内容的完整输出）
    let source = __get_base_func_caller_source_position()
    let output = circular_json.stringify([...args], null, 4)
    if (global['__env__'] != 'prod' && !/^\/code\/node_modules/.test(__dirname)) {
        // 打印到控制台一份日志
        console.log.apply(undefined, [source + output])
        // 写日志文件到/tmp下临时处理一下 TODO 需要改为类似log4j的本地日志库仅在非线上环境使用方便开发单机日常机器上调试。
        const fs = require('fs')
        fs.appendFileSync('/tmp/bxjs.log', source + output + "\r\n")
    } else {
        // 生产环境下只打印到控制台绑定的SLS日志服务器上，并且需要去除掉换行信息否则打印会不正常。
        output = output.replace(/\r/g, '').replace(/\n/g, '')
        console.log.apply(undefined, [source + output])
    }
}

// // 将详细错误信息及时发送到钉钉群上实时反馈给维护者
// await xwarn({
//     code,
//     // TODO 如何认证通过了获取到用户信息也需要发送过去，方便联系对接人员进行立刻问题处理反馈。
//     message,
//     stack,
//     param,
// })
// 将详细错误信息及时发送到钉钉群上实时反馈给维护者
// 钉钉IM群机器人报警通知
async function xwarn(...args) {
    // 得到xwarn方法被调用的位置
    let source = __get_base_func_caller_source_position()

    // 对于异常参数警告信息进行错误内容标准解析
    if (args.length > 0 && args[0] instanceof Error) {
        args[0] = xerror(args[0])
    }

    let out = [source, moment().format('YYYY-MM-DD HH:mm:ss'), {...args}]

    // 从配置信息中读取报警通知人手机列表和对应的群机器人的webhook的access_token信息
    let access_token = xconfig('framework.warn.dingding.access_token')
    let mobiles = xconfig('framework.warn.dingding.mobiles')
    if (!access_token || !mobiles) {
        access_token = '020a09eac5f2fa320ae851442d5e19e23693c64ad2255c85354b4a49a5a48d35'
        mobiles = ['15381151346']
    }

    await xpost(`https://oapi.dingtalk.com/robot/send?access_token=${access_token}`, {
        msgtype: 'text',
        text: {
            content: out
        },
        at: {
            atMobiles: mobiles,
            isAtAll: false
        }
    })

    // 线上SLS日志上也保存一份
    // console.warn(out)
    xlog(out)
}

// 捕获未监听到的异常记录后直接退出（运行堆栈已经破坏直接记录日志后异常退出即可，由外部监控自动重启）
process.on('uncaughtException', async function (err) {
    xlog(xerror(err))
    await xwarn(err)
    process.exit(-1)
})

// 记录await/async中出现未捕获的异常错误
process.on('unhandledRejection', async (reason, p) => {
    xlog('Unhandled Rejection at: Promise', p, 'reason:', reason);
    // application specific logging, throwing an error, or other logic here
    await xwarn(reason, p)
    process.exit(-1)
})

// async/await的非阻塞异步延迟方法，用于调试阻塞程序的执行进行单步调试的效果。
const sleep = require('sleep-async')()

export function xsleep(ms: number = -1) {
    if (ms <= 0) {
        ms = 50 * 365 * 24 * 3600 * 1000 // 50年最大数视为永久阻塞方便断点单步调试问题
    }
    return new Promise((resolve, reject) => {
        try {
            sleep.sleep(ms, () => {
                resolve()
            })
        } catch (err) {
            xlog(xerror(err))
            resolve()
            // xthrow(err,reject)
        }
    })
}

export async function xpost(url: string, param?: { [propName: string]: any },
                            headers?: { [propName: string]: any }, timeout: number = 3000) {
    // TODO 线上测试不稳定超时暂时忽略掉通过进程最大运行时间去控制超时失败
    timeout = 5000 // -1 不行线上会被阻塞住僵死
    let res: any = null
    let json: any = null
    let text: any = null
    try {
        res = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(param),
            headers: {'Content-Type': 'application/json', ...headers},
            timeout: timeout <= 0 ? 0 : timeout, // 默认3秒超时接口返回避免僵死
        })
        text = await res.text() // 解析出完整的返回内容避免HTML以及非法格式信息便于正确报错定位后端接口错误
        json = JSON.parse(text)
        return json
    } catch (err) {
        xthrow(err, {url, param, headers, text})
    }
}

// 默认超时3000毫秒
export async function xget(url: string, param?: { [propName: string]: any },
                           headers?: { [propName: string]: any }, timeout: number = 3000) {
    // TODO 线上测试不稳定超时暂时忽略掉通过进程最大运行时间去控制超时失败
    timeout = 5000 // -1 不行线上会被阻塞住僵死
    let res: any = null
    let json: any = null
    let text: any = null
    try {
        url = url + (param ? '?' : '') + querystring.stringify(param)
        res = await fetch(url, {
            method: 'GET',
            headers: {'Content-Type': 'application/json', ...headers},
            timeout: timeout <= 0 ? 0 : timeout, // 默认3秒超时接口返回避免僵死
        })
        text = await res.text() // 解析出完整的返回内容避免HTML以及非法格式信息便于正确报错定位后端接口错误
        json = JSON.parse(text)
        return json
    } catch (err) {
        xthrow(err, {url, param, headers, text})
    }
}

// 302临时重定向跳转实现
export function xredirect(url: string, param: any = {}) {
    // TODO 多个程序实例并发处理的时候存在时序问题不能保证全局变量被准确清空。
    // 检查应用重复设置重定向地址未及时return返回控制器问题
    xassert(global['__redirect_url__'] === undefined)
    if (param) {
        xassert(_.isPlainObject(param))
        // 删除param中两个框架预定义参数__url__和__api__不允许进行参数传递（禁止业务逻辑使用避免框架后续升级以及与短网址功能冲突）
        delete param.__api__
        delete param.__url__
        // 补额外的附加参数
        if (/\?/.test(url)) {
            url += '&'
        } else {
            url += '?'
        }
        url += querystring.stringify(param)
    }
    global['__redirect_url__'] = url
}

// 如果只有key参数表示读取属性（缺省值为undefined），如果key为空表示读取所有的请求cookies属性，否则表示响应设置cookies
export function xcookie(key?: string, value?: string, option?: {}): any {
    if (!arguments.length) {
        // 读取所有的请求cookies属性object
        return global['__request_cookies__'] ? global['__request_cookies__'] : {}
    } else if (arguments.length == 1) {
        return key ? xcookie()[key] : undefined
    } else {
        if (global['__respond_cookies__'] === undefined) {
            global['__respond_cookies__'] = {}
        }
        if (key) {
            // COOKIES缺省属性设置（有效时间24小时并且统一关联到根页面上获取COOKIES值）
            option = xassign({path: '/', maxAge: 24 * 3600}, option)
            global['__respond_cookies__'][key] = cookie.serialize(key, value, option)
        }
        return
    }
}

// 判断user-agent请求是否为移动端
function xismobile(): boolean {
    const md = new MobileDetect(global['__user_agent__'])
    return !!md.mobile()
}

function xassign(target, source, ...args) {
    const param = [true, target, source, ...args]
    return extend.apply(null, param)
}

// 查询app/config目录下的应用配置数据
function xconfig(path: string, defaultValue: any = undefined) {
    if (global['__config__']) {
        return _.get(global['__config__'], path, defaultValue)
    }

    const fp = require('path')
    const fs = require('fs')
    // 自动获取app/config的相对路径目录位置得到根路径的位置
    let config_path = ''
    if (__dirname.includes('/node_modules/@bxjs/base/')) {
        // 在应用目录下
        config_path = fp.join(__dirname, '../../../../app/config')
    } else {
        // 在axjs库开发目录下
        config_path = fp.join(__dirname, '../app/config')
    }

    // 自动识别判断运行环境global['__env__']并且加载对应的base数据和env数据
    const config_base_path = config_path + '/config.base.' + get_suffix_ts_or_js()
    const config_env_path = config_path + `/config.${global['__env__']}.` + get_suffix_ts_or_js()
    if (!fs.existsSync(config_base_path)) {
        return defaultValue
    }
    let config_base = require(config_base_path).default
    let config_env = {}
    if (fs.existsSync(config_env_path)) {
        config_env = require(config_env_path).default
    }
    // bugfix Object.assign不支持深度拷贝问题
    // global['__config__'] = Object.assign({}, config_base, config_env)
    // global['__config__'] = _.assign({}, config_env, config_base)
    global['__config__'] = xassign({}, config_base, config_env)
    return _.get(global['__config__'], path, defaultValue)
}

async function xconnect(callback: (connect: Connection) => Promise<any>, config = 'default') {
    return new Promise(async (resolve, reject) => {
        let cfg = {} as any
        try {
            cfg = xassign({}, xconfig('plugins.database.default', {}))
            xassert(!_.isEmpty(cfg), ERR$PARAM, {config})
            // 强制补上约定的实体存放路径定义位置（不允许配置是约定规范）
            if (__dirname.includes('/node_modules/@bxjs/base/')) {
                // 在应用目录下
                cfg['entities'] = [
                    path.join(__dirname, '../../../../app/plugins/database/entity/*.' + get_suffix_ts_or_js())
                ]
            } else {
                // 在axjs库开发目录下
                cfg['entities'] = [
                    path.join(__dirname, '../app/plugins/database/entity/*.' + get_suffix_ts_or_js())
                ]
            }
            // 获取连接池中的链接
            const mng = getConnectionManager()
            const name = cfg.name ? cfg.name : 'default'
            if (!mng.has(name)) {
                mng.create(cfg)
            }
            const db = mng.get(name)
            if (global['__connection__'] === undefined) {
                global['__connection__'] = {}
            }
            if (!db.isConnected) { // TODO 需要进行连接池的管理
                global['__connection__'][name] = db.connect()
            }
            await global['__connection__'][name].then(async connection => {
                xassert(db.isConnected)
                const out = await callback(connection)
                // await db.close() // typeorm没有进行连接池的管理不能进行销毁
                resolve(out)
            }).catch(async err => {
                // await db.close()
                xthrow(err, reject, {cfg})
            })
        } catch (err) {
            xthrow(err, reject, {cfg})
        }
    })
}

// 创建XBaseEntity对象并且自动赋值前端请求的赋值数据
function xnew<T extends BaseEntity>(TYPE: new () => T, param?: any, ...args): T {
    // 泛型实现类似这个功能
    // asset = new AlilangAsset()
    // getRepository(AlilangAsset).merge(asset, param as any)
    // AlilangAsset.merge(asset, param as any)
    // return asset
    let obj = new TYPE()
    if (_.isEmpty(param)) {
        return obj
    }
    let repo = getRepository<T>(TYPE)
    repo.merge.apply(repo, [obj, param, ...args])
    return obj
}

// 查询构造器易用性封装
function xquery<T>(connect: Connection, TYPE: new () => T, alias?: string): SelectQueryBuilder<T> {
    return connect.getRepository(TYPE).createQueryBuilder(alias)
}

// 分页查询获取总数以及原始记录数据
async function xcount<T>(sql: SelectQueryBuilder<T>, page: number, size: number): Promise<[any[] | null, number]> {
    xassert(page >= 1)
    const [count, rows] = await Promise.all([
        sql.getCount(),
        sql.offset((page - 1) * size).limit(size).getRawMany()
    ])
    return [rows, count]
}


// 路由参数的修饰符配置
// TODO 更多接口相关参数的配置扩展，例如：是否支持JSONP
function xroute(param: { name?: string, desc?: string, path?: string, auth?: boolean }) {
    // 缺省值处理
    param = xassign({name: '', desc: '', path: '', auth: true}, param)
    return function (target: Function, propertyKey: string, descriptor: PropertyDescriptor) {
        // TODO 注入到类实例定义中进行全局引用动态类的特性添加（trait功能的动态实现）
        // 动态绑定路由类实例的上下文属性
        target.prototype.context = () => {
            return {
                param: param, // 保存当前控制器用户定义参数信息
                // 是否登录的鉴权方法统一框架层面上的处理实现，此处仅仅是通用接口的约束的定义。
                auth: async () => {
                    // 调用登录功能的前端接口实现，取到对应的实现方法。
                    if (param && param.auth) {
                        // 需要鉴权进行会话有效性进行合法性校验处理！！
                        // 未认证错误抛出处理，前端单页应用接口报错逻辑处理正确错误提示跳转。
                        const auth = xgot(YAuth)
                        xassert(await auth.getLoginStatus(), ERR$UNAUTHORIZED)
                    }
                }
            }
        }
    }
}

// 完全没有必要的多余定义，需要通过MOCK定义进行细节数据类型的显性定义处理逻辑验证。
// // 基本数据类型的规范扩展定义，方便API接口的定义以及形参自动验证合法性，并且与数据库数据类型保持一致。
// type INT = number   // 有符号整数
// type UINT = number  // 无符号整数
// type DECIMAL = number // 精确小数
// type FLOAT = number // 单精度浮点数（不精确小数）
// type DOUBLE = number// 双精度浮点数（不精确小数）
// type BOOL = boolean
// type STR = string
// type DATE = string // 年月日 '2017-06-25'
// type TIME = string // 时分秒 '00:00:00'
// type DATETIME = string // 年月日时分秒 '2017-06-25 00:00:00'

// 模拟数据模板定义使用教程 http://mockjs.com/0.1/#%E6%95%B0%E6%8D%AE%E5%8D%A0%E4%BD%8D%E7%AC%A6%E5%AE%9A%E4%B9%89%20DPD
function xmock<T>(rules: T): any {
    return mockjs.mock(rules)
}

function xrandom(name: string, data: any[]) {
    mockjs.Random.extend({
        [name]: (...args) => {
            xassert(data.length > 0)
            if (data.length == 1) return data[0]
            let max = data.length - 1
            let idx = xmock(`@int(0,${max})`)
            return data[idx]
        }
    })
}

// 扩展一些预定义bxjs的基础随机方法或者覆盖一些mockjs中的方法
mockjs.Random.extend({
    // bxjs表定义的主键统一定义（约定系统中为字符串7-14字节长度算法）
    id: (...args) => {
        return shortid.generate()
    },
    // 中国手机号随机生成算法(约定系统中的手机号为字符串数据类型)
    mobile: (...args) => {
        const isps = [
            134, 135, 136, 137, 138, 139, 147, 150, 151, 152, 157, 158, 159, 182, 183, 184, 187, 188, 178,
            130, 131, 132, 145, 155, 156, 185, 186, 176,
            133, 134, 153, 180, 181, 189, 177, 173,
            176, 173, 177, 178, 170,
            140, 141, 142, 143, 144, 146, 148, 149, 154]
        let max = isps.length - 1
        let idx = xmock(`@int(0,${max})`)
        let num = xmock(`@int(100000000,199999999)`)
        return (isps[idx] * 100000000 + num % 100000000) + ''
    },
    // 转换为缺省中文内容提示
    paragraph: (...args) => {
        switch (args.length) {
            case 0:
                return xmock('@cparagraph')
            case 1:
                return xmock(`@cparagraph(${args[0]})`)
            case 2:
                return xmock(`@cparagraph(${args[0]},${args[1]})`)
            default:
                xassert(false)
        }

    },
    sentence: (...args) => {
        switch (args.length) {
            case 0:
                return xmock('@csentence')
            case 1:
                return xmock(`@csentence(${args[0]})`)
            case 2:
                return xmock(`@csentence(${args[0]},${args[1]})`)
            default:
                xassert(false)
        }

    },
    title: (...args) => {
        switch (args.length) {
            case 0:
                return xmock('@ctitle')
            case 1:
                return xmock(`@ctitle(${args[0]})`)
            case 2:
                return xmock(`@ctitle(${args[0]},${args[1]})`)
            default:
                xassert(false)
        }

    },
})

// laravel风格JSON对象验证器封装，详细文档见 https://github.com/skaterdav85/validatorjs
function xcheck<T>(param: T, rules: T, messages?: Object) {
    let obj = new validatorjs(param, rules)
    if (obj.fails()) {
        xthrow(ERR$PARAM, obj.errors)
    }
}

// 【IoC容器管理】应用层的插件实现类绑定到BXJS统一注册的标准插件的映射关系在全局容器实例中注册
function xbind<T>(TYPE: new () => T) {
    const o: any = new TYPE()
    return xcontainer.bind<T>(o.id).to(require(`@app/plugins/${o.id}`).default)
}

// 【IoC容器管理】框架或应用依赖标准规范接口插件的类实例获取方法
function xgot<T>(TYPE: new () => T) {
    const o: any = new TYPE()
    return xcontainer.get<T>(o.id)
}

// 同步系统命令调用执行
async function xcmd(...args: string[]): Promise<any> {
    try {
        const options: any = {}
        options.cwd = options.cwd || process.env.__ctxPath || process.cwd();
        xassert(_.isArray(args) && args.length > 0)
        const cmd = args.shift()
        const ret = cross_spawn.sync(cmd, args, xassign({stdio: 'inherit'}, options))
        xassert(ret.status === 0, ERR$UNKNOWN, ret)
        return ret
    } catch (err) {
        await xwarn(err)
        xthrow(err)
    }
}

global['__env__'] = 'local' // local,daily,pre,gray,prod 在统一入口处自动识别配置(目前暂不支持gray配置尚未开发无法自动识别)
global['__config__'] = undefined
global['__session__'] = {}
global['__cache__'] = {}
global['__user__'] = {}
global['__user_agent__'] = undefined
global['__client_ip__'] = undefined
global['__redirect_url__'] = undefined
global['__request_cookies__'] = {}
global['__respond_cookies__'] = {}

global['xconnect'] = xconnect
global['xnew'] = xnew
global['xquery'] = xquery
global['xcount'] = xcount
global['xassign'] = xassign
global['xconfig'] = xconfig
global['xthrow'] = xthrow
global['xassert'] = xassert
global['xerror'] = xerror
global['xroot'] = xroot
global['xstack'] = xstack
global['xwarn'] = xwarn
global['xlog'] = xlog
global['xpost'] = xpost
global['xget'] = xget
global['xsleep'] = xsleep
global['xredirect'] = xredirect
global['xcookie'] = xcookie
global['xismobile'] = xismobile
global['xsession'] = xsession
global['xuser'] = xuser
global['xcache'] = xcache
global['xroute'] = xroute
global['xmock'] = xmock
global['xrandom'] = xrandom
global['xcheck'] = xcheck
global['xcontainer'] = new Container() // 全局单实例容器初始化
global['xbind'] = xbind
global['xgot'] = xgot
global['YAuth'] = $$.YAuth // 全局声明认证插件规范抽象类
global['xcmd'] = xcmd