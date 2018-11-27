require('source-map-support').install()
require('tsconfig-paths').register()
import {request_process, parse_post_param} from './init'

const _ = require('lodash')

// // 临时调试线上日志打印
// //framework/index.ts(8,13): error TS2339: Property 'setLogLevel' does not exist on type 'Console'
// exports.handler = async function (event, context, callback) {
//     // console.setLogLevel('error') 不能写在此会导致编译错误阿里云自己扩展的私有方法
//     console.log('xxxxx', 'yyyyy', 'zzzzzz')
//     console.error('xxxxx1', 'yyyyy1', 'zzzzzz1')
//     let out = '<html><body>zzzzzz</body></html>'
//     let htmlResponse = {
//         isBase64Encoded: true,
//         statusCode: 200,
//         headers: {
//             "Content-type": "text/html; charset=utf-8",
//         },
//         // base64 encode body so it can be safely returned as JSON value
//         body: new Buffer(out as string).toString('base64')
//     }
//     callback(null, htmlResponse)
// }

// 基于阿里云的函数计算统一入口的路由处理
exports.handler = async function (event, context, callback) {
    // TODO 增加对于定时器的功能模拟实现
    xlog('$$$$=>' + event.toString())
    // TODO 去除掉换行方便方便SLS上的日志输出排版显示
    console.log('$$$$=>' + event.toString().replace(/\r/g, '').replace(/\n/g, ''))

    let evt = JSON.parse(event.toString())

    // 根据API网关设置的环境常量参数正确配置线上版本的运行环境，取代AONE的本地、日常、预发、灰度等环境部署支持开发。
    // 全局变量仅仅用于放在整个应用生命周期变量
    global['__env__'] = _.get(evt, 'headers.__env__', 'prod')

    // TODO 需要对于事件定时器进行统一的约定在应用层可扩展自定义相关定时器等事件类型
    if (evt['triggerName']) {
        // 对定时触发器的统一拦截处理
        switch (evt['triggerName']) {
            case '__axjs-preheat-timer__':
                // 获取请求参数的配置数据
                try {
                    let payload = JSON.parse(evt['payload'])
                    xassert(payload['url'] && payload['timeout'])
                    await xpost(payload['url'], payload['param'], undefined, payload['timeout'])
                } catch (err) {
                    // ignore error
                    xlog(JSON.stringify(xerror(err)).replace(/\r/g, '').replace(/\n/g, ''))
                }
                break
        }
        return
    } else if (evt['path'] === '/__axjs-preheat-timer__') {
        // 预热api网关的空请求心跳接口实现
        return
    }
    global['__evt__'] = event.toString() // FIXME 需要设计上下文定义请求实例生命周期变量
    // 先以HEAER中的__api__字段进行识别，如果HEADER中没有定义再使用URL路径对应的PATH识别，以此支持SEO等前端路径重写问题。
    let __api__ = _.get(evt, 'headers.__api__', evt.path) // 最终控制器与app子目录下的ts文件保持完全的一一映射关系。
    // 改进为根据API网关的相关参数自动拼接出来正确的URL网址请求路径
    let __url__ = evt['headers']['X-Forwarded-Proto'] + '://' + evt['headers']['CA-Host'] + evt['path']

    let param = Object.assign(
        {__api__, __url__}, // header请求中的两个框架层面上的预定义参数 TODO 需要移除掉并非应用关心的内容
        evt.pathParameters || {}, // 路由重写参数 domain/[a]/[b]?xxx (可被GET参数覆盖)
        evt.queryParameters || {} // GET请求参数 domain/path?a=x&b=x
    )
    let out = {}

    // // 条件日志打印线上临时问题排查处理（TODO 增加业务逻辑扩展注入的钩子实现）
    // let xdebug = async (...args) => {
    //     if (!_.includes(__url__, 'y.alibaba-inc.com')) {
    //         return
    //     }
    //     await xwarn(...args)
    // }
    // global['xdebug'] = xdebug // 全局可用
    // await xdebug({param, evt})

    switch (evt.httpMethod) {
        case 'GET':
            break
        case 'POST':
            try {
                // 阿里云API网关的POST请求参数是JSON字符串的BASE64编码所以需要进行转义处理
                let post = {}
                if (_.isString(evt.body)) {
                    let body = evt.body
                    if (evt.isBase64Encoded) {
                        body = new Buffer(evt.body, 'base64').toString()
                    }
                    post = parse_post_param(evt['headers'], body)
                }
                param = Object.assign(param, post) // 用post参数覆盖掉get参数，用于灵活的设置请求参数兼容get和post两种方法方便开发调试。
            } catch (err) {
                xlog(err, evt.httpMethod, evt.body)
                await xwarn(err)
                // 400	Bad Request	客户端请求的语法错误，服务器无法理解
                callback(null, {
                    statusCode: 400,
                })
                return
            }
            break
        default:
            xlog(evt.httpMethod, evt.body)
            // 400	Bad Request	客户端请求的语法错误，服务器无法理解
            callback(null, {
                statusCode: 400,
            })
            return
    }

    try {
        // 解析请求中的cookies数据并转换为JSON对象存储到全局变量中便于后续应用xcookie接口使用
        let cookie = _.get(evt['headers'], 'Cookie', undefined)
        if (!cookie) {
            cookie = _.get(evt['headers'], 'cookie', '')
        }
        global['__request_cookies__'] = require('cookie').parse(cookie)

        // 获取use-agent请求头部信息
        global['__user_agent__'] = evt['headers']['User-Agent']
        // 获取客户端的IP地址信息
        global['__client_ip__'] = evt['headers']['X-Real-IP']

        // TODO WEB请求需要对404页面以及ERROR页面进行兼容处理（在framework内部进行细节的错误判断在out中透传status的http的状态吗正确错误返回）
        // 404	Not Found 服务器无法根据客户端的请求找到资源（网页）。通过此代码，网站设计人员可设置"您所请求的资源无法找到"的个性页面
        // 403	Forbidden	服务器理解请求客户端的请求，但是拒绝执行此请求（权限验证处理错误）
        out = await request_process(__api__, param)

        // 处理response的cookies设置
        let setCookie = {'Set-Cookie': undefined}
        if (!_.isEmpty(global['__respond_cookies__'])) {
            setCookie['Set-Cookie'] = _.values(global['__respond_cookies__'])
        }

        if (global['__redirect_url__']) {
            callback(null, {
                statusCode: 302,
                headers: {
                    "Location": global['__redirect_url__'],
                    ...setCookie
                },
            })
            global['__redirect_url__'] = undefined
        }
        else if (_.isString(out)) {
            let htmlResponse = {
                isBase64Encoded: true,
                statusCode: 200,
                headers: {
                    "Content-type": "text/html; charset=utf-8",
                    ...setCookie
                },
                // base64 encode body so it can be safely returned as JSON value
                body: new Buffer(out as string).toString('base64')
            }
            callback(null, htmlResponse)
        } else {
            let jsonResponse = {
                isBase64Encoded: true,
                statusCode: 200,
                headers: {
                    "Content-type": "application/json"
                },
                // base64 encode body so it can be safely returned as JSON value
                body: new Buffer(JSON.stringify(out)).toString('base64')
            }
            callback(null, jsonResponse)
        }
    } catch (err) {
        // 通知框架自身实现逻辑的意外报错（框架自身不论何种情况都应该正常工作，一旦出现此问题大多数情况是框架自身问题或者流量引发的运维问题）
        await xwarn({
            __api__, __url__, param, message: err.message, stack: xstack(err)
        })
        // 500	Internal Server Error	服务器内部错误，无法完成请求
        callback(null, {statusCode: 500})
    }
}

//  API参数的识别逻辑，为普通字符串路径定义与app下的ts文件路由完全一一对应，优先取HEADER中的定义，再取GET中的形参定义或者POST形参定义进行参数请求的覆盖处理。
//  PARAM请求的参数处理要求为BASE64编码化的JSON字符串。
//     "event": {
//         "body": "ewoJImFwaSI6ICIvYS9iL2MiLAoJInBhcmFtIjogImFzZGZhc2RmYXNkZiIKfQ==", => 对应于POST请求数据
//         "headers": {
//             "X-Ca-Api-Gateway": "B25CD51B-5815-4775-9EAB-6D481BC1AE17",
//             "__api__": "/web/mobile/test",   =》 自定义转义PATH的路径信息对于SEO优化兼容处理（也可以在GET或POST请求中传递对应参数）
//             "X-Forwarded-For": "42.120.74.88",
//             "Content-Type": "application/json"
//         },
//         "httpMethod": "POST",
//         "isBase64Encoded": true,
//         "path": "/", =》 没有意义用于前端根据需要自己进行扩展别名映射处理，后端的控制器不以此为标准，可以对同一个控制器定义N个不同的路径标识。
//         "pathParameters": {},
//         "queryParameters": {} => 对应于GET请求数据
//     },
//     "query": {},
//     "context": {
//         "requestId": "B25CD51B-5815-4775-9EAB-6D481BC1AE17",
//         "credentials": {
//             "accessKeyId": "",
//             "accessKeySecret": "",
//             "securityToken": ""
//         },
//         "function": {
//             "name": "test",
//             "handler": "index.handler",
//             "memory": 128,
//             "timeout": 300
//         },
//         "services": {
//             "name": "alilang",
//             "logProject": "",
//             "logStore": ""
//         },
//         "region": "cn-shanghai",
//         "accountId": "1734066057689528"
//     }
// }

// 最新版本event的API网关的FC返回数据格式：
//      CA-Host请求域名、
//      X-Forwarded-Proto
//      "path": "/test", ==》》基本上可以拼接出__url__参数可以省略掉此冗余参数配置了。
//                       ==》》借助route.map.ts文件的映射关系定义省略掉__api__配置进一步简化网关应用。
//      "httpMethod": "GET",
//      "isBase64Encoded": true,
//      "X-Forwarded-For": "42.120.74.103", // 客户端请求IP地址用户判定所属区域信息海外访问问题优化依赖点
//      "X-Real-IP": "42.120.74.103",
//      Cookie
//      User-Agent       =>> PC站和M站自适应问题
//      Accept-Language  =>> 浏览器客户端的语言类型自动适配多语言架构设计问题
// let x = {
//     "body": "",
//     "headers": {
//         "X-Ca-Api-Gateway": "B276F77B-334E-4857-AE64-65BAFD419E2A",
//         "Cookie": "cna=r5snEzzOvA0CASp4Smdq+II/; UM_distinctid=162bcd61d9111cd-080e0f43e6b60d-33697b04-13c680-162bcd61d92c86; _tb_token_=H8U7BqixF3YVR3GnhMRz; NEW2_ACR_JSESSIONID=VM566F91-K5CP8QIVMQTSAH3C4H5X1-DRIHYJHJ-QE2; _new_cr_session0=1AbLByOMHeZe3G41KYd5WcPdC%2Fi8qvGHUBTK8Fbrfx8Soi%2BHELuxxA6jros7W%2FqC1YtebgB3auEF5lu1SCzUzTkt6v%2FiFeN%2FptbvBRziYEGXSEVhWnUlBR2tfpjrXMnIcfb2%2FwnGkH4vkeMIJ1Bvuw%3D%3D; emplId=149337; hrc_sidebar=open; traceId=7d4b16de-74bc-4eac-884b-54ca0354e4aa; SSO_LANG=ZH-CN; SSO_EMPID_HASH=9db1ed21402f7c36674b5e6e6de1fc68; animate_date=201864; aa=xxxxxxx; cn_1260001221_dplus=%7B%22distinct_id%22%3A%20%22162bcd61d9111cd-080e0f43e6b60d-33697b04-13c680-162bcd61d92c86%22%2C%22sp%22%3A%20%7B%22%24_sessionid%22%3A%200%2C%22%24_sessionTime%22%3A%201528086234%2C%22%24dp%22%3A%200%2C%22%24_sessionPVTime%22%3A%201528086234%7D%7D; isg=BDw8SonyS9utyn5fedYRe-uRDdzwNAD0-51BHha9_ScJ4dxrNkWw77KQxQmZqRi3",
//         "X-Forwarded-Proto": "https",
//         "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36",
//         "__url__": "https://toufang.alibaba-inc.com/test",
//         "CA-Host": "toufang.alibaba-inc.com",
//         "Cache-Control": "max-age=0",
//         "upgrade-insecure-requests": "1",
//         "Accept-Language": "zh-CN,zh;q=0.9",
//         "__api__": "/web/test/test",
//         "Accept-Encoding": "gzip, deflate, br",
//         "X-Forwarded-For": "42.120.74.103",
//         "X-Real-IP": "42.120.74.103",
//         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8"
//     },
//     "httpMethod": "GET",
//     "isBase64Encoded": true,
//     "path": "/test",
//     "pathParameters": {},
//     "queryParameters": {}
// }
