export {AUTO_KEY_NAME} from './inerface'
import {NosqlAliyunTablestore} from './nosql-aliyun-tablestore'

export class Table extends NosqlAliyunTablestore {
    constructor(table: string, config: string = 'default') {
        super(table, config)
    }
}

// TODO 支持从配置参数中动态加载业务自己定义实现的接口(类似工厂方法) ？？
// export const nosql = function () {
//     return require('./nosql-aliyun-tablestore').default
// }()