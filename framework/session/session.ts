const _ = require('lodash')
const moment = require('moment')
const shortid = require('shortid')
import {NoSqlAliyunTablestore} from './driver/aliyun_ots'

const SESSION_KEY = 'XJSSESSID' // AXJS SESSION ID的缩写，BXJSSESSID为BXJS SESSION ID类似方法进行区分。

// framework内部使用
export async function __framework_session_init__(header?: Object) {
    // 在框架请求初始化的时候自动生成一个唯一的会话请求标识并保存到全局变量__session__之中，此处仅仅读取数据。
    // 在框架请求初始化的时候根据框架协议约定从cookie或header头部取到客户端的会话标识，如果取不到自动重新生成一个新标识。
    if (!global['__session__']) {
        global['__session__'] = {}
    }
    if (header && header[SESSION_KEY]) {
        // 对于REST类型请求从HEADER头上获取会话标识（等同于客户端OAUTH2登录认证对应的ACCESSS_TOKEN数据是类似的）
        global['__session__'].id = header[SESSION_KEY]
    } else {
        // 对于WEB类型请求的COOKIES会话标识的统一获取参数配置
        global['__session__'].id = xcookie(SESSION_KEY)
    }

    if (!global['__session__'].id) {
        // 新请求临时生成一个会话标识
        global['__session__'].id = shortid.generate()
        // 重置全局变量缓存中的用户信息
        global['__user__'] = {}
    } else {
        // 对于老请求预先读取出__user__中的会话信息到内存中方便全局请求处理
        const param = await xsession.get('__user__')
        if (!global['__user__']) {
            global['__user__'] = {}
        }
        if (param) {
            global['__user__'].id = param.id
            global['__user__'].param = param
        }
    }

    // 刷新客户端保存在COOKIES之中的会话标识到期时间
    xcookie(SESSION_KEY, global['__session__'].id)
}

// 全局静态类导出给应用开发者使用（调用应用代码之前需要确保框架已经正确执行__framework_session_init__方法）
export class xsession {
    // 会话id唯一标识，基于FC的特点单进程启动执行不常驻内存的特点，可用静态全局变量简化实现代表当前用户请求信息。
    // 通过web端的cookie或者rest端的header头部信息，统一取到客户端对应的会话标识码。
    static get id() {
        xassert(global['__session__'] && global['__session__'].id)
        return global['__session__'].id
    }

    // 检查会话信息是否有效
    private static async _check(saved, requested): Promise<boolean> {
        // 检查OTS中是否存在对应的记录值
        if (!saved || !saved['__updated_at__']) return false

        // 检查会话是否超时
        const saved_time = moment(saved['__updated_at__'])
        const now_time = moment(requested['__updated_at__'])
        const timeout = 24 * 60 * 60 * 1000 // 默认session超时时间是24小时
        if (now_time.diff(saved_time) > timeout) {
            return false
        }

        // 检查客户端请求的特征参数是否发生变化防止盗用会话标识
        if (saved['__user_agent__'] != requested['__user_agent__'] ||
            saved['__client_ip__'] != requested['__client_ip__']) {
            return false
        }

        return true
    }

    // 仅在初次使用的时候按需初始化OTS的会话记录信息（会话持久化数据仅仅在首次被使用的时候才开始正式计时处理）
    private static async _init(key?: string) {
        xassert(global['__session__'] && global['__session__'].id)
        if (!global['__session__'].ots) {
            global['__session__'].ots = new NoSqlAliyunTablestore('__session__')
        }
        const ots = global['__session__'].ots as NoSqlAliyunTablestore
        const now = moment().format('YYYY-MM-DD HH:mm:ss')
        const user_agent = global['__user_agent__'] as string // 框架在启动的时候正确获取到此信息
        const client_ip = global['__client_ip__'] as string   // 框架在启动的时候正确获取到此信息
        xassert(user_agent && client_ip)
        // 安全防范防止会话标识被盗用问题：
        // 取会话的基础配置信息验证用户合法性信息是否伪造会话头部数据（USER-AGENT和IP的指纹数据必须要严格保持一致，
        // 否则需要自动重新创建一个新会话并且更新客户端会话数据确保会话信息无法被非法盗用问题。）
        const KEYS = ['__created_at__', '__updated_at__', '__user_agent__', '__client_ip__']
        if (key) {
            KEYS.push(key)
        }
        const requested = {
            __created_at__: now,
            __updated_at__: now,
            __user_agent__: user_agent,
            __client_ip__: client_ip,
        }
        let saved = await ots.query(global['__session__'].id, KEYS)
        if (saved) {
            // FIXME xiaobo反馈问题session偶现失效问题。
            // FIXME 定位排查是：OTS写入下面四个字段的时候出现更新操作不是原子性的导致的
            // FIXME 临时解决方案：发现问题做session失效临时规避掉并做报警处理，等待后续与tablestore团队报故障。
            // xassert(saved['__created_at__'] && saved['__updated_at__'] &&
            //     saved['__user_agent__'] && saved['__client_ip__'])
            if (!(saved['__created_at__'] && saved['__updated_at__'] &&
                saved['__user_agent__'] && saved['__client_ip__'])) {
                await xwarn('OTS保存SESSION信息出错！！！', {saved, requested})
                // 会话无效更换一个新的会话标识
                global['__session__'].id = shortid.generate()
                // 通过COOKIE将变更的会话标识在当前请求结束后同步到客户端缓存起来
                xcookie(SESSION_KEY, global['__session__'].id)
                // 重置全局变量缓存中的用户信息
                global['__user__'] = {}
                return {saved: undefined, requested, ots, status: false}
            }
        }
        // 检查会话是否有效（记录不存在无效、存在但是会话超时无效、存在但是持久化对应的指纹特征属性变化导致新请求无效、等等未来增加更多的安全验证规则）
        let status = await xsession._check(saved, requested)
        if (!status) {
            // 会话无效更换一个新的会话标识
            global['__session__'].id = shortid.generate()
            // 通过COOKIE将变更的会话标识在当前请求结束后同步到客户端缓存起来
            xcookie(SESSION_KEY, global['__session__'].id)
            // 重置全局变量缓存中的用户信息
            global['__user__'] = {}
        }
        return {saved, requested, ots, status}
    }

    static async get(key: string, defaultValue?: any) {
        let {saved, requested, ots, status} = await xsession._init(key)
        if (!status) {
            // 插入一条新会话纪录
            if (defaultValue !== undefined) {
                requested[key] = JSON.stringify(defaultValue)
            }
            await ots.insert(global['__session__'].id, requested)
            return defaultValue
        }
        return _.isString(saved[key]) ? JSON.parse(saved[key]) : defaultValue
    }

    static async set(key: string, value: any) {
        let {requested, ots, status} = await xsession._init(key)
        if (!status) {
            // 插入一条新会话纪录
            requested[key] = JSON.stringify(value)
            await ots.insert(global['__session__'].id, requested)
        } else {
            // 更新已存在的记录一个字段
            await ots.update(global['__session__'].id, {
                '__updated_at__': requested.__updated_at__,
                [key]: JSON.stringify(value),
            })
        }
    }

    static async delete(key: string) {
        let {requested, ots, status} = await xsession._init()
        if (status) {
            await ots.update(global['__session__'].id, {
                '__updated_at__': requested.__updated_at__,
                [key]: null,
            })
        }
    }

    // 用户登出的时候需要调用此接口删除服务端缓存的会话状态信息
    static async destroy() {
        let {ots, status} = await xsession._init()
        if (status) {
            await ots.delete(global['__session__'].id)
        }
    }
}

// 用户级全局持久化缓存（应用于rest或web场景下）当前用户登录信息以及配置信息持久化存储。
// 直接从当前会话中得到用户id（持久化缓存到静态全局变量之中加速信息的获取，每次调用的时候进行复用处理加速数据请求）
// 每个登录成功后的用户对应一条持久化的记录。
export class xuser {
    static get id() {
        if (!global['__user__']) {
            global['__user__'] = {}
        }
        return global['__user__'].id
    }

    static get param() {
        if (!global['__user__']) {
            global['__user__'] = {}
        }
        return global['__user__'].param
    }

    // 登录成功之后需要从会话中得到当前登录的用户标识信息，以此准确的判定获取用户身份数据信息，从而得到用户运行配置数据。
    // 框架层面上在登录完成之后需要正确设置唯一用户标识，并在用户登出的时候取消掉对应的用户标识信息。
    private static async _init() {
        if (!global['__user__']) {
            global['__user__'] = {}
        }
        xassert(global['__user__'].id, ERR$UNAUTHORIZED)
        if (!global['__user__'].ots) {
            global['__user__'].ots = new NoSqlAliyunTablestore('__user__')
        }
        const ots = global['__user__'].ots as NoSqlAliyunTablestore
        return {ots}
    }

    static async get(key: string, defaultValue?: any) {
        const {ots} = await xuser._init()
        const saved = await ots.query(global['__user__'].id, [key])
        if (!saved || !saved[key]) {
            return defaultValue
        }
        return JSON.parse(saved[key])
    }

    static async set(key: string, value: any) {
        let {ots} = await xuser._init()
        // 替换记录对应的字段（如果记录不存在插入一条新记录）
        await ots.replace(global['__user__'].id, {
            [key]: JSON.stringify(value),
        })
    }

    static async delete(key: string) {
        let {ots} = await xuser._init()
        await ots.replace(global['__user__'].id, {
            [key]: null,
        })
    }

    // 用户恢复出厂缺省设置的时候需要调用此接口
    static async destroy() {
        let {ots} = await xuser._init()
        await ots.delete(global['__user__'].id)
    }
}

// 应用级全局持久化缓存，系统全局持久化缓存数据。取代redis类似的DB数据查询结果的中间缓存。全部自动转换为JSON内部与OTS通信缓存数据。
// 主键id为group分组标识名称，一般只有一条记录即可记录全局持久化数据字段结构。
export class xcache {
    private static async _init() {
        if (!global['__cache__']) {
            global['__cache__'] = {}
        }
        if (!global['__cache__'].id) {
            // 全局cache仅仅一条记录值对应的ots表的id固定写死掉即可
            global['__cache__'].id = '-'
        }
        if (!global['__cache__'].ots) {
            global['__cache__'].ots = new NoSqlAliyunTablestore('__cache__')
        }
        const ots = global['__cache__'].ots as NoSqlAliyunTablestore
        return {ots}
    }

    static async get(key: string, defaultValue?: any) {
        const {ots} = await xcache._init()
        const saved = await ots.query(global['__cache__'].id, [key])
        if (!saved || !saved[key]) {
            return defaultValue
        }
        return JSON.parse(saved[key])
    }

    static async set(key: string, value: any) {
        let {ots} = await xcache._init()
        // 替换记录对应的字段（如果记录不存在插入一条新记录）
        await ots.replace(global['__cache__'].id, {
            [key]: JSON.stringify(value),
        })
    }

    static async delete(key: string) {
        let {ots} = await xcache._init()
        await ots.replace(global['__cache__'].id, {
            [key]: null,
        })
    }

    // 系统升级清空临时缓存数据值使用方法
    static async destroy() {
        let {ots} = await xcache._init()
        await ots.delete(global['__cache__'].id)
    }
}

// TODO 将这部分代码改进到单元测试框架中
// 系统全局辅助方法实现 TODO 缺命令行工具链以及系统升级迁移脚本功能写线上运维环境的代码升级脚本
// export class xcmd {
//     // 系统首次安装方法
//     static async install_ots() {
//         const ots_tbl_session = new NoSqlAliyunTablestore('__session__')
//         const ots_tbl_user = new NoSqlAliyunTablestore('__user__')
//         const ots_tbl_cache = new NoSqlAliyunTablestore('__cache__')
//
//         await ots_tbl_session.destroy()
//         await ots_tbl_cache.destroy()
//         await ots_tbl_user.destroy()
//
//         await ots_tbl_session.create(24 * 3600, 1)
//         await ots_tbl_cache.create(-1, 1)
//         await ots_tbl_user.create(-1, 1)
//     }
//
//     // static async test() {
//     //     const otstbl = new NoSqlAliyunTablestore('test')
//     //     // const destroy_tmp_tables = ['test', 'test1', 'test2', 'test3', 'session_test1', 'session_test2']
//     //     // for(let tbl of destroy_tmp_tables){
//     //     //     otstbl.table = tbl
//     //     //     await otstbl.destroy()
//     //     // }
//     //
//     //     // 无限属性个数的设置OTS的管理后台已经不支持显示不全需要自己开发额外的程序进行管理（控制台上只能显示20个属性数据）
//     //     // await xcache.set('a', {a: 1, b: 2})
//     //     // await xcache.set('b', 12345)
//     //     // // 测试设置256个属性是否全部操作正常？
//     //     // for (let i = 0; i < 256; i++) {
//     //     //     await xcache.set(`p${i}`, i)
//     //     // }
//     //
//     //     // 属性读取测试
//     //     // let keys = ['a','b','p0','p255']
//     //     // let out = []
//     //     // for(let k of keys){
//     //     //     let o = await xcache.get(k)
//     //     //     out.push(o)
//     //     // }
//     //
//     //     // 字段以及表删除测试
//     //     // let out = await xcache.delete('b')
//     //     // let out = await xcache.destroy()
//     //
//     //     // user缓存模拟测试
//     //     let out
//     //     global['__user__'] = {id: 'abcd'}
//     //     // let out = await xuser.set('a', {a: 1, b: 2})
//     //     // await xuser.set('b', 12345)
//     //
//     //     // 测试设置256个属性是否全部操作正常？
//     //     // for (let i = 0; i < 256; i++) {
//     //     //     await xuser.set(`p${i}`, i)
//     //     // }
//     //
//     //     // let keys = ['a','b','p0','p255']
//     //     // out = []
//     //     // for(let k of keys){
//     //     //     let o = await xuser.get(k)
//     //     //     out.push(o)
//     //     // }
//     //
//     //     // out = await xuser.delete('b')
//     //     // out = await xuser.destroy()
//     //
//     //     // session缓存模拟测试
//     //     // global['__user_agent__'] = 'user_agent'
//     //     // global['__client_ip__'] = 'client_ip11111122223333'
//     //     // await __framework_session_init__()
//     //     // out = await xsession.set('a', {a: 1, b: 2})
//     //     // await xsession.set('b', 12345)
//     //
//     //     // // 测试设置256个属性是否全部操作正常？
//     //     // for (let i = 0; i < 256; i++) {
//     //     //     await xsession.set(`p${i}`, i)
//     //     // }
//     //     //
//     //     // let keys = ['a','b','p0','p255']
//     //     // out = []
//     //     // for(let k of keys){
//     //     //     let o = await xsession.get(k)
//     //     //     out.push(o)
//     //     // }
//     //     // out = await xsession.delete('b')
//     //     // out = await xsession.destroy()
//     //
//     //     // out = xassign({}, global['__session__'], out)
//     //     return out
//     // }
// }
