// 在单元测试场景下的日志打印接口封装。
declare function zlog(...args): void

// 单元测试场景下调用entries接口类似于postman的方法执行接口请求。
declare function zpost(path: string, param?: Object): Promise<any>

// 远程静态类方法调用方法 path格式为：模块绝对路径/静态类/静态方法。
// 被调用的静态类格式必须要为：async方法定义、输入参数为PlainObject普通对象。
declare function zcall(path: string, param?: Object): Promise<any>