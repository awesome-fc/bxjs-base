/**
 * NOSQL通用接口插件封装用于framework的cache以及session等基础业务功能实现
 */

export const ZONE_KEY_NAME = 'zone' // 分区主键名
export const AUTO_KEY_NAME = 'id'   // 自增主键名

// 表格存储的一行数据的类型定义(根据schema定义自动实现integer类型的转换处理对于JS层面不可见integer)
export interface ROW {
    [propName: string]: string | boolean | number
}

// 表格存储的主键范围查询数据类型定义
export interface RANGE {
    [propName: string]: [string, string] | [number, number] | string | number
}

export abstract class NosqlInterface {

    constructor(table: string, config: string = 'default') {
    }

    // 约定所有表都需要有自增主键id作为内部唯一标识码，其余三个主键必须全部为字符串。（后端需要扩展int和date基本数据类型以及操作符重载实现优化开发）
    // 属性字段可以根据业务演变任意的扩展增加由业务代码对于老数据不存在新增字段值的情况做兼容处理
    public abstract async insert(row: ROW);

    // 条件更新必须要填写主键记录值(仅仅允许更新属性字段而主键字段是不允许更新的，
    //      整列更新和删除列属于运维操作禁止应用中使用需要单独接口以及权限认证)
    public abstract async update(row: ROW, condition: ROW);

    // 以主键作为条件删除记录值
    public abstract async delete(row: ROW);

    // 分页查询一次检索N条记录
    public abstract async query(row: ROW | RANGE | number, limit?: number | boolean, is_asc_or_desc?: boolean): Promise<any>;

    // 销毁表
    public abstract async destroy();

    // 创建表
    public abstract async create();

    // 重置表
    public abstract async reset();
}
