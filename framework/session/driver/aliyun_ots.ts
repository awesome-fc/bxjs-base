/**
 * 研究阿里云的OTS表格设计将session、cache、user三种缓存信息算法构建在此之上。
 */
const TableStore = require('tablestore')
const Long = TableStore.Long
const _ = require('lodash')

abstract class NoSqlInterface {
    constructor(table: string, config: string | {}[] = 'default') {
    }

    // 约定所有表都需要有自增主键id作为内部唯一标识码，其余三个主键必须全部为字符串。（后端需要扩展int和date基本数据类型以及操作符重载实现优化开发）
    // 属性字段可以根据业务演变任意的扩展增加由业务代码对于老数据不存在新增字段值的情况做兼容处理
    public abstract async insert(id, kvt: { [index: string]: string | { value: string, timestamp: number } }) ;

    // 条件更新必须要填写主键记录值(仅仅允许更新属性字段而主键字段是不允许更新的，
    //      整列更新和删除列属于运维操作禁止应用中使用需要单独接口以及权限认证)
    public abstract async update(id: string, kvt: { [index: string]: string | null | number }) ;

    // 以主键作为条件删除记录值
    public abstract async delete(id: string);

    // 分页查询一次检索N条记录
    public abstract async query(id: string, keys: string[] | null, max_version: number): Promise<any>;

    // 销毁表
    public abstract async destroy();

    // 创建表
    public abstract async create();

    // 查询当前表的描述信息
    public abstract async describe();

    // 变更表
    public abstract async change(param: {
        maxVersions?: number, timeoutSeconds: number,
        reservedThroughputRead?: number, reservedThroughputWrite?: number
    });

    // 重置表
    public abstract async reset();
}

// export async function test() {
//     const ots = new NoSqlAliyunTablestore('session_test3')
//     // let out = await ots.create(60)
//     // FIXME 首次创建表需要有一定的系统延迟时间，需要放到install过程中进行维护。
//     // let out = await ots.insert('x', {a: 'aaa', b: {value: 'bbbb', timestamp: Date.now()}})
//     // let out = await ots.update('x', {a: 'aaa2', b: 'bbb2'})
//     // let out = await ots.update('x', {a: null, b: 1529666053100})
//     // let out = await ots.delete('x')
//
//     let out
//     // out = await ots.insert('x', {a: 'aaa', b: {value: 'bbbb', timestamp: Date.now()}})
//     // out = await ots.query('x')  // 取全部的字段
//     // out = await ots.query('x', ['a'])  // 取部分字段
//     // out = await ots.query('y')  // 取不存在的主键
//
//     // out = await ots.create(24*60*60,2)
//     // out = await ots.insert('z', {a: 'aaa'+Date(), b: {value: 'bbbb'+Date(), timestamp: Date.now()}})
//     // out = await ots.update('z', {a: 'aaa'+Date(), b: 'bbbb'+Date()})
//     // out = await ots.query('z', null, 2)
//     out = await ots.query('z', null, 1)
//     // 用最佳方案去实现字段
//     return out
// }

// 对于阿里云tablestore的单表功能简单封装处理（一个主键并作为分区唯一区分一个记录，仅用于缓存功能实现。
// 封装特点：每个记录一条主键并作为分区，每个记录有无数个kv值可供配置，每个kv值都有一个时间戳超时时间在表上单独配置。）
export class NoSqlAliyunTablestore extends NoSqlInterface {
    private _table: string
    private _client: any
    private _schema: any

    set table(value) {
        this._table = value
    }

    constructor(table: string, config: string = 'default') {
        super(table, config)
        const instances = xconfig('plugins.nosql')
        xassert(instances && _.isPlainObject(instances) && config in instances,
            ERR$CONFIG, {instances})
        this._table = table
        this._schema = {
            KEYS: {
                id: 'string' // 表的唯一记录主键值同时也是分区
            }
        }

        this._client = new TableStore.Client({
            accessKeyId: instances[config].OTS_ACCESS_KEY_ID,
            secretAccessKey: instances[config].OTS_SECRETE_ACCESS_KEY,
            endpoint: instances[config].OTS_ENDPOINT,
            instancename: instances[config].OTS_INSTANCENAME
        })
    }

    // 约定所有表都需要有自增主键id作为内部唯一标识码，其余三个主键必须全部为字符串。（后端需要扩展int和date基本数据类型以及操作符重载实现优化开发）
    // 属性字段可以根据业务演变任意的扩展增加由业务代码对于老数据不存在新增字段值的情况做兼容处理
    public async insert(id: string, kvt: { [index: string]: string | { value: string, timestamp: number } }) {
        xassert(Object.keys(kvt).length <= 128) // 规避跨行限制总计属性128个
        const __this__ = this
        // var currentTimeStamp = Date.now();
        const params = {
            tableName: this._table,
            // 插入的时候需要确保不存在对应的数据以防止出错
            condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
            primaryKey: [],
            attributeColumns: [],
            // 按照下面数据格式进行schema定义的验证以及数据类型转换
            // primaryKey: [{'gid': Long.fromNumber(20013)}, {'uid': Long.fromNumber(20013)}],
            // attributeColumns: [
            //     {'col1': '表格存储'},
            //     {'col2': '2', 'timestamp': currentTimeStamp}, // 允许修改时间戳乐观锁功能实现暂不支持
            //     {'col3': 3.1},
            //     {'col4': -0.32},
            //     {'col5': Long.fromNumber(123456789)}
            // ],
            // primaryKey: [
            //     {'short_id': 'pk1'},
            //     {[AUTO_KEY_NAME]: TableStore.PK_AUTO_INCR}
            // ],
            // attributeColumns: [
            //     {'appcode': 'app1'}
            // ],
            returnContent: {returnType: TableStore.ReturnType.Primarykey}
        }

        // 拼接主键以及属性字段值
        params.primaryKey = [{'id': id}]
        for (let k in kvt) {
            xassert(k != 'id' && k != 'timestamp') // 两个预留内部标识符不可作为属性名
            if (_.isString(kvt[k])) {
                params.attributeColumns.push({
                    [k]: kvt[k]
                })
            } else {
                params.attributeColumns.push({
                    [k]: kvt[k]['value'],
                    timestamp: kvt[k]['timestamp']
                })
            }
        }

        return new Promise((resolve, reject) => {
            try {
                __this__._client.putRow(params, function (err, out) {
                    if (err) {
                        xthrow(new Error(err), reject, {params, out})
                        return
                    }
                    // 正常返回的数据格式
                    //{"consumed":{"capacity_unit":{"read":0,"write":1}},"row":{
                    //  "primaryKey":[{"name":"short_id","value":"abcd"},{"name":"id","value":1520765502347000}],
                    //  "attributes":[]},
                    // "RequestId":"00056720-cf8d-d4a8-8ae8-970a17894ce6"}
                    resolve(out)
                })
            } catch (err) {
                xthrow(err, reject)
            }
        })
    }

    public async update(id: string, kvt: { [index: string]: string | null | number }) {
        return await this._update_or_replace(id, kvt, false)
    }

    public async replace(id: string, kvt: { [index: string]: string | null | number }) {
        return await this._update_or_replace(id, kvt, true)
    }

    // 条件更新必须要填写主键记录值(仅仅允许更新属性字段而主键字段是不允许更新的，
    //      整列更新和删除列属于运维操作禁止应用中使用需要单独接口以及权限认证)
    private async _update_or_replace(id: string, kvt: { [index: string]: string | null | number },
                                     isIgnoreRowNonExist: boolean = false) {
        xassert(Object.keys(kvt).length > 0 && Object.keys(kvt).length <= 128) // 规避跨行限制总计属性128个
        const __this__ = this
        const params = {
            tableName: this._table,
            condition: new TableStore.Condition(isIgnoreRowNonExist ?
                TableStore.RowExistenceExpectation.IGNORE :
                TableStore.RowExistenceExpectation.EXPECT_EXIST, null),
            primaryKey: [{id}],
            // updateOfAttributeColumns: [{'PUT': [{'col1': 'test6'}]}]
            updateOfAttributeColumns: []
            // updateOfAttributeColumns: [
            //     { 'PUT': [{ 'col4': Long.fromNumber(4) }, { 'col5': '5' }, { 'col6': Long.fromNumber(6) }] },
            //     { 'DELETE': [{ 'col1': Long.fromNumber(1496826473186) }] }, // 删除指定时间戳版本数据
            //     { 'DELETE_ALL': ['col2'] } // 删除所有版本的字段数据
            // ]
        }

        const PUT = []
        const DELETE = []
        const DELETE_ALL = []
        for (let k in kvt) {
            // 如果变量值为null类型则表示删除对应的字段值，如果为整数表示删除指定时间戳版本，否则表示添加或更新对应字段值。
            if (!kvt[k]) {
                DELETE_ALL.push(k)
            } else if (_.isInteger(kvt[k])) {
                DELETE.push({[k]: Long.fromNumber(kvt[k])})
            } else if (_.isString(kvt[k])) {
                PUT.push({[k]: kvt[k]})
            } else {
                xassert(false, ERR$PARAM, {id, kvt})
            }
        }
        if (PUT.length > 0) params.updateOfAttributeColumns.push({PUT})
        if (DELETE.length > 0) params.updateOfAttributeColumns.push({DELETE})
        if (DELETE_ALL.length > 0) params.updateOfAttributeColumns.push({DELETE_ALL})

        return new Promise((resolve, reject) => {
            try {
                __this__._client.updateRow(params, function (err, data) {
                    if (err) {
                        xthrow(new Error(err), reject, {params, data})
                        return
                    }
                    resolve()
                })
            } catch (err) {
                xthrow(err, reject)
            }
        })
    }

    // 以主键作为条件删除记录值
    public async delete(id: string) {
        const __this__ = this
        const params = {
            tableName: this._table,
            condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
            // primaryKey: [{ 'gid': Long.fromNumber(8) }, { 'uid': Long.fromNumber(80) }]
            primaryKey: [{id}]
        }

        return new Promise((resolve, reject) => {
            try {
                __this__._client.deleteRow(params, function (err, data) {
                    if (err) {
                        xthrow(new Error(err), reject, {params, data})
                        return
                    }
                    resolve()
                })
            } catch (err) {
                xthrow(err, reject)
            }
        })
    }

    // 范围查询需要数据自动同步到opensearch进行索引同步后进行各种复杂的查询操作实现免运维系统的实现
    // 单表逻辑条件的简单and与equal的查询，返回满足条件的第一条记录 （合并为一个查询兼容mongodb的查询扩展）
    public async query(id: string, keys: string[] | null = null, max_version: number = 1): Promise<any> {

        const __this__ = this
        const params = {
            tableName: this._table,
            columnsToGet: keys,
            // columns_to_get 获取期望的列最多128个一次获取总数，应用上应该将KEY视为分组总数。
            // 如何规避宽表的分页限制？？ FIXME 先从应用上规避限制一个应用最多不超过128个属性，通过JSON进行扩展存储。
            primaryKey: [{id}],
            // primaryKey: [{'gid': Long.fromNumber(20013)}, {'uid': Long.fromNumber(20013)}],
            columnFilter: null,
            maxVersions: max_version,
        }

        return new Promise((resolve, reject) => {
            __this__._client.getRow(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params, data})
                    return
                }

                // 返回数据格式类型进行转换处理
                // {"consumed":{"capacity_unit":{"read":1,"write":0}},
                //  "row":{"primaryKey":[{"name":"gid","value":20013},{"name":"uid","value":20013}],
                //          "attributes":[{"columnName":"col1","columnValue":"表格存储","timestamp":1520734520286},
                //                      {"columnName":"col2","columnValue":"2","timestamp":1520734520064},
                //                     {"columnName":"col3","columnValue":3.1,"timestamp":1520734520286},
                //                     {"columnName":"col4","columnValue":-0.32,"timestamp":1520734520286},
                //                     {"columnName":"col5","columnValue":123456789,"timestamp":1520734520286}]
                //        },
                // "next_token":null,"RequestId":"00056719-e2ad-73b1-dbd8-970a19522f4b"}

                // 将数据结果进行转换处理合并为一个普通对象给应用使用
                try {
                    let out: any = {}
                    if (!data.row) {
                        return resolve(null)
                    }
                    if (data.row.primaryKey) {
                        for (let k in data.row.primaryKey) {
                            out[data.row.primaryKey[k].name] = data.row.primaryKey[k].value
                        }
                    }
                    if (data.row.attributes) {
                        for (let k in data.row.attributes) {
                            out[data.row.attributes[k].columnName] = data.row.attributes[k].columnValue
                        }
                    }
                    // xlog(data) // TODO 当存在多个版本数据的时候解析不正确，应该是多个版本的属性值字段的组合才正确。
                    resolve(_.isEmpty(out) ? null : out)
                } catch (err) {
                    xthrow(new Error(err), reject, {params, data})
                    return
                }
            })
        })
    }

    // 销毁表
    public async destroy() {
        try {
            await this._destroy()
        } catch (err) {
            return
        }
        // 10秒钟等待超时销毁表正常完成
        for (let i = 0; i < 100; i++) {
            try {
                let out = this.describe()
                xlog(out)
            } catch (err) {
                await xsleep(100)
                break
            }
        }
    }

    private async _destroy() {
        const __this__ = this
        const params = {
            tableName: this._table
        }
        return new Promise((resolve, reject) => {
            __this__._client.deleteTable(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params})
                    return
                }
                resolve()
            })
        })
    }

    // 创建表
    public async create(timeout = -1, max_versions = 1) {
        await this._create(timeout, max_versions)
        // 10秒钟等待超时创建表正常完成
        for (let i = 0; i < 100; i++) {
            try {
                let out = this.describe()
                xlog(out)
            } catch (err) {
                await xsleep(100)
                continue
            }
            break
        }
    }

    private async _create(timeout = -1, max_versions = 1) {
        // OTS最长超时时间为1天的兼容处理
        if (timeout != -1 && timeout < 86400) {
            timeout = 86400
        }
        const __this__ = this
        const params = {
            tableMeta: {
                tableName: this._table,
                primaryKey: [] as any[],
                // primaryKey: [
                //     {
                //         name: 'short_id',
                //         type: 'STRING'
                //     },
                //     {
                //         name: AUTO_KEY_NAME,
                //         type: 'INTEGER',
                //         option: 'AUTO_INCREMENT',
                //     }
                // ]
            },
            reservedThroughput: {
                capacityUnit: {
                    read: 0,
                    write: 0
                }
            },
            tableOptions: {
                timeToLive: timeout,// 数据的过期时间, 单位秒, -1代表永不过期. 假如设置过期时间为一年, 即为 365 * 24 * 3600.
                maxVersions: max_versions,// 保存的最大版本数, 设置为1即代表每列上最多保存一个版本(保存最新的版本).
            }
        }
        // 自动转换schema定义为OTS的数据结构
        for (let k in this._schema.KEYS) {
            let obj = {
                name: k,
                type: _.upperCase(this._schema.KEYS[k])
            }
            // if (k == AUTO_KEY_NAME) {
            //     obj['option'] = 'AUTO_INCREMENT'
            // }
            params.tableMeta.primaryKey.push(obj)
        }
        // bugfix解决第一个分区键不能为自增主键的问题默认补上一个_id字段值的问题（只做提示暂不解决约定一个_id分区键强制设置）
        // "400: \n\u0013OTSParameterInvalid\u0012*first primary key can't be AUTO_INCREMENT."

        let out = await new Promise((resolve, reject) => {
            __this__._client.createTable(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params, data})
                    return
                }
                resolve()
            })
        })

        // FIXME 表创建后有一定的延时时间才能生效，需要维持一定的等待时间确保正常执行完成。
        // TODO 延时算法自动完成时间戳的处理。
        return out
    }

    // 查询当前表的描述信息
    public async describe() {
        const __this__ = this
        const params = {
            tableName: this._table
        }
        return new Promise((resolve, reject) => {
            __this__._client.describeTable(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params})
                    return
                }
                resolve(data)
            })
        })
    }

    // 表配置信息的更新处理(时间戳以及版本号)
    public async change(param: {
        maxVersions?: number, timeoutSeconds: number,
        reservedThroughputRead?: number, reservedThroughputWrite?: number
    }) {
        const __this__ = this
        const params = {
            tableName: this._table,
            tableOptions: {
                // 保存的最大版本数, 设置为1即代表每列上最多保存一个版本(保存最新的版本).
                maxVersions: param.maxVersions ? param.maxVersions : 1,
                // 数据的过期时间, 单位秒, -1代表永不过期. 假如设置过期时间为一年, 即为 365 * 24 * 3600
                timeToLive: param.timeoutSeconds ? param.timeoutSeconds : -1,

            },
            reservedThroughput: {
                capacityUnit: {
                    // 为了提升并发度确保预留最小读写数量的配置避免服务共享可能产生的资源竞争不稳定问题
                    read: param.reservedThroughputRead ? param.reservedThroughputRead : 0,
                    write: param.reservedThroughputWrite ? param.reservedThroughputWrite : 0,
                }
            },
        }
        return new Promise((resolve, reject) => {
            __this__._client.updateTable(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params})
                    return
                }
                resolve(data)
            })
        })
    }

    // 重置表
    public async reset() {
        try {
            await this.destroy()
        } catch (err) {
            // ignore error
        }
        await this.create()
    }
}
