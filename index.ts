// 将@bxjs/base以库的方式进行引用使用其中的全局方法以及TS等基础工程配置的复用，所有导出的都是全局符号信息。
require('./framework')

// TODO 数据库修饰符还需要继续改进为全局标准符号形成bxjs的数据库开发标准。
export * from './framework/plugins/database'
