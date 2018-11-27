/**
 * 对于阿里云OTS表格存储的业务封装
 *
 * NOSQL的应用使用约定
 * OTS四个KEYS字段2个占用，2个应用自己扩展使用，OTS限制最多定义4个主键，并且第一个主键zone为分区主键。
 * KEYS：
 *  zone (如果在insert的时候不填写，按照uuid时间顺序生成分区键确保主键的唯一顺序性)
 *  [可扩展业务自定义的两个主键]
 *  id
 * COLUMNS：
 *  // 预定义如下两个字段用于跟踪记录的创建时间和修改时间（不支持is_deleted假删除标记OTS的业务特点不适合使用）
 *  created_at
 *  updated_at
 */
const TableStore = require('tablestore')
const Long = TableStore.Long
const _ = require('lodash')
const moment = require('moment')
const uuidv1 = require('uuid/v1')

// INT64基本数据类型的表格存储的扩展
function int64(v: string | number) {
    if (typeof v == 'string') {
        return Long.fromString(v)
    } else if (typeof v == 'number') {
        return Long.fromNumber(v)
    } else {
        xthrow(ERR$PARAM, {v, type: typeof v})
    }
}

import {NosqlInterface, ROW, RANGE, AUTO_KEY_NAME, ZONE_KEY_NAME} from './inerface'

export class NosqlAliyunTablestore extends NosqlInterface {
    private _table: string
    private _client: any
    private _schema: any

    constructor(table: string, config: string = 'default') {
        super(table, config)
        const instances = xconfig('plugins.nosql')
        xassert(instances && _.isPlainObject(instances) && config in instances,
            ERR$CONFIG, {instances})
        this._table = table
        this._schema = Object.assign({}, instances[config].OTS_TABLES[table])

        // BUGFIX 解决tablestore特殊的设计进行包装通过约定对应用进行透明实现。
        // 默认增加第一个zone分区键占用设置（插入数据没有赋值会自动补上散列算法自动进行算法实现），
        // 如果没有定义主键自动补上一个id自增主键兼容业务应用（仅仅为KEYS为空的时候自动补上改值）。
        if (_.isEmpty(this._schema.KEYS)) this._schema.KEYS = {}
        if (_.isEmpty(this._schema.COLUMNS)) this._schema.COLUMNS = {}
        // zone和id为约定主键禁止应用将其使用到主键或属性列定义中
        xassert(!(ZONE_KEY_NAME in this._schema.KEYS) && !(AUTO_KEY_NAME in this._schema.KEYS),
            ERR$CONFIG, {schema: this._schema})
        xassert(!(ZONE_KEY_NAME in this._schema.COLUMNS) && !(AUTO_KEY_NAME in this._schema.COLUMNS),
            ERR$CONFIG, {schema: this._schema})
        // 检查主键数量最多用户可以自定义使用2个(id自增主键放在最后，zone分区键放在最前面)
        xassert(_.keys(this._schema.KEYS).length <= 2, ERR$CONFIG, {schema: this._schema})

        // zone为约定分区键无需在schema中定义是string类型会自动补上对应的主键定义（在表插入的时候如果用户不赋值则自动补上随机散列值）
        let obj = {} // 确保在新增两个约定主键后主键定义顺序与应用保持一致
        obj[ZONE_KEY_NAME] = 'string'
        if (_.isEmpty(this._schema.KEYS)) {
            // 如果一个用户自定义的主键都没有就自动补上一个自增主键id进行唯一标识(只能补到第二列才能正确检索)
            obj[AUTO_KEY_NAME] = 'integer'
        } else {
            for (let k in this._schema.KEYS) {
                obj[k] = this._schema.KEYS[k]
            }
        }
        this._schema.KEYS = obj

        // 确保两个缺省字段都不存在在用户自定义的字段中（添加到COLUMNS定义中）
        this._schema.COLUMNS['created_at'] = 'string'
        this._schema.COLUMNS['updated_at'] = 'string'

        this._client = new TableStore.Client({
            accessKeyId: instances[config].OTS_ACCESS_KEY_ID,
            secretAccessKey: instances[config].OTS_SECRETE_ACCESS_KEY,
            endpoint: instances[config].OTS_ENDPOINT,
            instancename: instances[config].OTS_INSTANCENAME
        })
    }

    private _check_type(value) {
        return _.includes(['string', 'number', 'boolean'], typeof value)
    }

    // 对于行记录的schema模式校验确保数据类型严格的正确以及拼接完整的tablestore数据结构中的主键和属性两个字段
    private _check_schema(row: ROW, params: any, is_insert_check: boolean = false) {

        // 需要对应用传入的主键序列严格按照schema定义的排序（否则OTS服务端无法进行正确处理而导致报错异常）
        for (let k in this._schema.KEYS) {
            if (!(k in row)) {
                // 只有非插入属性并且为非自增主键的情况才会允许主键字段的输入必须要完整
                xassert(is_insert_check && k == AUTO_KEY_NAME, ERR$PARAM, {k, row, params})
            }
            if (is_insert_check && k == AUTO_KEY_NAME) {
                params.primaryKey.push({[AUTO_KEY_NAME]: TableStore.PK_AUTO_INCR})// 以id约定为自增表主键值
            } else if (this._schema.KEYS[k] == 'integer') {
                xassert(this._check_type(row[k]), ERR$PARAM, {k, row, params})
                params.primaryKey.push({[k]: int64(row[k] as string | number)})
            } else {
                xassert(this._check_type(row[k]), ERR$PARAM, {k, row, params})
                params.primaryKey.push({[k]: row[k]})
            }
        }

        // 按照schema定义进行属性赋值
        for (let k in this._schema.COLUMNS) {
            if (!(k in row)) {
                continue
            }
            if (this._schema.COLUMNS[k] == 'integer') {
                xassert(this._check_type(row[k]), ERR$PARAM, {k, row, params})
                params.attributeColumns.push({[k]: int64(row[k] as string | number)})
            } else {
                xassert(this._check_type(row[k]), ERR$PARAM, {k, row, params})
                params.attributeColumns.push({[k]: row[k]})
            }
        }

        // TODO 对于所有主键和属性的数据类型转换处理防止属性赋值错误进行检查判断
    }

    // 约定所有表都需要有自增主键id作为内部唯一标识码，其余三个主键必须全部为字符串。（后端需要扩展int和date基本数据类型以及操作符重载实现优化开发）
    // 属性字段可以根据业务演变任意的扩展增加由业务代码对于老数据不存在新增字段值的情况做兼容处理
    public async insert(row: ROW) {
        if (!row) row = {}
        row = Object.assign({[ZONE_KEY_NAME]: ''}, row)
        xassert(_.isPlainObject(row), ERR$PARAM, {row})
        // 没有指定分区间为其自动随机补上一个分区键值进行散列算法实现
        // if (!(ZONE_KEY_NAME in row)) {
        //     // const shortid = require('shortid')
        //     // row[ZONE_KEY_NAME] = shortid.generate()
        //     // 改用uuid1的时间连续性的唯一值进行有序排列数据方便应用遍历查找
        //     // row[ZONE_KEY_NAME] = uuidv1().replace(/\-/g, '') // 添加ZONE分区键（按照时间顺序uuid排列）
        //     row[ZONE_KEY_NAME] = '' // FIXME 暂时完全忽略掉存在问题
        // }
        delete row[AUTO_KEY_NAME] // 删除可能的不需要输入的id值避免潜在插入错误
        // 自动补上updated_at和created_at两个缺省字段值的自动设置
        row['created_at'] = row['updated_at'] = moment().format('YYYY-MM-DD HH:mm:ss')

        const __this__ = this
        // var currentTimeStamp = Date.now();
        const params = {
            tableName: this._table,
            condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
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
        this._check_schema(row, params, true)
        return new Promise((resolve, reject) => {
            try {
                __this__._client.putRow(params, function (err, data) {
                    if (err) {
                        xthrow(new Error(err), reject, {params, data})
                        return
                    }
                    //{"consumed":{"capacity_unit":{"read":0,"write":1}},"row":{
                    //  "primaryKey":[{"name":"short_id","value":"abcd"},{"name":"id","value":1520765502347000}],
                    //  "attributes":[]},
                    // "RequestId":"00056720-cf8d-d4a8-8ae8-970a17894ce6"}
                    // 插入后返回主键列表新增的自增字段值给应用做应用关联
                    xassert(data.row && data.row.primaryKey && _.isArray(data.row.primaryKey),
                        ERR$PARAM, {data, table: __this__._table})
                    let out = Object.assign({}, row)
                    for (let k in data.row.primaryKey) {
                        let value = data.row.primaryKey[k].value
                        // int64转换回到number的javascript类型处理
                        if (typeof value as any == 'object') {
                            out[data.row.primaryKey[k].name] = value.toNumber()
                        } else {
                            out[data.row.primaryKey[k].name] = value
                        }
                    }
                    resolve(out)
                })
            } catch (err) {
                xthrow(err, reject)
            }
        })
    }

    // 条件更新必须要填写主键记录值(仅仅允许更新属性字段而主键字段是不允许更新的，
    //      整列更新和删除列属于运维操作禁止应用中使用需要单独接口以及权限认证)
    public async update(row: ROW, condition: ROW) {
        xassert(row && condition && _.isPlainObject(row) && _.isPlainObject(condition))
        row = xassign({}, row)
        condition = xassign({[ZONE_KEY_NAME]: ''}, condition)
        // 检查主键条件严格保证匹配，当主键不完整的时候需要通过id主键查找原始值补全缺少的主键值（FIXME OTS的缺陷规避掉）
        // xassert('id' in condition, ERR$PARAM, {row, condition})
        // let tmp = await this.query({id: condition.id}) // 检查id的有效性
        // xassert(tmp, ERR$EMPTY, {row, condition, tmp})
        // condition = xassign({}, condition)
        // for (let k in this._schema.KEYS) {
        //     condition[k] = tmp[k] // 补全完整的字段
        // }

        // 更新缺省自定义的属性字段
        row['updated_at'] = moment().format('YYYY-MM-DD HH:mm:ss')

        const __this__ = this
        const params = {
            tableName: this._table,
            condition: null,
            // condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST
            //     , new TableStore.SingleColumnCondition("col1", 'test5', TableStore.ComparatorType.EQUAL)),
            // primaryKey: [{'gid': Long.fromNumber(20013)}, {'uid': Long.fromNumber(20013)}],
            primaryKey: [] as any[],
            // updateOfAttributeColumns: [{'PUT': [{'col1': 'test6'}]}]
            updateOfAttributeColumns: [{'PUT': [] as any[]}]
        }

        // 先处理更新字段的赋值处理
        for (let k in row) {
            xassert(k in this._schema.COLUMNS && this._check_type(row[k]),
                ERR$PARAM, {k, row, schema: this._schema})
            params.updateOfAttributeColumns[0]['PUT'].push({[k]: row[k]})
        }

        // 再处理主键查询条件（所有主键字段必须要设置）
        for (let k in this._schema.KEYS) {
            xassert(k in condition && this._check_type(condition[k]), ERR$PARAM, {k, condition})
            if (this._schema.KEYS[k] == 'integer') {
                params.primaryKey.push({[k]: int64(condition[k] as any)})
            } else {
                params.primaryKey.push({[k]: condition[k]})
            }
        }

        // 最后处理属性条件的组合查询处理(case1 只有主键字段，case2 只有一个属性字段， case3 有两个或以上的属性字段)
        let size1 = _.keys(condition).length
        let size2 = _.keys(this._schema.KEYS).length
        if (size1 == size2) {
            // 只有属性字段等价于无条件更新属性
            params.condition = new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null)
        } else if (size1 == size2 + 1) {
            // 只有一个属性字段查询条件
            for (let k in condition) {
                if (k in this._schema.KEYS) {
                    continue
                }
                xassert(!params.condition as any, ERR$PARAM, {condition, KEYS: this._schema.KEYS})
                if (this._schema.KEYS[k] == 'integer') {
                    params.condition = new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST,
                        new TableStore.SingleColumnCondition(k, int64(condition[k] as any), TableStore.ComparatorType.EQUAL))
                } else {
                    params.condition = new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST,
                        new TableStore.SingleColumnCondition(k, condition[k], TableStore.ComparatorType.EQUAL))
                }
            }
        } else {
            // 两个或两个以上属性字段查询条件（复合条件查询处理）
            let and: any = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND)
            for (let k in condition) {
                if (k in this._schema.KEYS) {
                    continue
                }
                if (this._schema.KEYS[k] == 'integer') {
                    and.addSubCondition(k, int64(condition[k] as any), TableStore.ComparatorType.EQUAL)
                } else {
                    and.addSubCondition(k, condition[k], TableStore.ComparatorType.EQUAL)
                }
            }
            params.condition = new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, and)
        }
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
    public async delete(row: ROW) {
        const __this__ = this
        const params = {
            tableName: this._table,
            condition: new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null),
            // primaryKey: [{ 'gid': Long.fromNumber(8) }, { 'uid': Long.fromNumber(80) }]
            primaryKey: [] as any[]
        }

        // 至少一个主键
        xassert(_.keys(this._schema.KEYS).length > 0, ERR$PARAM, {schema: this._schema})
        for (let k in this._schema.KEYS) {
            // 所有的主键条件必须都要存在
            xassert(k in row, ERR$PARAM, {k, row, params})
            if (this._schema.KEYS[k] == 'integer') {
                params.primaryKey.push({[k]: int64(row[k] as any)})
            } else {
                params.primaryKey.push({[k]: row[k] as any})
            }
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

    // 分页查询一次检索N条记录（
    //      分布式系统的特点不适合批量查询多条记录，如有这种需求需要mongodb或mysql完成，
    //      tablestore更加适合分布式session存储这种数据特点的应用，
    //      大数据检索需要借助opensearch直通表同步完成实现无运维NOSQL完整方案，
    //      只有需要事务特性关键应用才需要mysql不过这部分基本上不是nodejs的工作范围而需要下层到java服务层去实现更合适。
    // ）
    // private async _query_by_opensearch(row: ROW) {
    //     // TODO ... (需要通过schema配置在创建表的时候自动进行opensearch关联表创建，在insert和update数据的时候自动同步opensearch数据)
    // }
    private async _query_by_range(range: RANGE | undefined, limit: number = 10, is_asc_or_desc: boolean = true) {
        if (!range) {
            range = {}
        }
        xassert(_.isPlainObject(range) && _.isInteger(limit) && limit >= 1 && _.isBoolean(is_asc_or_desc), ERR$PARAM, {range})
        // 验证查询范围数据合法性(所有字段必须要是主键）
        xassert(_.keys(range).length <= _.keys(this._schema.KEYS).length, ERR$PARAM, {range})
        for (let k in this._schema.KEYS) {
            if (!(k in range)) {
                continue
            }
            if (_.isArray(range[k])) {
                xassert((range[k] as any[]).length == 2, ERR$PARAM, {k, range})
                xassert(this._check_type(range[k][0]) && this._check_type(range[k][1]), ERR$PARAM, {k, range})
            } else {
                xassert(this._check_type(range[k]), ERR$PARAM, {k, range})
            }
        }

        // 拼装查询参数
        const __this__ = this
        const params = {
            tableName: this._table,
            direction: is_asc_or_desc ? TableStore.Direction.FORWARD : TableStore.Direction.BACKWARD,
            // inclusiveStartPrimaryKey: [{"gid": TableStore.INF_MIN}, {"uid": TableStore.INF_MIN}],
            // exclusiveEndPrimaryKey: [{"gid": TableStore.INF_MAX}, {"uid": TableStore.INF_MAX}],
            inclusiveStartPrimaryKey: [] as any[],
            exclusiveEndPrimaryKey: [] as any[],
            limit: limit
        }
        // 根据主键的查询条件进行查询范围的设置(按照schema定义字段进行排序处理)
        for (let k in this._schema.KEYS) {
            if (!(k in range)) {
                // FIXME 规避OTS的设计缺陷必须要补上分区键并且确保左闭右开的查询数据结构，否则就是全表查询。
                if (k == ZONE_KEY_NAME) {
                    if (is_asc_or_desc) {
                        params.inclusiveStartPrimaryKey.push({[k]: ''})
                        params.exclusiveEndPrimaryKey.push({[k]: '!'})
                    } else {
                        params.inclusiveStartPrimaryKey.push({[k]: '!'})
                        params.exclusiveEndPrimaryKey.push({[k]: ''})
                    }
                    continue
                }
                // 不填的主键参数按照最小和最大范围自动补上查询条件(有问题会查询出所有的满足条件的数据)
                if (is_asc_or_desc) {
                    // 升序逻辑处理
                    params.inclusiveStartPrimaryKey.push({[k]: TableStore.INF_MIN})
                    params.exclusiveEndPrimaryKey.push({[k]: TableStore.INF_MAX})
                } else {
                    // 降序逻辑处理
                    params.inclusiveStartPrimaryKey.push({[k]: TableStore.INF_MAX})
                    params.exclusiveEndPrimaryKey.push({[k]: TableStore.INF_MIN})
                }
            } else if (_.isArray(range[k])) {
                // 用户指定范围进行查询
                if (this._schema.KEYS[k] == 'integer') {
                    params.inclusiveStartPrimaryKey.push({[k]: int64(range[k][0] as any)})
                    params.exclusiveEndPrimaryKey.push({[k]: int64(range[k][1] as any)})
                } else {
                    params.inclusiveStartPrimaryKey.push({[k]: range[k][0]})
                    params.exclusiveEndPrimaryKey.push({[k]: range[k][1]})
                }
            } else {
                // 等值确定条件查询
                if (this._schema.KEYS[k] == 'integer') {
                    params.inclusiveStartPrimaryKey.push({[k]: int64(range[k] as any)})
                    params.exclusiveEndPrimaryKey.push({[k]: int64(range[k] as any)})
                } else {
                    params.inclusiveStartPrimaryKey.push({[k]: range[k]})
                    params.exclusiveEndPrimaryKey.push({[k]: range[k]})
                }
            }
        }

        return new Promise((resolve, reject) => {
            let resultRows = [] // 递归嵌套查询的最终查询完成的数据集合（等查询结束后再进行统一处理）
            const getRange = function () {
                __this__._client.getRange(params, function (err, data) {
                    if (err) {
                        xthrow(new Error(err), reject, {params, data})
                        return
                    }
                    resultRows = resultRows.concat(data.rows)
                    //如果data.next_start_primary_key不为空，说明需要继续读取
                    // if (data.next_start_primary_key) {
                    if (false) {
                        // // params.inclusiveStartPrimaryKey = [
                        // //     {"gid": data.next_start_primary_key[0].value},
                        // //     {"uid": data.next_start_primary_key[1].value}
                        // // ]
                        // params.inclusiveStartPrimaryKey = []
                        // let i = 0
                        // for (let k in __this__._schema.KEYS) {
                        //     if (__this__._schema.KEYS[k] == 'integer') {
                        //         params.inclusiveStartPrimaryKey.push({[k]: int64(data.next_start_primary_key[i].value.toNumber())})
                        //     } else {
                        //         params.inclusiveStartPrimaryKey.push({[k]: data.next_start_primary_key[i].value})
                        //     }
                        //     i += 1
                        // }
                        // getRange() // 分页数过大接口自动完成多次嵌套递归查询形成应用逻辑上的一个分页单次查询结果输出
                    } else {
                        // 统一的数据类型转换最终的数据结果处理
                        // [ { primaryKey: [ [Object], [Object] ], attributes: [ [Object] ] },
                        //     { primaryKey: [ [Object], [Object] ], attributes: [ [Object] ] },
                        //     { primaryKey: [ [Object], [Object] ], attributes: [ [Object] ] },
                        //     { primaryKey: [ [Object], [Object] ], attributes: [ [Object] ] } ]
                        // xlog(JSON.stringify(resultRows))
                        let out: any = []
                        for (let k in resultRows as any) {
                            let obj = {}
                            if (resultRows[k].primaryKey) {
                                for (let j in resultRows[k].primaryKey) {
                                    let value = resultRows[k].primaryKey[j].value
                                    // int64转换回到number的javascript类型处理
                                    if (typeof value as any == 'object') {
                                        obj[resultRows[k].primaryKey[j].name] = value.toNumber()
                                    } else {
                                        obj[resultRows[k].primaryKey[j].name] = value
                                    }
                                }
                            }
                            if (resultRows[k].attributes) {
                                for (let j in resultRows[k].attributes) {
                                    let value = resultRows[k].attributes[j].columnValue
                                    if (typeof value as any == 'object') {
                                        obj[resultRows[k].attributes[j].columnName] = value.toNumber()
                                    } else {
                                        obj[resultRows[k].attributes[j].columnName] = value
                                    }
                                }
                            }
                            out.push(obj)
                        }
                        if (out.length == 0) out = undefined
                        return resolve(out)
                    }
                })
            }
            getRange()
        })
    }

    private async _query_by_key(row: ROW) {
        row = xassign({[ZONE_KEY_NAME]: ''}, row) // 补上ZONE缺省值
        const __this__ = this
        const params = {
            tableName: this._table,
            primaryKey: [] as any[],
            // primaryKey: [{'gid': Long.fromNumber(20013)}, {'uid': Long.fromNumber(20013)}],
            columnFilter: null,
        }

        // 补上主键值equal查询(注意事项：OTS接口必须要所有key都存在才允许查询,而且每个表必须要至少一个主键，
        // 此处的主键与数据库中的主键并非同一个含义而是分布式系统数据散列的一个分区条件字段而已并非一定需要保持唯一。)
        xassert(_.keys(this._schema.KEYS).length >= 1, ERR$PARAM, {row, KEYS: this._schema.KEYS})
        for (let k in this._schema.KEYS) {
            // 检查输入条件中所有的主键字段是否完整
            xassert(k in row && this._check_type(row[k]), ERR$PARAM, {k, row, params})
            if (this._schema.KEYS[k] == 'integer') {
                params.primaryKey.push({[k]: int64(row[k] as any)})
            } else {
                params.primaryKey.push({[k]: row[k]})
            }
        }

        // 又是一个坑点：必须要至少2个子查询条件才能生效，如果应用输入的参数过少需要自动补上重复的查询条件进行兼容处理。
        // 补上字段值equal查询
        let condition: any = new TableStore.CompositeCondition(TableStore.LogicalOperator.AND)
        let sub_condition_count = 0
        for (let k in this._schema.COLUMNS) {
            if (!(k in row)) {
                continue
            }
            xassert(this._check_type(row[k]), ERR$PARAM, {k, row, params})
            if (this._schema.COLUMNS[k] == 'integer') {
                condition.addSubCondition(new TableStore.SingleColumnCondition(
                    k, int64(row[k] as any), TableStore.ComparatorType.EQUAL));
            } else {
                condition.addSubCondition(new TableStore.SingleColumnCondition(
                    k, row[k], TableStore.ComparatorType.EQUAL));
            }
        }
        if (sub_condition_count < 2) {
            // 检查主键查询条件至少要有一个
            xassert(params.primaryKey.length >= 1, ERR$PARAM, {row, params})
            // 用主键补上两个子查询条件HACK掉接口存在的BUG进行兼容性处理
            let k = _.keys(this._schema.KEYS)[0]
            for (let i = 0; i + sub_condition_count < 2; i++) {
                if (this._schema.KEYS[k] == 'integer') {
                    condition.addSubCondition(new TableStore.SingleColumnCondition(
                        k, int64(row[k] as any), TableStore.ComparatorType.EQUAL))
                } else {
                    condition.addSubCondition(new TableStore.SingleColumnCondition(
                        k, row[k], TableStore.ComparatorType.EQUAL))
                }
            }
        }
        params.columnFilter = condition
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
                        return resolve(undefined)
                    }
                    if (data.row.primaryKey) {
                        for (let k in data.row.primaryKey) {
                            let value = data.row.primaryKey[k].value
                            // int64转换回到number的javascript类型处理
                            if (typeof value as any == 'object') {
                                out[data.row.primaryKey[k].name] = value.toNumber()
                            } else {
                                out[data.row.primaryKey[k].name] = value
                            }
                        }
                    }
                    if (data.row.attributes) {
                        for (let k in data.row.attributes) {
                            let value = data.row.attributes[k].columnValue
                            if (typeof value as any == 'object') {
                                out[data.row.attributes[k].columnName] = value.toNumber()
                            } else {
                                out[data.row.attributes[k].columnName] = value
                            }
                        }
                    }
                    if (_.keys(out).length == 0) out = undefined
                    resolve(out)
                } catch (err) {
                    xthrow(new Error(err), reject, {params, data})
                    return
                }
            })
        })
    }

    // 范围查询需要数据自动同步到opensearch进行索引同步后进行各种复杂的查询操作实现免运维系统的实现
    // 单表逻辑条件的简单and与equal的查询，返回满足条件的第一条记录 （合并为一个查询兼容mongodb的查询扩展）
    public async query(row: ROW | RANGE | number, limit: number | boolean = 1, is_asc_or_desc: boolean = true): Promise<any> {
        if (_.isInteger(row)) {
            // 等价于row为limit进行全表升级遍历查询
            let size = row
            let is_asc = is_asc_or_desc
            if (_.isBoolean(limit)) {
                is_asc = limit as boolean
            }
            return await this._query_by_range(undefined, size as number, is_asc) // 一个条件都不输入进行全表遍历查询
        }
        // 至少输入一个查询条件的情况处理
        xassert(_.isInteger(limit), ERR$PARAM, {row, limit, is_asc_or_desc})
        if (limit == 1) {
            return await this._query_by_key(row as ROW)
            // // FIXME 规避OTS的设计缺陷只有ZONE和ID两个主键的时候才可以按KEY查找单条数据
            // if (_.keys(this._schema.KEYS).length == 2 && AUTO_KEY_NAME in this._schema.KEYS) {
            //     row = {
            //         [ZONE_KEY_NAME]: row[ZONE_KEY_NAME] ? row[ZONE_KEY_NAME] : '',
            //         [AUTO_KEY_NAME]: row[AUTO_KEY_NAME],
            //     }
            //     return await this._query_by_key(row as ROW)
            // }
            // // FIXME 规避OTS的设计缺陷解决通过range查询替代主键查询
            // let out = await this._query_by_range(row as RANGE, limit as number, is_asc_or_desc)
            // if (!out) return undefined
            // return out[0]
        }
        return await this._query_by_range(row as RANGE, limit as number, is_asc_or_desc)
    }

    // 销毁表
    public async destroy() {
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
    public async create() {
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
                timeToLive: -1,// 数据的过期时间, 单位秒, -1代表永不过期. 假如设置过期时间为一年, 即为 365 * 24 * 3600.
                maxVersions: 1// 保存的最大版本数, 设置为1即代表每列上最多保存一个版本(保存最新的版本).
            }
        }
        // 自动转换schema定义为OTS的数据结构
        for (let k in this._schema.KEYS) {
            let obj = {
                name: k,
                type: _.upperCase(this._schema.KEYS[k])
            }
            if (k == AUTO_KEY_NAME) {
                obj['option'] = 'AUTO_INCREMENT'
            }
            params.tableMeta.primaryKey.push(obj)
        }
        // bugfix解决第一个分区键不能为主键的问题默认补上一个_id字段值的问题（只做提示暂不解决约定一个_id分区键强制设置）
        // "400: \n\u0013OTSParameterInvalid\u0012*first primary key can't be AUTO_INCREMENT."

        return new Promise((resolve, reject) => {
            __this__._client.createTable(params, function (err, data) {
                if (err) {
                    xthrow(new Error(err), reject, {params, data})
                    return
                }
                resolve()
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

