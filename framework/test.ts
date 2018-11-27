// 根据架构设计约定自动识别各种运行环境
if (process.argv.length >= 3 && process.argv[2] == 'https') {
    // 预发环境配置
    global['__env__'] = 'pre'
} else if (process.argv.length >= 3 && process.argv[2] == 'http') {
    // 日常环境配置
    global['__env__'] = 'daily'
}
else {
    // 本地环境配置
    global['__env__'] = 'local'
}
if (global['__env__'] != 'local') {
    require('source-map-support').install()
}
require('tsconfig-paths').register()
const express = require('express')
const app = express()
const _ = require('lodash')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs')
import {get_root_path_prefix, request_process, parse_post_param} from './init'

// 端口号启动参数配置
let PORT: any = parseInt(process.argv[2])
if (!PORT) {
    PORT = 8888
}

// 设置静态资源路径（必须要使用绝对路径）
app.use(express.static(path.join(__dirname, get_root_path_prefix(), './app/static')))

// 引入json解析中间件
const bodyParser = require('body-parser')
app.use(function (req, res, next) {
    var rawBody = []
    var size = 0
    req.on('data', function (data) {
        rawBody.push(data)
        size += data.length
    })
    req.on('end', function () {
        // 获取原始的content-type对应的body内容自行解析处理，解决本地环境和线上环境不兼容问题。
        req.rawBody = Buffer.concat(rawBody, size).toString()
    })
    next()
})
// 添加json解析
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: false}))
// 允许所有的请求形式
app.use(function (req, res, next) {
    if (req.headers.origin) {
        // 获取源站动态允许请求跨域 (FIXME 需要进行安全限制对来源服务器网址合法性进行安全限制，本地开发调试全部放开请求)
        res.header("Access-Control-Allow-Origin", req.headers.origin);
    }
    // res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Credentials", "true")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    next()
})

// 本地调试使用路由重定向映射功能模拟
const routes = require(get_root_path_prefix() + '/app/entries/route.map').default
for (let k in routes) {
    app.all(k, async function (req, res) {
        req.headers.__api__ = routes[k].path
        callback(req, res)
    })
}

// TODO SLS日志机制云端对接、监控机制的业务对接、性能测试的对接、ACM配置机制的对接、报错机制信息的正确解析处理、
// TODO COOKIE解析、BUC登录验证、   会议室信息的JAVA接口联调、梅丽莎多语言对接、ACM的配置发布
// TODO 错误页处理、SESSION模拟基于TableStore的实现、REST的实现、更多PAAS中间件根据业务需要对接集成进来、实际业务问题更多的优化扩展。。。
// 匹配不包含.的所有路由进行处理，否则表示文件静态资源需要单独处理。（API网关不返回任何静态资源，静态资源需要全部上传到CDN上，API网关只处理一个网站图标请求）
app.all(/^((?!\.).)*$/, callback)

// TODO 通过请求的域名和入口文件的位置，自动区分：本地、日常、预发、线上，四种环境。（灰度通过线上版本位置自动区分）
// 加载配置文件信息。。。比较特殊需要在每次请求的时候单独处理。
// 日常与预发在一台机器上需要分别启动两个独立nodejs进程进行处理，确保二者内部运行太壮数据的隔离性。

// nodejs服务支持证书配置问题，使用正式的域名证书进行绑定配置，测试的时候本地配置域名链接确保正常。
if (global['__env__'] == 'pre') {
    // 预发绑定HTTPS服务（对应AONE的日常机器）
    const privateKey = fs.readFileSync(
        path.join(__dirname.replace('/node_modules/@bxjs/base', '/'), '../secrete/private.pem'), 'utf8')
    const certificate = fs.readFileSync(
        path.join(__dirname.replace('/node_modules/@bxjs/base', '/'), '../secrete/public.crt'), 'utf8')
    const credentials = {key: privateKey, cert: certificate}
    const httpsServer = https.createServer(credentials, app)
    httpsServer.listen(443, function () {
        console.log('fc pre-release-test app listening on port 443!')
    })
} else if (global['__env__'] == 'daily') {
    // 日常绑定HTTP服务（对应AONE的日常机器，一台机器同时配置HTTP日常和HTTPS预发）
    const httpServer = http.createServer(app)
    httpServer.listen(80, function () {
        console.log('fc test app listening on port 80!')
    })
} else if (global['__env__'] == 'local') {
    // 本地开发环境
    const httpServer = http.createServer(app)
    httpServer.listen(PORT, function () {
        console.log(`fc test app listening on port ${PORT}, visit http://127.0.0.1:${PORT}`)
    })
} else {
    xassert(false)
}

async function callback(req, res) {
    let param = req.query || {}
    // 补上框架预定义的缺省参数__url__(其他更多框架参数__api__ __debug__ __mock__ TODO __param__ 在get中json字符串的base64格式)
    let __api__ = req.headers.__api__ ? req.headers.__api__ : req.path
    let __url__ = req.protocol + '://' + req.get('host') + req.originalUrl

    try {
        // 请求参数的自动格式化处理兼容get和post协议方便开发调试
        switch (req.method) {
            case 'GET':
                break
            case 'POST':
                param = xassign(param, parse_post_param(req.headers, req.rawBody))
                break
            case 'OPTIONS':
                // 仅仅支持本地开发跨域调试，线上需要禁止此方法的调用应该同域请求处理。
                res.sendStatus(200)
                return
            default:
                // 400  Bad Request	客户端请求的语法错误，服务器无法理解
                res.sendStatus(400)
                return
        }
        param = xassign(param, {__api__, __url__})

        // 解析请求中的cookies数据并转换为JSON对象存储到全局变量中便于后续应用xcookie接口使用
        global['__request_cookies__'] = require('cookie').parse(_.get(req.headers, 'cookie', ''))

        // 获取use-agent请求头部信息
        global['__user_agent__'] = req['headers'] ? (req['headers']['user-agent'] ? req['headers']['user-agent'] : '') : ''

        // 取到客户端的IP地址信息
        global['__client_ip__'] = req.headers['x-forwarded-for'] || req.connection.remoteAddress

        // 请求处理
        let out = await request_process(__api__, param)

        // 处理response的cookies设置
        if (!_.isEmpty(global['__respond_cookies__'])) {
            res.setHeader('Set-Cookie', _.values(global['__respond_cookies__']))
        }

        if (global['__redirect_url__']) {
            res.redirect(302, global['__redirect_url__'])
            global['__redirect_url__'] = undefined
            return
        }
        res.send(out)
    } catch (err) {
        // 通知框架自身实现逻辑的意外报错（框架自身不论何种情况都应该正常工作，一旦出现此问题大多数情况是框架自身问题或者流量引发的运维问题）
        await xwarn({
            __api__, __url__, param, message: err.message, stack: xstack(err)
        })
        // 500	Internal Server Error	服务器内部错误，无法完成请求
        res.sendStatus(500)
    }
}