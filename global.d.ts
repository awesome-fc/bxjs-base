import {BaseEntity, Connection, SelectQueryBuilder} from '@bxjs/typeorm'
import {Container, interfaces} from 'inversify'

declare global {
    // const ERRORS: {}
    // const ERR$UNKNOWN: string
    // const ERR$ASSERT: string
    // const ERR$PARAM: string
    // const ERR$UNAUTHORIZED: string
    // const ERR$FORBIDDEN: string
    // const ERR$EMPTY: string
    // const ERR$SEARCH: string
    // const ERR$CONFIG: string

    function xconfig(path: string, defaultValue?: any)

    function xthrow(code?: string | Error, param?: any, reject_param?: any): void

    function xassert(expr: any, code?: string, param?: any): any

    // // 验证规则文档 https://github.com/node-modules/parameter
    // function xcheck(param: { [propName: string]: any }, rules: { [propName: string]: any })

    // 对于异常内容的格式化参数解析处理成为四元组code/msg/param/stack
    function xerror(err: Error, param?: any)

    // 用于获取错误栈的root cause根本原因（第一个被拦截的错误发生位置）
    function xroot(err: Error)

    // 获取异常调用栈用于辅助错误提示定位
    function xstack(err: Error, compact?: boolean)

    function xlog(...args)

    // TODO
    // function xdebug(...args)

    // 钉钉IM群机器人报警通知
    function xwarn(...args)

    // async/await的非阻塞异步延迟方法，用于调试阻塞程序的执行进行单步调试的效果。延时单位毫秒。缺省参数为无限延时
    function xsleep(ms?: number)

    // 默认超时3000毫秒
    function xget(url: string, param?: { [propName: string]: any },
                  headers?: { [propName: string]: any }, timeout?: number)

    // 默认超时3000毫秒
    function xpost(url: string, param?: { [propName: string]: any },
                   headers?: { [propName: string]: any }, timeout?: number): any


    function xredirect(url: string, param?: {})

    // 如果只有key参数表示读取属性（缺省值为undefined），如果key为空表示读取所有的请求cookies属性，否则表示响应设置cookies
    function xcookie(key?: string, value?: string, option?: {
        // option属性介绍详见文档 https://github.com/jshttp/cookie
        domain?: string,
        path?: string,
        httpOnly?: boolean,
        sameSite?: boolean | 'lax' | 'strict',
        secure?: boolean,
        encode?: string,//default utf8
        expires?: Date,
        maxAge?: number,// seconds
    }): any

    // 判断user-agent请求是否为移动端
    function xismobile(): boolean

    function xassign(target, source, ...args): any

    function xconnect(callback: (connect: Connection) => Promise<any>, config?: string): Promise<any>

    // 创建ORM实体对象的时候，支持前端参数的自动批量赋值逻辑实现。
    function xnew<T extends BaseEntity>(TYPE: new () => T, param?: any, ...args): T

    // 查询构造器易用性封装
    function xquery<T>(connect: Connection, TYPE: new () => T, alias?: string): SelectQueryBuilder<T>


    // 分页查询获取总数以及原始记录数据
    function xcount<T>(sql: SelectQueryBuilder<T>, page: number, size: number): Promise<[any[] | null, number]>

    class xsession {
        // 读取当前会话标识
        static readonly id

        static get(key: string, defaultValue?: any): Promise<any>

        static set(key: string, value: any): Promise<any>

        static delete(key: string): Promise<any>

        // 用户登出的时候需要调用此接口删除服务端缓存的会话状态信息
        static destroy(): Promise<any>
    }

    class xuser {
        // 读取当前登录用户标识
        static readonly id

        // 读取用户登录缓存在session之中的常用用户基本信息参数
        static readonly param

        static get(key: string, defaultValue?: any): Promise<any>

        static set(key: string, value: any): Promise<any>

        static delete(key: string): Promise<any>

        // 当用户恢复储出厂设置的时候调用此接口清空当前用户的持久化缓存信息
        static destroy(): Promise<any>
    }

    class xcache {
        static get(key: string, defaultValue?: any): Promise<any>

        static set(key: string, value: any): Promise<any>

        static delete(key: string): Promise<any>

        static destroy(): Promise<any>
    }


    /**
     * 路由修饰符，用于定义entries相关入口文件的相关额外属性，方便自动化工具以及框架识别完成各种辅助操作。
     * name 路由名称
     * desc 路由描述
     * path 缺省文件相对路径路由格式的覆盖重写
     * auth 该路由是否需要登录认证（缺省为true需要登录认证）
     */
    function xroute(param: { name?: string, desc?: string, path?: string, auth?: boolean }): Function

    // 模拟数据模板定义使用教程 http://mockjs.com/0.1/#%E6%95%B0%E6%8D%AE%E5%8D%A0%E4%BD%8D%E7%AC%A6%E5%AE%9A%E4%B9%89%20DPD
    function xmock<T>(rules: T): any

    function xrandom(name: string, data: any[])

    // laravel风格JSON对象验证器封装，详细文档见 https://github.com/skaterdav85/validatorjs
    function xcheck<T>(param: T, rules: T, messages?: Object)

    //【IoC容器管理】单实例全局插件容器
    const xcontainer: Container

    //【IoC容器管理】应用层的插件实现类绑定到BXJS统一注册的标准插件的映射关系在全局容器实例中注册
    function xbind<T>(TYPE: new () => T): interfaces.BindingInWhenOnSyntax<T>

    //【IoC容器管理】框架或应用依赖标准规范接口插件的类实例获取方法
    function xgot<T>(TYPE: new () => T): T

    class YAuth {
        // 插件标识
        readonly id

        // 登录逻辑实现
        login(user_id: string, user_param?: Object): Promise<void>

        // 登出逻辑实现
        logout(): Promise<void>

        // 判断是否处于登录状态
        getLoginStatus(): Promise<boolean>
    }

    // 同步系统命令调用执行
    function xcmd(...args: string[]): Promise<any>
}